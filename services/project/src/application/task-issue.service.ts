import { PrismaClient, Prisma, TaskIssue } from "@prisma/client";
import { createMentions } from "./mention.util.js";
import { notifyMentionBell } from "./mention-bell.util.js";
import { AuthUser, isProjectMember } from "./work-log-permissions";
import { DashboardService } from "./dashboard/dashboard.service.js";

export class TaskIssueError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) {
    super(message);
    this.name = "TaskIssueError";
  }
}

type AuthUserWithName = AuthUser & { name: string };

export class TaskIssueService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly dashboard: DashboardService,
  ) {}

  /** 이슈 변경이 대시보드 이슈현황/RAG/그룹 롤업에 반영되도록 관련 캐시를 즉시 무효화. */
  private async invalidateDashboard(taskId: string): Promise<void> {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { projectId: true },
    });
    if (task) await this.dashboard.invalidateProjectAndGroups(task.projectId);
  }

  /**
   * 이슈 생성/해결/수정/삭제 권한.
   * 프로젝트 구성원 누구나 가능 (VIEWER만 읽기 전용).
   */
  private async canManage(taskId: string, user: AuthUser): Promise<boolean> {
    if (user.role === "ADMIN" || user.role === "MANAGER" || user.role === "OPERATOR") return true;
    if (user.role === "VIEWER") return false;
    const task = await this.prisma.task.findUnique({ where: { id: taskId }, select: { projectId: true } });
    if (!task) return false;
    return isProjectMember(this.prisma, user.id, task.projectId);
  }

  async listByTask(taskId: string, _user: AuthUser) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId }, select: { id: true } });
    if (!task) throw new TaskIssueError("TASK_NOT_FOUND", "작업을 찾을 수 없습니다.", 404);

    // 미해결 먼저, 그 안에서 최신순
    const items = await this.prisma.taskIssue.findMany({
      where: { taskId },
      orderBy: [{ isResolved: "asc" }, { createdAt: "desc" }],
    });
    return items.map((i) => this.toDto(i));
  }

  async create(taskId: string, data: { content: string; mentionedUserIds?: string[] | undefined }, user: AuthUserWithName) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId }, select: { id: true } });
    if (!task) throw new TaskIssueError("TASK_NOT_FOUND", "작업을 찾을 수 없습니다.", 404);

    if (!(await this.canManage(taskId, user))) {
      throw new TaskIssueError("FORBIDDEN_TASK_ISSUE_CREATE", "이 작업에 이슈를 등록할 권한이 없습니다.", 403);
    }

    const created = await this.prisma.taskIssue.create({
      data: {
        taskId,
        content: data.content,
        authorId: user.id,
        authorName: user.name,
      },
    });
    await this.invalidateDashboard(taskId);

    await createMentions(this.prisma, {
      sourceType: "ISSUE",
      sourceId: created.id,
      taskId,
      userIds: data.mentionedUserIds ?? [],
      actorId: user.id,
    });
    void notifyMentionBell(this.prisma, {
      sourceType: "ISSUE",
      userIds: data.mentionedUserIds ?? [],
      actorId: user.id,
      preview: data.content,
      taskId,
    });

    return this.toDto(created);
  }

  async update(
    id: string,
    data: { content?: string | undefined; isResolved?: boolean | undefined },
    user: AuthUserWithName,
  ) {
    const issue = await this.prisma.taskIssue.findUnique({ where: { id } });
    if (!issue) throw new TaskIssueError("TASK_ISSUE_NOT_FOUND", "이슈를 찾을 수 없습니다.", 404);
    if (!(await this.canManage(issue.taskId, user))) {
      throw new TaskIssueError("FORBIDDEN_TASK_ISSUE_EDIT", "이슈를 수정할 권한이 없습니다.", 403);
    }

    const updateData: Prisma.TaskIssueUpdateInput = {};
    if (data.content !== undefined) updateData.content = data.content;
    if (data.isResolved !== undefined) {
      updateData.isResolved = data.isResolved;
      updateData.resolvedAt = data.isResolved ? new Date() : null;
      updateData.resolvedBy = data.isResolved ? user.id : null;
    }

    const updated = await this.prisma.taskIssue.update({ where: { id }, data: updateData });
    if (data.isResolved !== undefined) await this.invalidateDashboard(issue.taskId);
    return this.toDto(updated);
  }

  async remove(id: string, user: AuthUser) {
    const issue = await this.prisma.taskIssue.findUnique({ where: { id } });
    if (!issue) throw new TaskIssueError("TASK_ISSUE_NOT_FOUND", "이슈를 찾을 수 없습니다.", 404);
    if (!(await this.canManage(issue.taskId, user))) {
      throw new TaskIssueError("FORBIDDEN_TASK_ISSUE_DELETE", "이슈를 삭제할 권한이 없습니다.", 403);
    }
    await this.prisma.taskIssue.delete({ where: { id } });
    await this.invalidateDashboard(issue.taskId);
  }

  private toDto(i: TaskIssue) {
    return {
      id: i.id,
      taskId: i.taskId,
      content: i.content,
      isResolved: i.isResolved,
      resolvedAt: i.resolvedAt,
      resolvedBy: i.resolvedBy,
      authorId: i.authorId,
      authorName: i.authorName,
      createdAt: i.createdAt,
      updatedAt: i.updatedAt,
    };
  }
}
