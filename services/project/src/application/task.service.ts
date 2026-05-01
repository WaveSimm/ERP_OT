import { PrismaClient, Task, TaskStatus, TaskSegment, SegmentAssignment, AllocationMode } from "@prisma/client";
import { AppError } from "@erp-ot/shared";
import { TaskEntity } from "../domain/entities/task.entity.js";
import { ProjectCacheService } from "../infrastructure/cache/project.cache.js";
import { ProjectGateway } from "../infrastructure/websocket/project.gateway.js";
import { AggregateService } from "./aggregate.service.js";

const STATUS_KO: Record<string, string> = {
  TODO: "예정", IN_PROGRESS: "진행중", DONE: "완료", BLOCKED: "차단",
};

export interface CreateTaskDto {
  parentId?: string;
  name: string;
  description?: string;
  sortOrder?: number;
  isMilestone?: boolean;
}

export interface UpdateTaskDto {
  name?: string;
  description?: string;
  status?: TaskStatus;
  parentId?: string | null;
  sortOrder?: number;
  overallProgress?: number;
  isManualProgress?: boolean;
  isMilestone?: boolean;
}

export interface CreateSegmentDto {
  name: string;
  startDate: string; // ISO date
  endDate: string;
  sortOrder?: number;
}

export interface UpdateSegmentDto {
  name?: string;
  startDate?: string;
  endDate?: string;
  progressPercent?: number;
  sortOrder?: number;
  changeReason?: string;
}

export interface UpsertAssignmentDto {
  resourceId: string;
  allocationMode: AllocationMode;
  allocationPercent?: number;
  allocationHoursPerDay?: number;
}

