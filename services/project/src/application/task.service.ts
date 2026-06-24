import { PrismaClient, Task, TaskStatus, ProjectStatus, TaskSegment, SegmentAssignment, AllocationMode, Prisma } from "@prisma/client";
import { AppError } from "@erp-ot/shared";
import { TaskEntity, calculateSegmentProgress } from "../domain/entities/task.entity.js";
import { ProjectCacheService } from "../infrastructure/cache/project.cache.js";
import { ProjectGateway } from "../infrastructure/websocket/project.gateway.js";
import { AggregateService } from "./aggregate.service.js";

const STATUS_KO: Record<string, string> = {
  TODO: "예정", IN_PROGRESS: "진행중", DONE: "완료", BLOCKED: "차단",
};

// 옵셔널 필드는 Zod `.optional()`이 산출하는 `T | undefined`와 정합하도록 명시
// (tsconfig exactOptionalPropertyTypes: true 환경)
export interface CreateTaskDto {
  parentId?: string | null | undefined;
  name: string;
  description?: string | null | undefined;
  sortOrder?: number | undefined;
  isMilestone?: boolean | undefined;
}

export interface UpdateTaskDto {
  name?: string | undefined;
  description?: string | null | undefined;
  status?: TaskStatus | undefined;
  parentId?: string | null | undefined;
  sortOrder?: number | undefined;
  overallProgress?: number | undefined;
  isManualProgress?: boolean | undefined;
  isMilestone?: boolean | undefined;
}

export interface CreateSegmentDto {
  name: string;
  startDate: string; // ISO date
  endDate: string;
  sortOrder?: number | undefined;
}

export interface UpdateSegmentDto {
  name?: string | undefined;
  startDate?: string | undefined;
  endDate?: string | undefined;
  progressPercent?: number | undefined;
  sortOrder?: number | undefined;
  changeReason?: string | undefined;
}

export interface UpsertAssignmentDto {
  resourceId: string;
  allocationMode: AllocationMode;
  allocationPercent?: number | undefined;
  allocationHoursPerDay?: number | undefined;
  contributionWeight?: number | undefined; // 자원-기여도-진척률: 분담율 0~100
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

    // 완료-작업일지-필수 검증 (DONE 진입 시 work log 1개 이상 필수)
    // 자원-기여도-진척률 (D2): 진척률 수동 입력 폐기 — overallProgress는 derived 라 status DONE 만 검증
    const enteringComplete =
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
        // 자원-기여도-진척률 (D2): overallProgress/isManualProgress 수동 입력 폐기 — 진척률은 derived
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

