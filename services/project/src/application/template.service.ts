import { PrismaClient, ProjectTemplate, TemplateScope, AllocationMode, DependencyType } from "@prisma/client";
import { AppError } from "@erp-ot/shared";

// ─── DTOs ────────────────────────────────────────────────────────────────────

export interface CreateTemplateDto {
  name: string;
  description?: string;
  category: string;
  tags?: string[];
  scope?: TemplateScope;
  isRecommended?: boolean;
  tasks?: CreateTemplateTaskDto[];
}

export interface CreateTemplateTaskDto {
  name: string;
  description?: string;
  sortOrder?: number;
  segments?: CreateTemplateSegmentDto[];
  dependencies?: { predecessorIndex: number; type?: string; lagDays?: number }[];
}

export interface CreateTemplateSegmentDto {
  name: string;
  sortOrder?: number;
  dayOffsetStart: number;
  dayOffsetEnd: number;
  assignments?: {
    resourceRole?: string;
    resourceId?: string;
    allocationMode?: AllocationMode;
    allocationPercent?: number;
    allocationHoursPerDay?: number;
  }[];
}

// 옵셔널 필드는 Zod `.optional()`이 산출하는 `T | undefined`와 정합 (exactOptionalPropertyTypes: true)
export interface UpdateTemplateDto {
  name?: string | undefined;
  description?: string | null | undefined;
  category?: string | undefined;
  tags?: string[] | undefined;
  scope?: TemplateScope | undefined;
  isRecommended?: boolean | undefined;
}

export interface InstantiateTemplateDto {
  projectName: string;
  startDate: string; // YYYY-MM-DD
  includeAssignments: boolean;
  taskIds?: string[] | undefined; // 부분 선택: TemplateTask IDs
  dateAdjustments?: {
    templateSegmentId: string;
    startDate: string;
    endDate: string;
  }[] | undefined;
}

export interface SaveAsTemplateDto {
  name: string;
  category: string;
  tags?: string[] | undefined;
  scope?: TemplateScope | undefined;
  includeAssignments: boolean;
}

// ─── 미리보기 응답 ────────────────────────────────────────────────────────────

export interface TemplatePreviewTask {
  templateTaskId: string;
  name: string;
  sortOrder: number;
  segments: {
    templateSegmentId: string;
    name: string;
    startDate: string;
    endDate: string;
    dayOffsetStart: number;
    dayOffsetEnd: number;
  }[];
}

export class TemplateService {
  constructor(private readonly prisma: PrismaClient) {}

  // ─── #21 CRUD ─────────────────────────────────────────────────────────────

  async listTemplates(filter: {
    category?: string;
    scope?: TemplateScope;
    isRecommended?: boolean;
    search?: string;
  }) {
    const where: Record<string, unknown> = {};
    if (filter.category) where.category = filter.category;
    if (filter.scope) where.scope = filter.scope;
    if (filter.isRecommended !== undefined) where.isRecommended = filter.isRecommended;
    if (filter.search) where.name = { contains: filter.search, mode: "insensitive" };

    return this.prisma.projectTemplate.findMany({
      where,
      orderBy: [{ isRecommended: "desc" }, { usageCount: "desc" }, { createdAt: "desc" }],
      include: { _count: { select: { templateTasks: true } } },
    });
  }

  async getTemplate(id: string) {
    const template = await this.prisma.projectTemplate.findUnique({
      where: { id },
      include: {
        templateTasks: {
          include: {
            segments: { include: { assignments: true }, orderBy: { sortOrder: "asc" } },
            predecessorDeps: true,
            successorDeps: true,
          },
          orderBy: { sortOrder: "asc" },
        },
      },
    });
    if (!template) throw new AppError(404, "TEMPLATE_NOT_FOUND", "템플릿을 찾을 수 없습니다.");
    return template;
  }

