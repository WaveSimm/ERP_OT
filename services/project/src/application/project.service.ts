import { PrismaClient, Project, ProjectStatus, TaskStatus, Prisma } from "@prisma/client";
import { AppError } from "@erp-ot/shared";
import { resolveResourceNames } from "./shared/resource-name-resolver.js";
import { ProjectListFilter } from "../domain/repositories/project.repository.js";
import { ProjectCacheService } from "../infrastructure/cache/project.cache.js";
import { ProjectGateway } from "../infrastructure/websocket/project.gateway.js";

// 옵셔널 필드는 Zod `.optional()`이 산출하는 `T | undefined`와 정합 (exactOptionalPropertyTypes: true)
export interface CreateProjectDto {
  name: string;
  description?: string | undefined;
  plannedBudget?: number | undefined;
  templateId?: string | undefined;
  templateStartDate?: string | undefined;
  ownerId?: string | undefined; // 미지정 시 요청자
}

export interface UpdateProjectDto {
  name?: string | undefined;
  description?: string | null | undefined;
  status?: ProjectStatus | undefined;
  plannedBudget?: number | null | undefined;
  actualBudget?: number | null | undefined;
  ownerId?: string | undefined;
}

// ─── MS Planner 일괄 이관 (프로젝트 마이그레이션 탭) ──────────────────────────
//   단일 트랜잭션으로 프로젝트+태스크+세그먼트+배정+의존성을 생성.
//   순차 REST(태스크별 POST/PATCH)가 유발하던 recompute/락 부하를 회피한다.
export interface PlannerImportTask {
  outline: string;
  parentOutline: string | null;
  name: string;
  sortOrder: number;
  isMilestone: boolean;
  start: string | null; // YYYY-MM-DD
  end: string | null;
  progress: number; // 0~100
  hasSegment: boolean;
  assigneeIds: string[]; // 이미 매칭된 auth_user.id
  workLogs?: string[] | undefined; // 비고·메모 원문 → 작업일지(WorkLog)로 적재
}

export interface PlannerImportDto {
  name: string;
  ownerId: string;
  folderId?: string | undefined;
  metaProgress?: number | null | undefined; // 0~100
  tasks: PlannerImportTask[];
  deps: { predOutline: string; succOutline: string; type: string }[];
}

export interface PlannerImportResult {
  aborted: boolean;
  reason?: string;
  projectId?: string;
  tasks?: number;
  segments?: number;
  assignments?: number;
  dependencies?: number;
  workLogs?: number;
}