export class TaskService {
  private readonly aggregate: AggregateService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly cache: ProjectCacheService,
    private readonly gateway: ProjectGateway,
  ) {
    this.aggregate = new AggregateService(prisma);
  }

  async getProjectTasks(projectId: string): Promise<Task[]> {
    return this.prisma.task.findMany({
      where: { projectId },
      include: {
        segments: {
          include: { assignments: true },
          orderBy: { sortOrder: "asc" },
        },
        predecessorOf: true,
        successorOf: true,
      },
      orderBy: [{ sortOrder: "asc" }],
    });
  }

  async createTask(projectId: string, dto: CreateTaskDto, requesterId: string): Promise<Task> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "프로젝트를 찾을 수 없습니다.");

    // OQ-2: 시점 task(isMilestone=true)는 자식 가질 수 없음 → parent가 시점 task면 거부
    if (dto.parentId) {
      const parent = await this.prisma.task.findUnique({
        where: { id: dto.parentId }, select: { isMilestone: true },
      });
      if (parent?.isMilestone) {
        throw new AppError(409, "MILESTONE_CANNOT_HAVE_CHILDREN",
          "시점 task는 자식 task를 가질 수 없습니다.");
      }
    }

    const task = await this.prisma.task.create({
      data: {
        projectId,
        parentId: dto.parentId ?? null,
        name: dto.name,
        description: dto.description ?? null,
        sortOrder: dto.sortOrder ?? 0,
        isMilestone: dto.isMilestone ?? false,
        isManualProgress: dto.isMilestone ? true : false,  // 시점은 PM 수동
        createdBy: requesterId,
      },
    });

    await this.logActivity(projectId, requesterId,
      "TASK_CREATED",
      "task", task.id,
      `태스크 추가: ${task.name}`,
      { taskName: task.name },
    );

    await this.aggregate.recomputeProject(projectId);
    await this.cache.invalidateProjectSummary(projectId);
    this.gateway.emitToProject(projectId, "task:created", { projectId, taskId: task.id });
    return task;
  }

  async updateTask(taskId: string, dto: UpdateTaskDto, requesterId: string): Promise<Task> {
    const existing = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!existing) throw new AppError(404, "TASK_NOT_FOUND", "태스크를 찾을 수 없습니다.");

    // 완료-작업일지-필수 검증 (수동 100%/DONE 진입 시 work log 1개 이상 필수)
    // - Q1=(1a) 둘 다 차단, Q2=(2b) 수동만, Q4=(4a) 1개라도 존재
    const enteringComplete =
      (dto.overallProgress !== undefined && dto.overallProgress >= 100 && existing.overallProgress < 100) ||
      (dto.status !== undefined && dto.status === "DONE" && existing.status !== "DONE");
    if (enteringComplete) {
      const hasWorkLog = await this.prisma.workLog.findFirst({
        where: { taskId, isDeleted: false },
        select: { id: true },
      });
      if (!hasWorkLog) {
        throw new AppError(409, "WORK_LOG_REQUIRED_FOR_COMPLETION",
          "태스크를 완료(100% 또는 DONE)로 표시하려면 작업일지가 1건 이상 필요합니다.");
      }
    }

    // OQ-2: parentId 변경 시 새 부모가 시점 task인지 확인
    if (dto.parentId !== undefined && dto.parentId) {
      const parent = await this.prisma.task.findUnique({
        where: { id: dto.parentId }, select: { isMilestone: true },
      });
      if (parent?.isMilestone) {
        throw new AppError(409, "MILESTONE_CANNOT_HAVE_CHILDREN",
          "시점 task는 자식 task를 가질 수 없습니다.");
      }
    }

    const updated = await this.prisma.task.update({
      where: { id: taskId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
        ...(dto.overallProgress !== undefined && { overallProgress: dto.overallProgress }),
        ...(dto.isManualProgress !== undefined && { isManualProgress: dto.isManualProgress }),
        ...(dto.parentId !== undefined && { parentId: dto.parentId }),
        ...(dto.isMilestone !== undefined && { isMilestone: dto.isMilestone }),
      },
    });

    // 의미있는 변경만 activity 기록 (sortOrder/parentId 단독 변경은 드래그 재정렬로 제외)
    if (dto.status !== undefined && dto.status !== existing.status) {
      await this.logActivity(existing.projectId, requesterId, "TASK_STATUS_CHANGED", "task", taskId,
        `상태 변경: ${STATUS_KO[existing.status] ?? existing.status} → ${STATUS_KO[dto.status] ?? dto.status}`,
        { taskName: existing.name, oldStatus: existing.status, newStatus: dto.status });
    } else if (dto.overallProgress !== undefined && dto.overallProgress !== existing.overallProgress) {
      await this.logActivity(existing.projectId, requesterId, "TASK_PROGRESS_CHANGED", "task", taskId,
        `진도율 변경: ${existing.overallProgress}% → ${dto.overallProgress}%`,
        { taskName: existing.name, oldProgress: existing.overallProgress, newProgress: dto.overallProgress });
    } else if (dto.name !== undefined && dto.name !== existing.name) {
      await this.logActivity(existing.projectId, requesterId, "TASK_RENAMED", "task", taskId,
        `이름 변경: ${existing.name} → ${dto.name}`,
        { taskName: existing.name, newName: dto.name });
    } else if (dto.description !== undefined && dto.description !== existing.description) {
      await this.logActivity(existing.projectId, requesterId, "TASK_NOTE_CHANGED", "task", taskId,
        `비고 변경`,
        { taskName: existing.name, note: dto.description ?? "" });
    }

    // 진도율·구조 변경 시 캐시 갱신 (이름/설명 변경은 영향 없음)
    if (dto.overallProgress !== undefined
        || dto.parentId !== undefined
        || dto.status !== undefined) {
      await this.aggregate.recomputeProject(existing.projectId);
    }

    await this.cache.invalidateProjectSummary(existing.projectId);
    this.gateway.emitToProject(existing.projectId, "task:updated", { projectId: existing.projectId, taskId });
    return updated;
  }

  async deleteTask(taskId: string, requesterId?: string): Promise<void> {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new AppError(404, "TASK_NOT_FOUND", "태스크를 찾을 수 없습니다.");

    if (requesterId) {
      await this.logActivity(task.projectId, requesterId, "TASK_DELETED", "task", taskId,
        `태스크 삭제: ${task.name}`,
        { taskName: task.name });
    }

    await this.prisma.task.delete({ where: { id: taskId } });
    await this.aggregate.recomputeProject(task.projectId);
    await this.cache.invalidateProjectSummary(task.projectId);
    this.gateway.emitToProject(task.projectId, "task:deleted", { projectId: task.projectId, taskId });
  }

  async createSegment(
    taskId: string,
    dto: CreateSegmentDto,
    requesterId: string,
  ): Promise<TaskSegment> {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: { segments: true },
    });
    if (!task) throw new AppError(404, "TASK_NOT_FOUND", "태스크를 찾을 수 없습니다.");

    let newStart = new Date(dto.startDate);
    let newEnd = new Date(dto.endDate);

    // 시점 task 검증: segment 1개만 허용 + start=end 강제
    if (task.isMilestone) {
      if (task.segments.length > 0) {
        throw new AppError(409, "MILESTONE_SINGLE_SEGMENT",
          "시점 task는 segment 1개만 허용됩니다.");
      }
      newEnd = newStart;  // 단일 시점 자동 보정
    }

    if (newStart > newEnd) {
      throw new AppError(400, "INVALID_DATE_RANGE", "시작일이 종료일보다 늦을 수 없습니다.");
    }

    // 같은 태스크 내 세그먼트 날짜 중복 검증
    const entity = new TaskEntity(
      task.id,
      task.projectId,
      task.name,
      task.status,
      task.overallProgress,
      task.isCritical,
      task.createdBy,
      task.segments as any,
    );

    if (entity.hasSegmentOverlap(newStart, newEnd)) {
      throw new AppError(409, "SEGMENT_DATE_OVERLAP", "같은 태스크 내 세그먼트 날짜가 중복됩니다.");
    }

    const segment = await this.prisma.taskSegment.create({
      data: {
        taskId,
        name: dto.name,
        startDate: newStart,
        endDate: newEnd,
        sortOrder: dto.sortOrder ?? task.segments.length,
      },
    });

    await this.prisma.taskScheduleHistory.create({
      data: {
        taskId,
        segmentId: segment.id,
        changedBy: requesterId,
        changeReason: "세그먼트 추가",
        changeType: "SEGMENT_ADDED",
        field: "segment",
        newValue: JSON.stringify({ name: segment.name, startDate: segment.startDate, endDate: segment.endDate }),
      },
    });

    await this.recalculateTaskProgress(taskId);
    await this.aggregate.recomputeTaskAndProject(taskId, task.projectId);
    await this.cache.invalidateProjectSummary(task.projectId);
    this.gateway.emitToProject(task.projectId, "segment:created", {
      projectId: task.projectId,
      taskId,
      segmentId: segment.id,
    });

    return segment;
  }

  async deleteSegment(segmentId: string, requesterId: string): Promise<void> {
    const segment = await this.prisma.taskSegment.findUnique({
      where: { id: segmentId },
      include: { task: true },
    });
    if (!segment) throw new AppError(404, "SEGMENT_NOT_FOUND", "세그먼트를 찾을 수 없습니다.");

    await this.prisma.taskScheduleHistory.create({
      data: {
        taskId: segment.taskId,
        segmentId,
        changedBy: requesterId,
        changeReason: "세그먼트 삭제",
        changeType: "SEGMENT_REMOVED",
        field: "segment",
        oldValue: JSON.stringify({ name: segment.name, startDate: segment.startDate, endDate: segment.endDate }),
      },
    });

    await this.prisma.taskSegment.delete({ where: { id: segmentId } });
    await this.recalculateTaskProgress(segment.taskId);
    await this.aggregate.recomputeTaskAndProject(segment.taskId, segment.task.projectId);
    await this.cache.invalidateProjectSummary(segment.task.projectId);
    this.gateway.emitToProject(segment.task.projectId, "segment:deleted", {
      projectId: segment.task.projectId,
      taskId: segment.taskId,
      segmentId,
    });
  }

  async updateSegment(
    segmentId: string,
    dto: UpdateSegmentDto,
    requesterId: string,
  ): Promise<TaskSegment> {
    const segment = await this.prisma.taskSegment.findUnique({
      where: { id: segmentId },
      include: { task: { include: { segments: true } } },
    });
    if (!segment) throw new AppError(404, "SEGMENT_NOT_FOUND", "세그먼트를 찾을 수 없습니다.");

    const newStart = dto.startDate ? new Date(dto.startDate) : segment.startDate;
    let newEnd = dto.endDate ? new Date(dto.endDate) : segment.endDate;

    // 시점 task: end = start 강제
    if (segment.task.isMilestone) {
      newEnd = newStart;
    }

    if (newStart > newEnd) {
      throw new AppError(400, "INVALID_DATE_RANGE", "시작일이 종료일보다 늦을 수 없습니다.");
    }

    // 날짜 변경 시 중복 검증
    if (dto.startDate || dto.endDate) {
      const entity = new TaskEntity(
        segment.task.id,
        segment.task.projectId,
        segment.task.name,
        segment.task.status,
        segment.task.overallProgress,
        segment.task.isCritical,
        segment.task.createdBy,
        segment.task.segments as any,
      );
      if (entity.hasSegmentOverlap(newStart, newEnd, segmentId)) {
        throw new AppError(409, "SEGMENT_DATE_OVERLAP", "같은 태스크 내 세그먼트 날짜가 중복됩니다.");
      }
    }

    // 완료-작업일지-필수 검증 (Q2=(2a) 변경: segment progressPercent 변경으로 task 100% 도달 시도도 차단)
    // - 다른 segment들 + 본 segment 새 값으로 평균 계산
    // - 100%로 도달하면서 task가 아직 미완료(< 100%, status != DONE)일 때만 검증
    if (dto.progressPercent !== undefined && !segment.task.isManualProgress) {
      const otherSegs = segment.task.segments.filter((s) => s.id !== segmentId);
      const newSegProgress = dto.progressPercent;
      const allProgressValues = [...otherSegs.map((s) => s.progressPercent), newSegProgress];
      const avg = allProgressValues.length > 0
        ? allProgressValues.reduce((a, b) => a + b, 0) / allProgressValues.length
        : 0;
      const taskWillBeComplete = avg >= 100;
      const taskWasComplete = segment.task.overallProgress >= 100 || segment.task.status === "DONE";
      if (taskWillBeComplete && !taskWasComplete) {
        const hasWorkLog = await this.prisma.workLog.findFirst({
          where: { taskId: segment.taskId, isDeleted: false },
          select: { id: true },
        });
        if (!hasWorkLog) {
          throw new AppError(409, "WORK_LOG_REQUIRED_FOR_COMPLETION",
            "이 변경으로 태스크가 완료(100%)에 도달합니다. 작업일지가 1건 이상 필요합니다.");
        }
      }
    }

    // 시점 task: startDate/endDate 어느 쪽 변경이든 둘 다 동기화
    const milestoneSync = segment.task.isMilestone && (dto.startDate !== undefined || dto.endDate !== undefined);
    const updated = await this.prisma.taskSegment.update({
      where: { id: segmentId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(milestoneSync
          ? { startDate: newStart, endDate: newEnd }
          : {
              ...(dto.startDate !== undefined && { startDate: newStart }),
              ...(dto.endDate !== undefined && { endDate: newEnd }),
            }),
        ...(dto.progressPercent !== undefined && { progressPercent: dto.progressPercent }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      },
    });

    // 변경 이력 기록
    const changes: Array<{ field: string; old: string; new: string }> = [];
    if (dto.startDate) changes.push({ field: "startDate", old: segment.startDate.toISOString(), new: newStart.toISOString() });
    if (dto.endDate) changes.push({ field: "endDate", old: segment.endDate.toISOString(), new: newEnd.toISOString() });
    if (dto.progressPercent !== undefined) changes.push({ field: "progressPercent", old: String(segment.progressPercent), new: String(dto.progressPercent) });

    for (const change of changes) {
      await this.prisma.taskScheduleHistory.create({
        data: {
          taskId: segment.taskId,
          segmentId,
          changedBy: requesterId,
          changeReason: dto.changeReason ?? "변경",
          changeType: change.field === "progressPercent" ? "PROGRESS_UPDATED" : "DATE_CHANGED",
          field: change.field,
          oldValue: change.old,
          newValue: change.new,
        },
      });
    }

    await this.recalculateTaskProgress(segment.taskId);
    await this.aggregate.recomputeTaskAndProject(segment.taskId, segment.task.projectId);
    await this.cache.invalidateProjectSummary(segment.task.projectId);

    // 활동 로그
    if (changes.length > 0) {
      const parts: string[] = [];
      if (dto.startDate || dto.endDate) parts.push("일정 변경");
      if (dto.progressPercent !== undefined) parts.push(`진도율 → ${dto.progressPercent}%`);
      await this.logActivity(
        segment.task.projectId, requesterId,
        "TASK_SCHEDULE_CHANGED", "task", segment.taskId,
        parts.join(" · "),
        { taskName: segment.task.name, segmentName: segment.name },
      );
    }

    // G-1: segment 업데이트 (특히 progressPercent) → milestone 갱신

    this.gateway.emitToProject(segment.task.projectId, "segment:updated", {
      projectId: segment.task.projectId,
      taskId: segment.taskId,
      segmentId,
    });

    return updated;
  }

  async upsertAssignment(
    segmentId: string,
    dto: UpsertAssignmentDto,
    requesterId: string,
  ): Promise<SegmentAssignment> {
    const segment = await this.prisma.taskSegment.findUnique({
      where: { id: segmentId },
      include: { task: true },
    });
    if (!segment) throw new AppError(404, "SEGMENT_NOT_FOUND", "세그먼트를 찾을 수 없습니다.");

    const assignment = await this.prisma.segmentAssignment.upsert({
      where: { segmentId_resourceId: { segmentId, resourceId: dto.resourceId } },
      create: {
        segmentId,
        resourceId: dto.resourceId,
        allocationMode: dto.allocationMode,
        allocationPercent: dto.allocationPercent ?? null,
        allocationHoursPerDay: dto.allocationHoursPerDay ?? null,
      },
      update: {
        allocationMode: dto.allocationMode,
        allocationPercent: dto.allocationPercent ?? null,
        allocationHoursPerDay: dto.allocationHoursPerDay ?? null,
      },
    });

    await this.prisma.taskScheduleHistory.create({
      data: {
        taskId: segment.taskId,
        segmentId,
        changedBy: requesterId,
        changeReason: "자원 배정 변경",
        changeType: "ASSIGNMENT_CHANGED",
        field: "assignment",
        newValue: JSON.stringify(dto),
      },
    });

    const resource = await this.prisma.resource.findUnique({ where: { id: dto.resourceId } });
    await this.logActivity(segment.task.projectId, requesterId, "ASSIGNMENT_CHANGED", "task", segment.taskId,
      `자원 배정: ${resource?.name ?? dto.resourceId}`,
      { taskName: segment.task.name, resourceName: resource?.name ?? dto.resourceId });

    await this.cache.invalidateProjectSummary(segment.task.projectId);
    return assignment;
  }

  async removeAssignment(segmentId: string, resourceId: string, requesterId?: string): Promise<void> {
    const segment = requesterId
      ? await this.prisma.taskSegment.findUnique({ where: { id: segmentId }, include: { task: true } })
      : null;

    await this.prisma.segmentAssignment.delete({
      where: { segmentId_resourceId: { segmentId, resourceId } },
    });

    if (requesterId && segment) {
      const resource = await this.prisma.resource.findUnique({ where: { id: resourceId } });
      await this.logActivity(segment.task.projectId, requesterId, "ASSIGNMENT_REMOVED", "task", segment.taskId,
        `자원 해제: ${resource?.name ?? resourceId}`,
        { taskName: segment.task.name, resourceName: resource?.name ?? resourceId });
    }
  }

  private async logActivity(
    projectId: string, userId: string, action: string,
    entityType: string, entityId: string, description: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.activityLog.create({
      data: { projectId, userId, action, entityType, entityId, description, ...(metadata ? { metadata } : {}) } as any,
    });
    this.gateway.emitToProject(projectId, "activity:created", { projectId });
  }

  async getHistory(taskId: string) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new AppError(404, "TASK_NOT_FOUND", "태스크를 찾을 수 없습니다.");

    return this.prisma.taskScheduleHistory.findMany({
      where: { taskId },
      orderBy: { changedAt: "desc" },
      take: 100,
    });
  }

  private async recalculateTaskProgress(taskId: string): Promise<void> {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: { segments: true },
    });
    if (!task) return;

    const entity = new TaskEntity(
      task.id,
      task.projectId,
      task.name,
      task.status,
      task.overallProgress,
      task.isCritical,
      task.createdBy,
      task.segments as any,
    );

    const newProgress = entity.calculateAutoProgress();

    // 진행율 기반 상태 자동 업데이트 (ON_HOLD, BLOCKED는 수동 상태이므로 유지)
    const autoStatuses = ["TODO", "IN_PROGRESS", "DONE"];
    let newStatus: string | undefined;
    if (autoStatuses.includes(task.status as string)) {
      if (newProgress >= 100) newStatus = "DONE";
      else if (newProgress > 0) newStatus = "IN_PROGRESS";
      else newStatus = "TODO";
    }

    await this.prisma.task.update({
      where: { id: taskId },
      data: {
        overallProgress: newProgress,
        ...(newStatus !== undefined && { status: newStatus as any }),
      },
    });

    // 프로젝트 상태 자동 동기화
    await this.syncProjectStatus(task.projectId);
  }

  private async syncProjectStatus(projectId: string): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        tasks: {
          select: { id: true, parentId: true, segments: { select: { progressPercent: true } } },
        },
      },
    });
    if (!project) return;

    // ON_HOLD / CANCELLED는 수동 상태이므로 유지
    if (project.status === "ON_HOLD" || project.status === "CANCELLED") return;

    const parentIds = new Set(project.tasks.map((t) => t.parentId).filter(Boolean));
    const leafSegments = project.tasks
      .filter((t) => !parentIds.has(t.id))
      .flatMap((t) => t.segments);

    if (leafSegments.length === 0) return;

    const avgProgress = leafSegments.reduce((s, seg) => s + seg.progressPercent, 0) / leafSegments.length;

    let newStatus: string;
    if (avgProgress >= 100) newStatus = "COMPLETED";
    else if (avgProgress > 0) newStatus = "IN_PROGRESS";
    else newStatus = "PLANNING";

    if (newStatus !== project.status) {
      await this.prisma.project.update({
        where: { id: projectId },
        data: { status: newStatus as any },
      });
    }
  }
}