  async createTemplate(dto: CreateTemplateDto, userId: string): Promise<ProjectTemplate> {
    return this.prisma.$transaction(async (tx) => {
      const template = await tx.projectTemplate.create({
        data: {
          name: dto.name,
          description: dto.description ?? null,
          category: dto.category,
          tags: dto.tags ?? [],
          scope: dto.scope ?? "PERSONAL",
          isRecommended: dto.isRecommended ?? false,
          createdBy: userId,
        },
      });

      const tasks = dto.tasks ?? [];
      const createdTaskIds: string[] = [];

      for (let i = 0; i < tasks.length; i++) {
        const tt = tasks[i]!;
        const templateTask = await tx.templateTask.create({
          data: {
            templateId: template.id,
            name: tt.name,
            description: tt.description ?? null,
            sortOrder: tt.sortOrder ?? i,
          },
        });
        createdTaskIds.push(templateTask.id);

        for (let j = 0; j < (tt.segments ?? []).length; j++) {
          const ts = (tt.segments ?? [])[j]!;
          const seg = await tx.templateSegment.create({
            data: {
              templateTaskId: templateTask.id,
              name: ts.name,
              sortOrder: ts.sortOrder ?? j,
              dayOffsetStart: ts.dayOffsetStart,
              dayOffsetEnd: ts.dayOffsetEnd,
            },
          });

          for (const ta of ts.assignments ?? []) {
            await tx.templateAssignment.create({
              data: {
                templateSegmentId: seg.id,
                resourceRole: ta.resourceRole ?? null,
                resourceId: ta.resourceId ?? null,
                allocationMode: ta.allocationMode ?? "PERCENT",
                allocationPercent: ta.allocationPercent ?? null,
                allocationHoursPerDay: ta.allocationHoursPerDay ?? null,
              },
            });
          }
        }
      }

      // 의존 관계 (index 기반)
      for (let i = 0; i < tasks.length; i++) {
        const tt = tasks[i]!;
        for (const dep of tt.dependencies ?? []) {
          const predId = createdTaskIds[dep.predecessorIndex];
          const succId = createdTaskIds[i];
          if (predId && succId && predId !== succId) {
            await tx.templateDependency.create({
              data: {
                predecessorTemplateTaskId: predId,
                successorTemplateTaskId: succId,
                type: (dep.type as DependencyType) ?? "FS",
                lagDays: dep.lagDays ?? 0,
              },
            });
          }
        }
      }

      return template;
    });
  }

