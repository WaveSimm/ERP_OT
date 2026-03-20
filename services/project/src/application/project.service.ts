import { PrismaClient, Project, ProjectStatus } from "@prisma/client";
import { AppError } from "@erp-ot/shared";
import { ProjectListFilter } from "../domain/repositories/project.repository.js";
import { ProjectCacheService } from "../infrastructure/cache/project.cache.js";
import { ProjectGateway } from "../infrastructure/websocket/project.gateway.js";

export interface CreateProjectDto {
  name: string;
  description?: string;
  plannedBudget?: number;
  templateId?: string;
  templateStartDate?: string;
  ownerId?: string; // 미지정 시 요청자
}

export interface UpdateProjectDto {
  name?: string;
  description?: string;
  status?: ProjectStatus;
  plannedBudget?: number;
  actualBudget?: number;
  ownerId?: string;
}

export interface ProjectListItem extends Omit<Project, never> {
  effectiveStartDate: string | null;
  effectiveEndDate: string | null;
  overallProgress: number | null;
}

function computeStatus(dbStatus: ProjectStatus, progress: number | null): ProjectStatus {
  // ON_HOLD / CANCELLED are explicit user overrides — preserve them
  if (dbStatus === ProjectStatus.ON_HOLD || dbStatus === ProjectStatus.CANCELLED) {
    return dbStatus;
  }
  if (progress === null) return dbStatus;
  if (progress >= 100) return ProjectStatus.COMPLETED;
  if (progress > 0)    return ProjectStatus.IN_PROGRESS;
  return ProjectStatus.PLANNING;
}