    const newStart = new Date(dto.startDate);
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
      task.segments,
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
      include: { task: { include: { segments: true } }, assignments: { select: { id: true } } },
    });
    if (!segment) throw new AppError(404, "SEGMENT_NOT_FOUND", "세그먼트를 찾을 수 없습니다.");

    // 자원-기여도-진척률 (D6): 진척률 직접 입력은 자원 0명 세그먼트에서만 허용.
    //   자원 1명↑이면 배정별 진척률(updateAssignmentProgress)로만 변경 — derived 캐시 보호.
    if (dto.progressPercent !== undefined && segment.assignments.length > 0) {
      throw new AppError(409, "SEGMENT_PROGRESS_DERIVED",
        "자원이 배정된 세그먼트의 진척률은 자원별 진척률로 자동 계산됩니다. 각 자원의 진척률을 수정하세요.");
    }

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
        segment.task.segments,
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

  // 자원-모델-분리 PDCA Phase 3a-5: dto.resourceId가 어느 카테고리인지 자동 판별
  // 우선순위: legacy Resource > EquipmentResource > ExternalPerson > AuthUser
  //   - legacy Resource: 기존 화면 호환 (Phase 4까지)
  //   - 나머지: 신규 분리 모델
  private async resolveResourceCategory(id: string): Promise<{
    category: "PERSON" | "EXTERNAL" | "EQUIPMENT";
    name: string;
    polymorphic: { personUserId?: string; externalPersonId?: string; equipmentResourceId?: string };
  } | null> {
    // Phase 5 (2026-05-13): legacy Resource 테이블 폐기. 3-카테고리 polymorphic만 사용
    // 1. EquipmentResource
    const eq = await this.prisma.equipmentResource.findUnique({ where: { id } });
    if (eq) return { category: "EQUIPMENT", name: eq.name, polymorphic: { equipmentResourceId: id } };
    // 3. ExternalPerson
    const ext = await this.prisma.externalPerson.findUnique({ where: { id } });
    if (ext) return { category: "EXTERNAL", name: ext.name, polymorphic: { externalPersonId: id } };
    // 4. AuthUser (cross-service)
    const authUrl = process.env.AUTH_SERVICE_URL ?? "http://auth-service:3001";
    const token = process.env.INTERNAL_API_TOKEN as string;
    try {
      const r = await fetch(`${authUrl}/internal/users/bulk?ids=${id}`, { headers: { "x-internal-token": token } });
      if (r.ok) {
        const map = (await r.json()) as Record<string, { name: string; email: string }>;
        if (map[id]) return { category: "PERSON", name: map[id]!.name, polymorphic: { personUserId: id } };
      }
    } catch { /* ignore */ }
    return null;
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

    const resolved = await this.resolveResourceCategory(dto.resourceId);
    if (!resolved) throw new AppError(404, "RESOURCE_NOT_FOUND", "자원을 찾을 수 없습니다.");

    const assignment = await this.prisma.segmentAssignment.upsert({
      where: { segmentId_resourceId: { segmentId, resourceId: dto.resourceId } },
      create: {
        segmentId,
        resourceId: dto.resourceId,
        // 신규 polymorphic FK (legacy는 빈 객체 — XOR violation 회피용으로 deprecated 그대로)
        ...resolved.polymorphic,
        allocationMode: dto.allocationMode,
        allocationPercent: dto.allocationPercent ?? null,
        allocationHoursPerDay: dto.allocationHoursPerDay ?? null,
        ...(dto.contributionWeight !== undefined && { contributionWeight: dto.contributionWeight }),
      },
      update: {
        allocationMode: dto.allocationMode,
        allocationPercent: dto.allocationPercent ?? null,
        allocationHoursPerDay: dto.allocationHoursPerDay ?? null,
        ...(dto.contributionWeight !== undefined && { contributionWeight: dto.contributionWeight }),
        ...resolved.polymorphic,
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

    await this.logActivity(segment.task.projectId, requesterId, "ASSIGNMENT_CHANGED", "task", segment.taskId,
      `자원 배정: ${resolved.name}`,
      { taskName: segment.task.name, resourceName: resolved.name });

    // 분담율 변경 가능 → 세그먼트 진척률(derived) 재계산
    await this.recalculateSegmentProgress(segmentId);
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

    // 자원 제거 → 세그먼트 진척률(derived) 재계산 (남은 배정 기준, 0개면 0/직접입력 fallback)
    await this.recalculateSegmentProgress(segmentId);

    if (requesterId && segment) {
      const resolved = await this.resolveResourceCategory(resourceId);
      const name = resolved?.name ?? resourceId;
      await this.logActivity(segment.task.projectId, requesterId, "ASSIGNMENT_REMOVED", "task", segment.taskId,
        `자원 해제: ${name}`,
        { taskName: segment.task.name, resourceName: name });
    }
  }

  private async logActivity(
    projectId: string, userId: string, action: string,
    entityType: string, entityId: string, description: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.activityLog.create({
      data: { projectId, userId, action, entityType, entityId, description, ...(metadata ? { metadata: metadata as Prisma.InputJsonValue } : {}) },
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

  // 자원-기여도-진척률: 세그먼트 진척률(derived) 재계산 → 태스크 롤업 연쇄
  //   배정 1개↑: Σ(분담율×자원진척)/Σ분담율. 배정 0개(D6): 직접 입력값 유지(덮어쓰지 않음).
  private async recalculateSegmentProgress(segmentId: string): Promise<void> {
    const segment = await this.prisma.taskSegment.findUnique({
      where: { id: segmentId },
      include: { assignments: true, task: true },
    });
    if (!segment) return;

    if (segment.assignments.length > 0) {
      const derived = calculateSegmentProgress(segment.assignments);
      if (derived !== segment.progressPercent) {
        await this.prisma.taskSegment.update({
          where: { id: segmentId },
          data: { progressPercent: derived },
        });
      }
    }

    await this.recalculateTaskProgress(segment.taskId);
    await this.aggregate.recomputeTaskAndProject(segment.taskId, segment.task.projectId);
    await this.cache.invalidateProjectSummary(segment.task.projectId);
    this.gateway.emitToProject(segment.task.projectId, "segment:updated", {
      projectId: segment.task.projectId,
      taskId: segment.taskId,
      segmentId,
    });
  }

  // 자원-기여도-진척률: 자원 본인 진척률 갱신 (본인/관리자 권한은 라우트에서 검증)
  async updateAssignmentProgress(
    segmentId: string,
    resourceId: string,
    progressPercent: number,
    requesterId: string,
    changeReason?: string,
  ): Promise<SegmentAssignment> {
    const assignment = await this.prisma.segmentAssignment.findUnique({
      where: { segmentId_resourceId: { segmentId, resourceId } },
      include: { segment: { include: { task: true } } },
    });
    if (!assignment) throw new AppError(404, "ASSIGNMENT_NOT_FOUND", "자원 배정을 찾을 수 없습니다.");

    const segment = assignment.segment;
    const task = segment.task;

    // 자원-기여도-진척률 (D3 개정): 진척률을 100%로 완료할 때, "그 자원 본인"의 작업일지 1건 이상 필수.
    //   각자 자기 작업 내역을 기록하게 강제하는 게 이 기능의 목적 → 요청자가 아니라 해당 자원(personUserId) 기준.
    //   PERSON 자원만 적용(외부인력/장비는 로그인·작업일지 개념 없음). 태스크/세그먼트 진척률은 derived라 별도 검증 없음.
    if (progressPercent >= 100 && assignment.progressPercent < 100 && assignment.personUserId) {
      const hasOwnWorkLog = await this.prisma.workLog.findFirst({
        where: { taskId: task.id, authorId: assignment.personUserId, isDeleted: false },
        select: { id: true },
      });
      if (!hasOwnWorkLog) {
        throw new AppError(409, "WORK_LOG_REQUIRED_FOR_COMPLETION",
          "진척률을 100%로 완료하려면 해당 자원 본인의 작업일지가 1건 이상 필요합니다.");
      }
    }

    const updated = await this.prisma.segmentAssignment.update({
      where: { segmentId_resourceId: { segmentId, resourceId } },
      data: { progressPercent },
    });

    await this.prisma.taskScheduleHistory.create({
      data: {
        taskId: task.id, segmentId, changedBy: requesterId,
        changeReason: changeReason ?? "자원 진척률 변경",
        changeType: "PROGRESS_UPDATED", field: "assignment.progressPercent",
        oldValue: String(assignment.progressPercent), newValue: String(progressPercent),
      },
    });
    await this.logActivity(task.projectId, requesterId, "TASK_SCHEDULE_CHANGED", "task", task.id,
      `자원 진척률 → ${progressPercent}%`,
      { taskName: task.name, segmentName: segment.name });

    await this.recalculateSegmentProgress(segmentId);
    return updated;
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
      task.segments,
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
        ...(newStatus !== undefined && { status: newStatus as TaskStatus }),
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
        data: { status: newStatus as ProjectStatus },
      });
    }
  }
}