  async updateTemplate(id: string, dto: UpdateTemplateDto): Promise<ProjectTemplate> {
    await this.getTemplate(id);
    return this.prisma.projectTemplate.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.tags !== undefined && { tags: dto.tags }),
        ...(dto.scope !== undefined && { scope: dto.scope }),
        ...(dto.isRecommended !== undefined && { isRecommended: dto.isRecommended }),
      },
    });
  }

  async deleteTemplate(id: string): Promise<void> {
    await this.getTemplate(id);
    await this.prisma.projectTemplate.delete({ where: { id } });
  }

  // ─── #23 미리보기 (저장 없음) ──────────────────────────────────────────────

  async preview(
    templateId: string,
    startDate: string,
    taskIds?: string[],
  ): Promise<{ tasks: TemplatePreviewTask[]; projectEnd: string }> {
    const template = await this.getTemplate(templateId);
    const base = new Date(startDate);

    let tasks = template.templateTasks;
    if (taskIds && taskIds.length > 0) {
      tasks = tasks.filter((t) => taskIds.includes(t.id));
    }

    const previewTasks: TemplatePreviewTask[] = tasks.map((tt) => ({
      templateTaskId: tt.id,
      name: tt.name,
      sortOrder: tt.sortOrder,
      segments: tt.segments.map((ts) => {
        const segStart = new Date(base);
        const segEnd = new Date(base);
        segStart.setDate(segStart.getDate() + ts.dayOffsetStart);
        segEnd.setDate(segEnd.getDate() + ts.dayOffsetEnd);
        return {
          templateSegmentId: ts.id,
          name: ts.name,
          startDate: segStart.toISOString().slice(0, 10),
          endDate: segEnd.toISOString().slice(0, 10),
          dayOffsetStart: ts.dayOffsetStart,
          dayOffsetEnd: ts.dayOffsetEnd,
        };
      }),
    }));

    // 프로젝트 예상 완료일
    const allOffsets = template.templateTasks
      .flatMap((tt) => tt.segments.map((ts) => ts.dayOffsetEnd));
    const maxOffset = allOffsets.length > 0 ? Math.max(...allOffsets) : 0;
    const projectEnd = new Date(base);
    projectEnd.setDate(projectEnd.getDate() + maxOffset);

    return { tasks: previewTasks, projectEnd: projectEnd.toISOString().slice(0, 10) };
  }

  // ─── #22 인스턴스화 ────────────────────────────────────────────────────────

  async instantiate(
    templateId: string,
    dto: InstantiateTemplateDto,
    userId: string,
  ) {
    const template = await this.getTemplate(templateId);
    const base = new Date(dto.startDate);

    // dateAdjustments 맵
    const adjustMap = new Map(
      (dto.dateAdjustments ?? []).map((a) => [a.templateSegmentId, a]),
    );

    let tasks = template.templateTasks;
    if (dto.taskIds && dto.taskIds.length > 0) {
      tasks = tasks.filter((t) => dto.taskIds!.includes(t.id));
    }

    return this.prisma.$transaction(async (tx) => {
      // 프로젝트 생성
      const project = await tx.project.create({
        data: {
          name: dto.projectName,
          ownerId: userId,
          createdBy: userId,
          status: "PLANNING",
        },
      });

      // milestoneGroup 폐기 — 템플릿에서 자동 마일스톤 생성 제거 (Plan 3a)

      // 태스크 생성 (1차: parentId 없이)
      const taskIdMap = new Map<string, string>(); // templateTaskId → taskId
      for (const tt of tasks) {
        const task = await tx.task.create({
          data: {
            projectId: project.id,
            name: tt.name,
            description: tt.description ?? null,
            sortOrder: tt.sortOrder,
            createdBy: userId,
          },
        });
        taskIdMap.set(tt.id, task.id);

        for (const ts of tt.segments) {
          const adj = adjustMap.get(ts.id);
          const segStart = adj ? new Date(adj.startDate) : (() => {
            const d = new Date(base); d.setDate(d.getDate() + ts.dayOffsetStart); return d;
          })();
          const segEnd = adj ? new Date(adj.endDate) : (() => {
            const d = new Date(base); d.setDate(d.getDate() + ts.dayOffsetEnd); return d;
          })();

          const seg = await tx.taskSegment.create({
            data: {
              taskId: task.id,
              name: ts.name,
              sortOrder: ts.sortOrder,
              startDate: segStart,
              endDate: segEnd,
            },
          });

          if (dto.includeAssignments) {
            for (const ta of ts.assignments) {
              if (ta.resourceId) {
                await tx.segmentAssignment.create({
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
      }

      // 2차: 상하위 관계 복원
      const selectedTemplateTaskIds = new Set(tasks.map((t) => t.id));
      for (const tt of tasks) {
        if (!tt.parentId || !selectedTemplateTaskIds.has(tt.parentId)) continue;
        const parentTaskId = taskIdMap.get(tt.parentId);
        const childTaskId = taskIdMap.get(tt.id);
        if (parentTaskId && childTaskId) {
          await tx.task.update({
            where: { id: childTaskId },
            data: { parentId: parentTaskId },
          });
        }
      }

      // 3차: 의존 관계 복원 (통합 Dependency)
      for (const tt of tasks) {
        for (const dep of tt.predecessorDeps) {
          if (!selectedTemplateTaskIds.has(dep.predecessorTemplateTaskId)) continue;
          const predId = taskIdMap.get(dep.predecessorTemplateTaskId);
          const succId = taskIdMap.get(dep.successorTemplateTaskId);
          if (predId && succId) {
            await tx.dependency.create({
              data: {
                predecessorTaskId: predId,
                successorTaskId: succId,
                dependencyType: dep.type,
                lag: dep.lagDays,
                createdBy: userId,
              },
            });
          }
        }
      }

      // 사용 카운트 증가
      await tx.projectTemplate.update({
        where: { id: templateId },
        data: { usageCount: { increment: 1 } },
      });

      return project;
    });
  }

  // ─── #24 save-as-template (역방향) ────────────────────────────────────────

  async saveAsTemplate(
    projectId: string,
    dto: SaveAsTemplateDto,
    userId: string,
  ): Promise<ProjectTemplate> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        tasks: {
          include: {
            segments: { include: { assignments: true }, orderBy: { sortOrder: "asc" } },
            predecessorOf: true,
          },
          orderBy: { sortOrder: "asc" },
        },
      },
    });
    if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "프로젝트를 찾을 수 없습니다.");

    // 프로젝트 시작일 (전체 세그먼트 중 최솟값)
    const allStartDates = project.tasks
      .flatMap((t) => t.segments.map((s) => s.startDate.getTime()))
      .filter((d) => !isNaN(d));

    if (allStartDates.length === 0) {
      throw new AppError(400, "NO_SEGMENTS", "세그먼트가 없는 프로젝트는 템플릿으로 저장할 수 없습니다.");
    }

    const projectStartMs = Math.min(...allStartDates);
    const MS_PER_DAY = 86_400_000;

    return this.prisma.$transaction(async (tx) => {
      const template = await tx.projectTemplate.create({
        data: {
          name: dto.name,
          category: dto.category,
          tags: dto.tags ?? [],
          scope: dto.scope ?? "PERSONAL",
          sourceProjectId: projectId,
          createdBy: userId,
        },
      });

      const taskIdMap = new Map<string, string>(); // projectTaskId → templateTaskId

      // 1차: parentId 없이 모든 태스크 생성 (milestoneGroup 폐기)
      for (const task of project.tasks) {
        const tt = await tx.templateTask.create({
          data: {
            templateId: template.id,
            name: task.name,
            description: task.description ?? null,
            sortOrder: task.sortOrder,
          },
        });
        taskIdMap.set(task.id, tt.id);

        for (const seg of task.segments) {
          const dayOffsetStart = Math.round(
            (seg.startDate.getTime() - projectStartMs) / MS_PER_DAY,
          );
          const dayOffsetEnd = Math.round(
            (seg.endDate.getTime() - projectStartMs) / MS_PER_DAY,
          );

          const ts = await tx.templateSegment.create({
            data: {
              templateTaskId: tt.id,
              name: seg.name,
              sortOrder: seg.sortOrder,
              dayOffsetStart,
              dayOffsetEnd,
            },
          });

          if (dto.includeAssignments) {
            for (const a of seg.assignments) {
              await tx.templateAssignment.create({
                data: {
                  templateSegmentId: ts.id,
                  resourceId: a.resourceId,
                  allocationMode: a.allocationMode,
                  allocationPercent: a.allocationPercent ?? null,
                  allocationHoursPerDay: a.allocationHoursPerDay ?? null,
                },
              });
            }
          }
        }
      }

      // 2차: 상하위 관계 저장
      for (const task of project.tasks) {
        if (!task.parentId) continue;
        const childTemplateId = taskIdMap.get(task.id);
        const parentTemplateId = taskIdMap.get(task.parentId);
        if (childTemplateId && parentTemplateId) {
          await tx.templateTask.update({
            where: { id: childTemplateId },
            data: { parentId: parentTemplateId },
          });
        }
      }

      // 3차: 의존 관계 저장 (통합 Dependency — Task↔Task만 템플릿화)
      for (const task of project.tasks) {
        const predTemplateId = taskIdMap.get(task.id);
        if (!predTemplateId) continue;

        for (const dep of task.predecessorOf) {
          // Task↔Task만 템플릿화 (Milestone은 인스턴스마다 다시 그림)
          if (!dep.successorTaskId) continue;
          const succTemplateId = taskIdMap.get(dep.successorTaskId);
          if (!succTemplateId || succTemplateId === predTemplateId) continue;

          await tx.templateDependency.createMany({
            data: [{
              predecessorTemplateTaskId: predTemplateId,
              successorTemplateTaskId: succTemplateId,
              type: dep.dependencyType,
              lagDays: dep.lag,
            }],
            skipDuplicates: true,
          });
        }
      }

      return template;
    });
  }

  // ─── #25 태스크 복사 ─────────────────────────────────────────────────────

  async copyTask(
    taskId: string,
    targetProjectId: string,
    options: { includeSegments: boolean; includeAssignments: boolean; dateOffsetDays: number },
    userId: string,
  ) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        segments: { include: { assignments: true }, orderBy: { sortOrder: "asc" } },
      },
    });
    if (!task) throw new AppError(404, "TASK_NOT_FOUND", "태스크를 찾을 수 없습니다.");

    return this.prisma.$transaction(async (tx) => {
      const newTask = await tx.task.create({
        data: {
          projectId: targetProjectId,
          name: `${task.name} (복사)`,
          description: task.description ?? null,
          sortOrder: task.sortOrder,
          isMilestone: task.isMilestone,
          createdBy: userId,
        },
      });

      if (options.includeSegments) {
        for (const seg of task.segments) {
          const newStart = new Date(seg.startDate);
          const newEnd = new Date(seg.endDate);
          newStart.setDate(newStart.getDate() + options.dateOffsetDays);
          newEnd.setDate(newEnd.getDate() + options.dateOffsetDays);

          const newSeg = await tx.taskSegment.create({
            data: {
              taskId: newTask.id,
              name: seg.name,
              sortOrder: seg.sortOrder,
              startDate: newStart,
              endDate: newEnd,
            },
          });

          if (options.includeAssignments) {
            for (const a of seg.assignments) {
              await tx.segmentAssignment.create({
                data: {
                  segmentId: newSeg.id,
                  resourceId: a.resourceId,
                  allocationMode: a.allocationMode,
                  allocationPercent: a.allocationPercent ?? null,
                  allocationHoursPerDay: a.allocationHoursPerDay ?? null,
                },
              });
            }
          }
        }
      }

      return newTask;
    });
  }

  // ─── #25 다중 태스크 복사 (계층 보존) ─────────────────────────────────────
  // 선택한 task들 내부의 parent-child 관계는 그대로 복제하되,
  // 선택 세트 외부에 있는 부모를 가진 task는 대상 프로젝트의 top-level로 들어감.
  // 단일 트랜잭션 + 위상정렬(parent 먼저 생성) + oldId→newId 매핑.
  async copyTasks(
    taskIds: string[],
    targetProjectId: string,
    options: { includeSegments: boolean; includeAssignments: boolean; dateOffsetDays: number },
    userId: string,
  ) {
    if (taskIds.length === 0) {
      return { count: 0, idMap: {} as Record<string, string> };
    }

    const sourceTasks = await this.prisma.task.findMany({
      where: { id: { in: taskIds } },
      include: {
        segments: { include: { assignments: true }, orderBy: { sortOrder: "asc" } },
      },
    });

    if (sourceTasks.length !== taskIds.length) {
      const found = new Set(sourceTasks.map((t) => t.id));
      const missing = taskIds.filter((id) => !found.has(id));
      throw new AppError(404, "TASK_NOT_FOUND", `복사할 태스크를 찾을 수 없습니다: ${missing.join(", ")}`);
    }

    const selectedSet = new Set(taskIds);
    const taskById = new Map(sourceTasks.map((t) => [t.id, t]));

    // 선택 세트 안에서의 깊이 (parent가 선택 세트에 없으면 깊이 0)
    const depthMemo = new Map<string, number>();
    const computeDepth = (id: string, visiting = new Set<string>()): number => {
      if (depthMemo.has(id)) return depthMemo.get(id)!;
      if (visiting.has(id)) return 0;
      visiting.add(id);
      const task = taskById.get(id);
      const parentId = task?.parentId;
      const d = parentId && selectedSet.has(parentId) ? 1 + computeDepth(parentId, visiting) : 0;
      depthMemo.set(id, d);
      return d;
    };
    for (const t of sourceTasks) computeDepth(t.id);

    // 부모 먼저 생성 (depth asc), 동일 깊이는 sortOrder asc
    const sorted = [...sourceTasks].sort((a, b) => {
      const da = depthMemo.get(a.id) ?? 0;
      const db = depthMemo.get(b.id) ?? 0;
      if (da !== db) return da - db;
      return a.sortOrder - b.sortOrder;
    });

    // 대상 프로젝트의 현재 top-level sortOrder 최댓값 — 새 top-level task들은 그 다음에 append
    const maxTopLevel = await this.prisma.task.aggregate({
      where: { projectId: targetProjectId, parentId: null },
      _max: { sortOrder: true },
    });
    let nextTopLevelSortOrder = (maxTopLevel._max.sortOrder ?? 0) + 1;

    return this.prisma.$transaction(async (tx) => {
      const idMap = new Map<string, string>();

      for (const task of sorted) {
        const newParentId =
          task.parentId && selectedSet.has(task.parentId) ? idMap.get(task.parentId) ?? null : null;

        // top-level이면 대상 프로젝트 끝에 append, 아니면 원본 sortOrder 보존(같은 새 부모 아래 형제 순서 유지)
        const newSortOrder = newParentId === null ? nextTopLevelSortOrder++ : task.sortOrder;

        const newTask = await tx.task.create({
          data: {
            projectId: targetProjectId,
            parentId: newParentId,
            name: `${task.name} (복사)`,
            description: task.description ?? null,
            sortOrder: newSortOrder,
            isMilestone: task.isMilestone,
            createdBy: userId,
          },
        });
        idMap.set(task.id, newTask.id);

        if (options.includeSegments) {
          for (const seg of task.segments) {
            const newStart = new Date(seg.startDate);
            const newEnd = new Date(seg.endDate);
            newStart.setDate(newStart.getDate() + options.dateOffsetDays);
            newEnd.setDate(newEnd.getDate() + options.dateOffsetDays);

            const newSeg = await tx.taskSegment.create({
              data: {
                taskId: newTask.id,
                name: seg.name,
                sortOrder: seg.sortOrder,
                startDate: newStart,
                endDate: newEnd,
              },
            });

            if (options.includeAssignments) {
              for (const a of seg.assignments) {
                await tx.segmentAssignment.create({
                  data: {
                    segmentId: newSeg.id,
                    resourceId: a.resourceId,
                    allocationMode: a.allocationMode,
                    allocationPercent: a.allocationPercent ?? null,
                    allocationHoursPerDay: a.allocationHoursPerDay ?? null,
                  },
                });
              }
            }
          }
        }
      }

      return {
        count: sorted.length,
        idMap: Object.fromEntries(idMap) as Record<string, string>,
      };
    });
  }

  // ─── #25 마일스톤 복사 ───────────────────────────────────────────────────
  // (이전: 마일스톤 모델 → 시점 task로 회귀. copyMilestone은 task 복제로 처리)

  async copyMilestone(
    milestoneId: string,
    targetProjectId: string,
    options: { dateOffsetDays: number },
    userId: string,
  ) {
    // 마일스톤은 이제 isMilestone=true Task — task 복제 호출
    return this.copyTask(milestoneId, targetProjectId, {
      includeSegments: true,
      includeAssignments: false,
      dateOffsetDays: options.dateOffsetDays,
    }, userId);
  }
}