export class ProjectService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly cache: ProjectCacheService,
    private readonly gateway: ProjectGateway,
  ) {}

  async listProjects(
    filter: ProjectListFilter,
  ): Promise<{ items: ProjectListItem[]; total: number; page: number; limit: number }> {
    const page = filter.page ?? 1;
    const limit = Math.min(filter.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (filter.status) where.status = filter.status;
    if (filter.ownerId) where.ownerId = filter.ownerId;
    if (filter.search) {
      where.name = { contains: filter.search, mode: "insensitive" };
    }
    if (filter.groupId) {
      where.groupMemberships = { some: { groupId: filter.groupId } };
    }

    const [projects, total] = await this.prisma.$transaction([
      this.prisma.project.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updatedAt: "desc" },
        include: {
          tasks: {
            include: { segments: { select: { startDate: true, endDate: true, progressPercent: true } } },
          },
        },
      }),
      this.prisma.project.count({ where }),
    ]);

    const items: ProjectListItem[] = projects.map((p) => {
      const segments = p.tasks.flatMap((t) => t.segments);
      let effectiveStartDate: string | null = null;
      let effectiveEndDate: string | null = null;
      let overallProgress: number | null = null;

      if (segments.length > 0) {
        const starts = segments.map((s) => s.startDate.getTime());
        const ends   = segments.map((s) => s.endDate.getTime());
        effectiveStartDate = new Date(Math.min(...starts)).toISOString().slice(0, 10);
        effectiveEndDate   = new Date(Math.max(...ends)).toISOString().slice(0, 10);
        overallProgress    = segments.reduce((sum, s) => sum + s.progressPercent, 0) / segments.length;
      }

      const { tasks: _tasks, ...rest } = p as any;
      const status = computeStatus(rest.status, overallProgress);
      return { ...rest, status, effectiveStartDate, effectiveEndDate, overallProgress };
    });

    return { items, total, page, limit };
  }

  async getProject(id: string): Promise<Project> {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: { milestones: { orderBy: { sortOrder: "asc" } } },
    });
    if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "프로젝트를 찾을 수 없습니다.");
    return project;
  }

  async createProject(dto: CreateProjectDto, requesterId: string): Promise<Project> {
    const project = await this.prisma.project.create({
      data: {
        name: dto.name,
        description: dto.description ?? null,
        plannedBudget: dto.plannedBudget ?? null,
        ownerId: dto.ownerId ?? requesterId,
        createdBy: requesterId,
        status: ProjectStatus.PLANNING,
      },
    });

    // 템플릿으로부터 생성 시 태스크 인스턴스화
    if (dto.templateId && dto.templateStartDate) {
      await this.instantiateFromTemplate(project.id, dto.templateId, new Date(dto.templateStartDate), requesterId);
    }

    await this.logActivity(project.id, requesterId, "project.created", "Project", project.id,
      `프로젝트 [${project.name}]이 생성되었습니다.`);

    this.gateway.emitToProject(project.id, "project:created", { projectId: project.id });
    return project;
  }

  async updateProject(id: string, dto: UpdateProjectDto, requesterId: string): Promise<Project> {
    const existing = await this.prisma.project.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, "PROJECT_NOT_FOUND", "프로젝트를 찾을 수 없습니다.");

    const STATUS_KO: Record<string, string> = {
      PLANNING: "계획", IN_PROGRESS: "진행중", ON_HOLD: "보류", COMPLETED: "완료", CANCELLED: "취소",
    };

    const changes: string[] = [];
    if (dto.name !== undefined && dto.name !== existing.name)
      changes.push(`이름: ${existing.name} → ${dto.name}`);
    if (dto.status !== undefined && dto.status !== existing.status)
      changes.push(`상태: ${STATUS_KO[existing.status] ?? existing.status} → ${STATUS_KO[dto.status] ?? dto.status}`);
    if (dto.description !== undefined && dto.description !== existing.description)
      changes.push("설명 변경");
    if (dto.plannedBudget !== undefined && dto.plannedBudget !== (existing.plannedBudget ? Number(existing.plannedBudget) : null))
      changes.push("예산 변경");
    if (dto.ownerId !== undefined && dto.ownerId !== existing.ownerId)
      changes.push("담당자 변경");

    const updated = await this.prisma.project.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.plannedBudget !== undefined && { plannedBudget: dto.plannedBudget }),
        ...(dto.actualBudget !== undefined && { actualBudget: dto.actualBudget }),
        ...(dto.ownerId !== undefined && { ownerId: dto.ownerId }),
      },
    });

    await this.cache.invalidateProjectSummary(id);
    await this.logActivity(id, requesterId, "project.updated", "Project", id,
      changes.length > 0 ? changes.join(" · ") : "정보 수정",
      { projectName: updated.name, changes } as Record<string, unknown>);

    this.gateway.emitToProject(id, "project:updated", { projectId: id });
    return updated;
  }

  async deleteProject(id: string, requesterId: string): Promise<void> {
    const existing = await this.prisma.project.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, "PROJECT_NOT_FOUND", "프로젝트를 찾을 수 없습니다.");
    if (existing.status !== ProjectStatus.PLANNING) {
      throw new AppError(409, "PROJECT_NOT_DELETABLE", "진행 중인 프로젝트는 삭제할 수 없습니다.");
    }

    await this.prisma.project.delete({ where: { id } });
    await this.cache.invalidateProjectSummary(id);
    this.gateway.emitToAll("project:deleted", { projectId: id });
  }

  async cloneProject(
    id: string,
    options: {
      name: string;
      dateOffsetDays: number;
      includeSegments: boolean;
      includeAssignments: boolean;
      includeDependencies: boolean;
    },
    requesterId: string,
  ): Promise<Project> {
    const source = await this.prisma.project.findUnique({
      where: { id },
      include: {
        milestones: true,
        tasks: {
          include: {
            segments: {
              include: { assignments: true },
            },
            predecessorDeps: true,
          },
        },
      },
    });
    if (!source) throw new AppError(404, "PROJECT_NOT_FOUND", "프로젝트를 찾을 수 없습니다.");

    // 새 프로젝트 생성
    const newProject = await this.prisma.project.create({
      data: {
        name: options.name,
        description: source.description,
        plannedBudget: source.plannedBudget,
        ownerId: requesterId,
        createdBy: requesterId,
        status: ProjectStatus.PLANNING,
      },
    });

    // 마일스톤 복사
    const milestoneIdMap = new Map<string, string>();
    for (const ms of source.milestones) {
      const newMs = await this.prisma.milestone.create({
        data: {
          projectId: newProject.id,
          name: ms.name,
          description: ms.description,
          sortOrder: ms.sortOrder,
        },
      });
      milestoneIdMap.set(ms.id, newMs.id);
    }

    // 태스크 복사
    const taskIdMap = new Map<string, string>();
    for (const task of source.tasks) {
      const newTask = await this.prisma.task.create({
        data: {
          projectId: newProject.id,
          milestoneId: task.milestoneId ? (milestoneIdMap.get(task.milestoneId) ?? null) : null,
          name: task.name,
          description: task.description ?? null,
          sortOrder: task.sortOrder,
          createdBy: requesterId,
        },
      });
      taskIdMap.set(task.id, newTask.id);

      // 세그먼트 복사
      if (options.includeSegments) {
        for (const seg of task.segments) {
          const newStart = new Date(seg.startDate);
          const newEnd = new Date(seg.endDate);
          newStart.setDate(newStart.getDate() + options.dateOffsetDays);
          newEnd.setDate(newEnd.getDate() + options.dateOffsetDays);

          const newSeg = await this.prisma.taskSegment.create({
            data: {
              taskId: newTask.id,
              name: seg.name,
              sortOrder: seg.sortOrder,
              startDate: newStart,
              endDate: newEnd,
            },
          });

          // 배정 복사
          if (options.includeAssignments) {
            for (const assign of seg.assignments) {
              await this.prisma.segmentAssignment.create({
                data: {
                  segmentId: newSeg.id,
                  resourceId: assign.resourceId,
                  allocationMode: assign.allocationMode,
                  allocationPercent: assign.allocationPercent,
                  allocationHoursPerDay: assign.allocationHoursPerDay,
                },
              });
            }
          }
        }
      }
    }

    // 의존 관계 복사
    if (options.includeDependencies) {
      for (const task of source.tasks) {
        for (const dep of task.predecessorDeps) {
          const newPredId = taskIdMap.get(dep.predecessorId);
          const newSuccId = taskIdMap.get(dep.successorId);
          if (newPredId && newSuccId) {
            await this.prisma.taskDependency.create({
              data: {
                predecessorId: newPredId,
                successorId: newSuccId,
                type: dep.type,
                lagDays: dep.lagDays,
              },
            });
          }
        }
      }
    }

    this.gateway.emitToProject(newProject.id, "project:cloned", {
      sourceProjectId: id,
      newProjectId: newProject.id,
    });

    return newProject;
  }

  private async instantiateFromTemplate(
    projectId: string,
    templateId: string,
    startDate: Date,
    requesterId: string,
  ): Promise<void> {
    const template = await this.prisma.projectTemplate.findUnique({
      where: { id: templateId },
      include: {
        templateTasks: {
          include: {
            segments: { include: { assignments: true } },
            predecessorDeps: true,
          },
          orderBy: { sortOrder: "asc" },
        },
      },
    });
    if (!template) return;

    // 마일스톤 그룹 처리
    const milestoneGroupMap = new Map<string, string>();
    for (const tt of template.templateTasks) {
      if (tt.milestoneGroup && !milestoneGroupMap.has(tt.milestoneGroup)) {
        const ms = await this.prisma.milestone.create({
          data: { projectId, name: tt.milestoneGroup, sortOrder: milestoneGroupMap.size },
        });
        milestoneGroupMap.set(tt.milestoneGroup, ms.id);
      }
    }

    const taskIdMap = new Map<string, string>();
    for (const tt of template.templateTasks) {
      const task = await this.prisma.task.create({
        data: {
          projectId,
          milestoneId: tt.milestoneGroup ? (milestoneGroupMap.get(tt.milestoneGroup) ?? null) : null,
          name: tt.name,
          description: tt.description ?? null,
          sortOrder: tt.sortOrder,
          createdBy: requesterId,
        },
      });
      taskIdMap.set(tt.id, task.id);

      for (const ts of tt.segments) {
        const segStart = new Date(startDate);
        const segEnd = new Date(startDate);
        segStart.setDate(segStart.getDate() + ts.dayOffsetStart);
        segEnd.setDate(segEnd.getDate() + ts.dayOffsetEnd);

        const seg = await this.prisma.taskSegment.create({
          data: { taskId: task.id, name: ts.name, sortOrder: ts.sortOrder, startDate: segStart, endDate: segEnd },
        });

        for (const ta of ts.assignments) {
          if (ta.resourceId) {
            await this.prisma.segmentAssignment.create({
              data: {
                segmentId: seg.id,
                resourceId: ta.resourceId,
                allocationMode: ta.allocationMode,
                allocationPercent: ta.allocationPercent ?? null,
                allocationHoursPerDay: ta.allocationHoursPerDay ?? null,
              },
            });
          }
        }
      }
    }

    // 의존 관계 복원
    for (const tt of template.templateTasks) {
      for (const dep of tt.predecessorDeps) {
        const predId = taskIdMap.get(dep.predecessorTemplateTaskId);
        const succId = taskIdMap.get(dep.successorTemplateTaskId);
        if (predId && succId) {
          await this.prisma.taskDependency.create({
            data: { predecessorId: predId, successorId: succId, type: dep.type, lagDays: dep.lagDays },
          });
        }
      }
    }

    // 사용 카운트 증가
    await this.prisma.projectTemplate.update({
      where: { id: templateId },
      data: { usageCount: { increment: 1 } },
    });
  }

  // ─── Gantt 데이터 ─────────────────────────────────────────────────────────

  async getGanttData(projectId: string) {
    const project = await this.getProject(projectId);

    const tasks = await this.prisma.task.findMany({
      where: { projectId },
      include: {
        milestone: true,
        segments: {
          include: { assignments: true },
          orderBy: { sortOrder: "asc" },
        },
        predecessorDeps: true,
        _count: { select: { comments: true } },
      },
      orderBy: [{ sortOrder: "asc" }],
    });

    // 자원 이름 조회
    const resourceIds = [
      ...new Set(
        tasks.flatMap((t) => t.segments.flatMap((s) => s.assignments.map((a) => a.resourceId))),
      ),
    ];
    const resources =
      resourceIds.length > 0
        ? await this.prisma.resource.findMany({ where: { id: { in: resourceIds } } })
        : [];
    const resourceMap = new Map(resources.map((r) => [r.id, r.name]));

    // CPM 캐시에서 크리티컬 패스
    const cpmResult = await this.cache.getCpmResult<{ criticalPath: string[] }>(projectId);
    const criticalSet = new Set<string>(cpmResult?.criticalPath ?? []);

    // Gantt 태스크 조립
    const ganttTasks = tasks.map((task) => {
      const segs = task.segments;
      const allMs = segs.flatMap((s) => [s.startDate.getTime(), s.endDate.getTime()]);
      const effectiveStart = allMs.length > 0 ? new Date(Math.min(...allMs)) : null;
      const effectiveEnd = allMs.length > 0 ? new Date(Math.max(...allMs)) : null;

      // 항상 세그먼트 기반 계산 (isManualProgress 무시)
      const segProgress = segs.length > 0
        ? Math.round(segs.reduce((sum, s) => sum + s.progressPercent, 0) / segs.length * 10) / 10
        : task.overallProgress;

      // BLOCKED 는 수동 유지, 나머지는 진행률 기반 자동 결정
      const computedStatus = task.status === "BLOCKED"
        ? task.status
        : segProgress >= 100 ? "DONE"
        : segProgress > 0   ? "IN_PROGRESS"
        : "TODO";

      return {
        id: task.id,
        name: task.name,
        milestoneId: task.milestoneId,
        milestoneName: task.milestone?.name ?? null,
        parentId: task.parentId,
        sortOrder: task.sortOrder,
        status: computedStatus,
        overallProgress: segProgress,
        isManualProgress: task.isManualProgress,
        isMilestone: task.isMilestone,
        isCritical: task.isCritical || criticalSet.has(task.id),
        totalFloat: task.totalFloat,
        description: task.description ?? null,
        commentCount: task._count.comments,
        effectiveStartDate: effectiveStart?.toISOString().slice(0, 10) ?? null,
        effectiveEndDate: effectiveEnd?.toISOString().slice(0, 10) ?? null,
        segments: segs.map((s) => ({
          id: s.id,
          name: s.name,
          sortOrder: s.sortOrder,
          startDate: s.startDate.toISOString().slice(0, 10),
          endDate: s.endDate.toISOString().slice(0, 10),
          progressPercent: s.progressPercent,
          assignments: s.assignments.map((a) => ({
            resourceId: a.resourceId,
            resourceName: resourceMap.get(a.resourceId) ?? "알 수 없음",
            allocationMode: a.allocationMode,
            allocationPercent: a.allocationPercent,
            allocationHoursPerDay: a.allocationHoursPerDay,
            displayText:
              a.allocationMode === "PERCENT"
                ? `${a.allocationPercent ?? 0}%`
                : `${a.allocationHoursPerDay ?? 0}h/day`,
          })),
        })),
      };
    });

    const allDates = ganttTasks
      .flatMap((t) => [t.effectiveStartDate, t.effectiveEndDate])
      .filter((d): d is string => d !== null && d !== "");

    const allSegs = tasks.flatMap((t) => t.segments);
    const overallProgress =
      allSegs.length > 0
        ? Math.round(allSegs.reduce((sum, s) => sum + s.progressPercent, 0) / allSegs.length * 10) / 10
        : 0;

    return {
      project: {
        id: project.id,
        name: project.name,
        status: computeStatus(project.status, overallProgress),
        ownerId: project.ownerId,
        description: (project as any).description ?? null,
        effectiveStartDate: allDates.length > 0 ? allDates.reduce((a, b) => (a < b ? a : b)) : "",
        effectiveEndDate: allDates.length > 0 ? allDates.reduce((a, b) => (a > b ? a : b)) : "",
        overallProgress,
      },
      tasks: ganttTasks,
      dependencies: tasks.flatMap((t) =>
        t.predecessorDeps.map((d) => ({
          id: d.id,
          predecessorId: d.predecessorId,
          successorId: d.successorId,
          type: d.type,
          lagDays: d.lagDays,
        })),
      ),
      criticalPath: [...criticalSet],
    };
  }

  private async logActivity(
    projectId: string,
    userId: string,
    action: string,
    entityType: string,
    entityId: string,
    description: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.activityLog.create({
      data: { projectId, userId, action, entityType, entityId, description, metadata: (metadata ?? undefined) as any },
    });
  }
}