export interface ProjectListItem extends Omit<Project, "effectiveStartDate" | "effectiveEndDate" | "overallProgress"> {
  effectiveStartDate: string | null;
  effectiveEndDate: string | null;
  overallProgress: number | null;
  ownerName: string | null;
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
            select: {
              id: true,
              parentId: true,
              segments: { select: { startDate: true, endDate: true, progressPercent: true } },
            },
          },
        },
      }),
      this.prisma.project.count({ where }),
    ]);

    // owner 이름 일괄 조회
    const ownerIds = [...new Set(projects.map((p) => p.ownerId).filter(Boolean))];
    const ownerMap = new Map<string, string>();
    if (ownerIds.length > 0) {
      try {
        const authUrl = process.env.AUTH_SERVICE_URL ?? "http://auth-service:3001";
        const res = await fetch(
          `${authUrl}/internal/users/bulk?ids=${ownerIds.join(",")}`,
          // 보안 일괄패치 PDCA Layer 1 (C3): startup-time Zod env 검증으로 보장
          { headers: { "X-Internal-Token": process.env.INTERNAL_API_TOKEN as string } },
        );
        if (res.ok) {
          const data = (await res.json()) as Record<string, { name: string }>;
          Object.entries(data).forEach(([id, u]) => ownerMap.set(id, u.name));
        }
      } catch { /* owner 이름 조회 실패 시 무시 */ }
    }

    const items: ProjectListItem[] = projects.map((p) => {
      // 부모 역할을 하는 task id 집합 (자식이 있는 task)
      const parentIds = new Set(p.tasks.map((t) => t.parentId).filter(Boolean));
      // 리프 태스크 → 프론트엔드 rollup 기준과 동일 (Milestone은 별도 도메인)
      const segments = p.tasks
        .filter((t) => !parentIds.has(t.id))
        .flatMap((t) => t.segments);
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

      const { tasks: _tasks, ...rest } = p;
      const status = computeStatus(rest.status, overallProgress);
      return { ...rest, status, effectiveStartDate, effectiveEndDate, overallProgress, ownerName: ownerMap.get(p.ownerId) ?? null };
    });

    return { items, total, page, limit };
  }

  async getProject(id: string): Promise<Project> {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "프로젝트를 찾을 수 없습니다.");
    return project;
  }

  // 프로젝트-요약 (2026-06-24): 작성자·참여자·참여부서·자원현황 집계
  async getProjectSummary(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { tasks: { include: { segments: { include: { assignments: true } } } } },
    });
    if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "프로젝트를 찾을 수 없습니다.");

    // 진도율·기간 (리프 세그먼트 평균 — listProjects와 동일 기준)
    const parentIds = new Set(project.tasks.map((t) => t.parentId).filter(Boolean));
    const leafSegments = project.tasks.filter((t) => !parentIds.has(t.id)).flatMap((t) => t.segments);
    let startDate: string | null = null, endDate: string | null = null, overallProgress = 0;
    if (leafSegments.length > 0) {
      startDate = new Date(Math.min(...leafSegments.map((s) => s.startDate.getTime()))).toISOString().slice(0, 10);
      endDate = new Date(Math.max(...leafSegments.map((s) => s.endDate.getTime()))).toISOString().slice(0, 10);
      overallProgress = Math.round((leafSegments.reduce((sum, s) => sum + s.progressPercent, 0) / leafSegments.length) * 10) / 10;
    }

    // 자원별 집계 (모든 태스크의 세그먼트 배정)
    type Agg = { type: "PERSON" | "EXTERNAL" | "EQUIPMENT"; segmentCount: number; taskIds: Set<string>; weightSum: number; progressSum: number };
    const aggMap = new Map<string, Agg>();
    for (const t of project.tasks) {
      for (const s of t.segments) {
        for (const a of s.assignments) {
          const key = a.personUserId ?? a.externalPersonId ?? a.equipmentResourceId ?? a.resourceId;
          const type = a.personUserId ? "PERSON" : a.externalPersonId ? "EXTERNAL" : "EQUIPMENT";
          let agg = aggMap.get(key);
          if (!agg) { agg = { type, segmentCount: 0, taskIds: new Set(), weightSum: 0, progressSum: 0 }; aggMap.set(key, agg); }
          agg.segmentCount += 1;
          agg.taskIds.add(t.id);
          agg.weightSum += a.contributionWeight ?? 0;
          agg.progressSum += a.progressPercent ?? 0;
        }
      }
    }

    const personIds = [...aggMap].filter(([, v]) => v.type === "PERSON").map(([k]) => k);
    const externalIds = [...aggMap].filter(([, v]) => v.type === "EXTERNAL").map(([k]) => k);
    const equipmentIds = [...aggMap].filter(([, v]) => v.type === "EQUIPMENT").map(([k]) => k);

    // 직원 이름/부서 — auth 1회 조회 (작성자/소유자 이름도 같은 맵에서 해석)
    const userMap = new Map<string, { name: string; departmentName: string | null; departmentSortOrder: number }>();
    try {
      const authUrl = process.env.AUTH_SERVICE_URL ?? "http://auth-service:3001";
      const res = await fetch(`${authUrl}/internal/users/all-with-departments`, {
        headers: { "X-Internal-Token": process.env.INTERNAL_API_TOKEN as string },
      });
      if (res.ok) {
        const users = (await res.json()) as Array<{ id: string; name: string; departmentName: string | null; departmentSortOrder: number }>;
        for (const u of users) userMap.set(u.id, { name: u.name, departmentName: u.departmentName, departmentSortOrder: u.departmentSortOrder ?? 999 });
      }
    } catch { /* 이름/부서 조회 실패 시 graceful */ }

    const [externals, equipments] = await Promise.all([
      externalIds.length ? this.prisma.externalPerson.findMany({ where: { id: { in: externalIds } } }) : Promise.resolve([]),
      equipmentIds.length ? this.prisma.equipmentResource.findMany({ where: { id: { in: equipmentIds } } }) : Promise.resolve([]),
    ]);
    const extMap = new Map(externals.map((e) => [e.id, e]));
    const eqMap = new Map(equipments.map((e) => [e.id, e]));

    const participants = [...aggMap].map(([id, v]) => {
      const base = {
        resourceId: id, type: v.type,
        segmentCount: v.segmentCount, taskCount: v.taskIds.size,
        avgContribution: Math.round((v.weightSum / v.segmentCount) * 10) / 10,
        avgProgress: Math.round((v.progressSum / v.segmentCount) * 10) / 10,
      };
      if (v.type === "PERSON") {
        const u = userMap.get(id);
        return { ...base, name: u?.name ?? id, departmentName: u?.departmentName ?? null, company: null };
      }
      if (v.type === "EXTERNAL") {
        const e = extMap.get(id);
        return { ...base, name: e?.name ?? id, departmentName: null, company: e?.company ?? null };
      }
      const e = eqMap.get(id);
      return { ...base, name: e?.name ?? id, departmentName: null, company: null };
    }).sort((a, b) => b.taskCount - a.taskCount || a.name.localeCompare(b.name, "ko"));

    // 부서별 인원 (PERSON만)
    const deptCount = new Map<string, { count: number; sortOrder: number }>();
    for (const id of personIds) {
      const u = userMap.get(id);
      const dn = u?.departmentName ?? "부서 미지정";
      const cur = deptCount.get(dn) ?? { count: 0, sortOrder: u?.departmentSortOrder ?? 999 };
      cur.count += 1;
      deptCount.set(dn, cur);
    }
    const departments = [...deptCount].map(([name, v]) => ({ name, count: v.count, sortOrder: v.sortOrder }))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "ko"))
      .map(({ name, count }) => ({ name, count }));

    const today = new Date().toISOString().slice(0, 10);

    // 태스크 현황 (상태별 + 지연)
    const byStatus: Record<string, number> = {};
    let overdueTasks = 0;
    for (const t of project.tasks) {
      byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
      if (t.status !== "DONE" && t.status !== "CANCELLED" && t.segments.length > 0) {
        const maxEnd = t.segments.reduce((m, s) => (s.endDate > m ? s.endDate : m), t.segments[0]!.endDate);
        if (maxEnd.toISOString().slice(0, 10) < today) overdueTasks += 1;
      }
    }
    const taskStats = {
      total: project.tasks.length,
      done: byStatus["DONE"] ?? 0,
      inProgress: byStatus["IN_PROGRESS"] ?? 0,
      todo: byStatus["TODO"] ?? 0,
      blocked: byStatus["BLOCKED"] ?? 0,
      onHold: byStatus["ON_HOLD"] ?? 0,
      overdue: overdueTasks,
    };

    // 일정 대비 진척 (기간 경과율 vs 진도율)
    let schedule: { elapsedPercent: number; progressPercent: number; behindBy: number } | null = null;
    if (startDate && endDate) {
      const s = new Date(startDate).getTime();
      const e = new Date(endDate).getTime();
      const n = new Date(today).getTime();
      let elapsed = e > s ? ((n - s) / (e - s)) * 100 : (n >= e ? 100 : 0);
      elapsed = Math.max(0, Math.min(100, Math.round(elapsed * 10) / 10));
      schedule = { elapsedPercent: elapsed, progressPercent: overallProgress, behindBy: Math.round((elapsed - overallProgress) * 10) / 10 };
    }

    // 다가오는 마일스톤 (미완료 시점 중 가장 임박)
    const milestoneList = project.tasks
      .filter((t) => t.isMilestone && t.status !== "DONE" && t.segments.length > 0)
      .map((t) => ({ name: t.name, date: t.segments[0]!.endDate.toISOString().slice(0, 10) }))
      .sort((a, b) => a.date.localeCompare(b.date));
    const nm = milestoneList.find((m) => m.date >= today) ?? milestoneList[0];
    const nextMilestone = nm
      ? { name: nm.name, date: nm.date, dDay: Math.round((new Date(nm.date).getTime() - new Date(today).getTime()) / 86_400_000) }
      : null;

    return {
      id: project.id,
      name: project.name,
      status: project.status,
      description: project.description,
      overallProgress,
      startDate,
      endDate,
      taskStats,
      schedule,
      nextMilestone,
      milestoneCount: milestoneList.length,
      createdBy: project.createdBy,
      creatorName: userMap.get(project.createdBy)?.name ?? null,
      ownerId: project.ownerId,
      ownerName: userMap.get(project.ownerId)?.name ?? null,
      createdAt: project.createdAt.toISOString(),
      counts: { person: personIds.length, external: externalIds.length, equipment: equipmentIds.length, departments: departments.length },
      departments,
      participants,
    };
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
        tasks: {
          include: {
            segments: {
              include: { assignments: true },
            },
            predecessorOf: true,
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

    // 태스크 복사 (시점 task 포함)
    const taskIdMap = new Map<string, string>();
    for (const task of source.tasks) {
      const newTask = await this.prisma.task.create({
        data: {
          projectId: newProject.id,
          name: task.name,
          description: task.description ?? null,
          sortOrder: task.sortOrder,
          isMilestone: task.isMilestone,
          isManualProgress: task.isManualProgress,
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

    // 의존 관계 복사 (Task↔Task만)
    if (options.includeDependencies) {
      for (const task of source.tasks) {
        for (const dep of task.predecessorOf) {
          const newPredId = taskIdMap.get(dep.predecessorTaskId);
          const newSuccId = taskIdMap.get(dep.successorTaskId);
          if (newPredId && newSuccId) {
            await this.prisma.dependency.create({
              data: {
                predecessorTaskId: newPredId,
                successorTaskId: newSuccId,
                dependencyType: dep.dependencyType,
                lag: dep.lag,
                createdBy: requesterId,
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

    // milestoneGroup 폐기 — 템플릿 마일스톤 자동 생성 제거 (Plan 3a)
    // 필요하면 사용자가 인스턴스화 후 직접 마일스톤 추가

    const taskIdMap = new Map<string, string>();
    for (const tt of template.templateTasks) {
      const task = await this.prisma.task.create({
        data: {
          projectId,
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

    // 의존 관계 복원 (통합 Dependency 테이블)
    for (const tt of template.templateTasks) {
      for (const dep of tt.predecessorDeps) {
        const predId = taskIdMap.get(dep.predecessorTemplateTaskId);
        const succId = taskIdMap.get(dep.successorTemplateTaskId);
        if (predId && succId) {
          await this.prisma.dependency.create({
            data: {
              predecessorTaskId: predId,
              successorTaskId: succId,
              dependencyType: dep.type,
              lag: dep.lagDays,
              createdBy: requesterId,
            },
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

    const [tasks, dependencies] = await Promise.all([
      this.prisma.task.findMany({
        where: { projectId },
        include: {
          segments: {
            include: { assignments: true },
            orderBy: { sortOrder: "asc" },
          },
          _count: { select: { comments: true } },
          // 비고 열 = 최신 작업일지 1건 (workedAt DESC, 인덱스 [taskId,isDeleted,workedAt DESC])
          workLogs: {
            where: { isDeleted: false },
            orderBy: [{ workedAt: "desc" }, { createdAt: "desc" }],
            take: 1,
            select: { content: true, workedAt: true, authorName: true },
          },
        },
        orderBy: [{ sortOrder: "asc" }],
      }),
      this.prisma.dependency.findMany({
        where: { predecessorTask: { projectId } },
      }),
    ]);

    // 자원 이름 조회 — Phase 5 polymorphic resolver
    const resourceIds = tasks.flatMap((t) => t.segments.flatMap((s) => s.assignments.map((a) => a.resourceId)));
    const resourceMap = await resolveResourceNames(this.prisma, resourceIds);

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

      // 중단(ON_HOLD)은 수동 유지, 나머지는 진행률 기반 자동 결정
      const computedStatus = task.status === "ON_HOLD"
        ? task.status
        : segProgress >= 100 ? "DONE"
        : segProgress > 0   ? "IN_PROGRESS"
        : "TODO";

      return {
        id: task.id,
        name: task.name,
        parentId: task.parentId,
        sortOrder: task.sortOrder,
        status: computedStatus,
        overallProgress: segProgress,
        isManualProgress: task.isManualProgress,
        isMilestone: task.isMilestone,
        isCritical: task.isCritical || criticalSet.has(task.id),
        totalFloat: task.totalFloat,
        description: task.description ?? null,
        // 비고 열 표시용: 최신 작업일지(없으면 null → 프론트에서 description 폴백)
        latestWorkLog: task.workLogs[0]
          ? {
              content: task.workLogs[0].content,
              workedAt: task.workLogs[0].workedAt.toISOString().slice(0, 10),
              authorName: task.workLogs[0].authorName,
            }
          : null,
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
            contributionWeight: a.contributionWeight ?? 0,
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

    const parentIds = new Set(tasks.map((t) => t.parentId).filter(Boolean));
    const leafSegs = tasks
      .filter((t) => !parentIds.has(t.id))
      .flatMap((t) => t.segments);
    const overallProgress =
      leafSegs.length > 0
        ? Math.round(leafSegs.reduce((sum, s) => sum + s.progressPercent, 0) / leafSegs.length * 10) / 10
        : 0;

    return {
      project: {
        id: project.id,
        name: project.name,
        status: computeStatus(project.status, overallProgress),
        ownerId: project.ownerId,
        description: project.description ?? null,
        effectiveStartDate: allDates.length > 0 ? allDates.reduce((a, b) => (a < b ? a : b)) : "",
        effectiveEndDate: allDates.length > 0 ? allDates.reduce((a, b) => (a > b ? a : b)) : "",
        overallProgress,
      },
      tasks: ganttTasks,
      dependencies: dependencies.map((d) => ({
        id: d.id,
        predecessorTaskId: d.predecessorTaskId,
        successorTaskId: d.successorTaskId,
        dependencyType: d.dependencyType,
        lag: d.lag,
      })),
      criticalPath: [...criticalSet],
    };
  }

  /**
   * MS Planner 플랜을 단일 트랜잭션으로 일괄 적재. (scripts/planner-commit.js 로직을 서비스로 이관)
   *   멱등: 동일 이름 프로젝트가 있으면 적재하지 않고 aborted=true 반환.
   *   세그먼트/배정은 "날짜 있는 leaf"에만 생성. createdBy="planner-import" 표식.
   */
  async importPlanner(dto: PlannerImportDto, _requesterId: string): Promise<PlannerImportResult> {
    const dup = await this.prisma.project.findFirst({ where: { name: dto.name }, select: { id: true } });
    if (dup) return { aborted: true, reason: "DUPLICATE_NAME", projectId: dup.id };

    const parentSet = new Set(dto.tasks.map((t) => t.parentOutline).filter((o): o is string => !!o));
    const sorted = [...dto.tasks].sort((a, b) => {
      const da = (a.outline.match(/\./g) || []).length;
      const db = (b.outline.match(/\./g) || []).length;
      if (da !== db) return da - db; // 부모(얕은 깊이) 먼저
      return a.outline.localeCompare(b.outline, undefined, { numeric: true });
    });
    const allDates = dto.tasks.filter((t) => t.start && t.end).flatMap((t) => [t.start!, t.end!]).sort();
    const projStart = allDates.length ? new Date(allDates[0]!) : null;
    const projEnd = allDates.length ? new Date(allDates[allDates.length - 1]!) : null;
    const statusOf = (pct: number): ProjectStatus =>
      pct >= 100 ? ProjectStatus.COMPLETED : pct > 0 ? ProjectStatus.IN_PROGRESS : ProjectStatus.PLANNING;
    const taskStatusOf = (pct: number): TaskStatus =>
      pct >= 100 ? TaskStatus.DONE : pct > 0 ? TaskStatus.IN_PROGRESS : TaskStatus.TODO;

    const result = await this.prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          name: dto.name,
          status: dto.metaProgress != null ? statusOf(dto.metaProgress) : ProjectStatus.IN_PROGRESS,
          ownerId: dto.ownerId,
          createdBy: "planner-import",
          overallProgress: dto.metaProgress ?? null,
          effectiveStartDate: projStart,
          effectiveEndDate: projEnd,
        },
      });

      if (dto.folderId) {
        const itemCount = await tx.projectFolderItem.count({ where: { folderId: dto.folderId } });
        await tx.projectFolderItem.create({ data: { folderId: dto.folderId, projectId: project.id, sortOrder: itemCount } });
      }

      // 1) 태스크 (부모 먼저 — outlineToId 채워가며 parentId 연결)
      //    비고·메모는 작업일지(WorkLog)로 적재 (start가 있으면 그 날짜, 없으면 오늘).
      const outlineToId = new Map<string, string>();
      let wlCount = 0;
      for (const t of sorted) {
        const created = await tx.task.create({
          data: {
            projectId: project.id,
            parentId: t.parentOutline ? outlineToId.get(t.parentOutline) ?? null : null,
            name: t.name,
            status: taskStatusOf(t.progress),
            sortOrder: t.sortOrder || 0,
            overallProgress: t.progress || 0,
            isMilestone: t.isMilestone,
            createdBy: "planner-import",
            effectiveStartDate: t.start ? new Date(t.start) : null,
            effectiveEndDate: t.end ? new Date(t.end) : null,
          },
        });
        outlineToId.set(t.outline, created.id);

        if (t.workLogs?.length) {
          const workedAt = t.start ? new Date(t.start) : new Date();
          for (const content of t.workLogs) {
            await tx.workLog.create({
              data: {
                taskId: created.id,
                authorId: "planner-import",
                authorName: "MS Planner 이관",
                content,
                workedAt,
                isDeleted: false,
              },
            });
            wlCount++;
          }
        }
      }

      // 2) 세그먼트 + 배정 (leaf만)
      //   - 날짜 있는 leaf: 그 날짜로 세그먼트 생성
      //   - 날짜 없지만 담당자 있는 leaf: 배정(segmentAssignment)은 세그먼트에만 붙으므로,
      //     담당자가 누락되지 않도록 대체 날짜(작업→프로젝트→오늘)로 세그먼트를 만들어 배정.
      //   - 날짜도 담당자도 없는 leaf: 세그먼트 불필요 → skip
      const today = new Date();
      let segCount = 0;
      let asgCount = 0;
      for (const t of sorted) {
        if (parentSet.has(t.outline)) continue;
        const hasDates = !!(t.start && t.end);
        if (!hasDates && t.assigneeIds.length === 0) continue;
        const segStart = t.start ? new Date(t.start) : (projStart ?? today);
        const segEnd = t.end ? new Date(t.end) : (projEnd ?? today);
        const taskId = outlineToId.get(t.outline)!;
        const seg = await tx.taskSegment.create({
          data: {
            taskId,
            name: t.name.slice(0, 200),
            sortOrder: 0,
            startDate: segStart,
            endDate: segEnd,
            progressPercent: t.progress || 0,
          },
        });
        segCount++;
        const n = t.assigneeIds.length;
        for (const uid of t.assigneeIds) {
          await tx.segmentAssignment.create({
            data: {
              segmentId: seg.id,
              resourceId: uid,
              personUserId: uid,
              allocationMode: "PERCENT",
              allocationPercent: 100,
              contributionWeight: n ? Math.round((100 / n) * 100) / 100 : 0,
              progressPercent: t.progress || 0,
            },
          });
          asgCount++;
        }
      }

      // 3) 의존성 (Task↔Task)
      let depCount = 0;
      for (const d of dto.deps) {
        const predId = outlineToId.get(d.predOutline);
        const succId = outlineToId.get(d.succOutline);
        if (!predId || !succId || predId === succId) continue;
        await tx.dependency.create({
          data: {
            predecessorTaskId: predId,
            successorTaskId: succId,
            dependencyType: (["FS", "SS", "FF", "SF"].includes(d.type) ? d.type : "FS") as "FS" | "SS" | "FF" | "SF",
            lag: 0,
            createdBy: "planner-import",
          },
        });
        depCount++;
      }

      return { projectId: project.id, tasks: dto.tasks.length, segments: segCount, assignments: asgCount, dependencies: depCount, workLogs: wlCount };
    }, { maxWait: 15000, timeout: 120000 });

    await this.cache.invalidateProjectSummary(result.projectId);
    return { aborted: false, ...result };
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
      data: { projectId, userId, action, entityType, entityId, description, ...(metadata !== undefined ? { metadata: metadata as Prisma.InputJsonValue } : {}) },
    });
  }
}
