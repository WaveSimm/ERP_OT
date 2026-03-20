import { PrismaClient, ProjectTemplate, TemplateScope, AllocationMode } from "@prisma/client";
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
  milestoneGroup?: string;
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

export interface UpdateTemplateDto {
  name?: string;
  description?: string | null;
  category?: string;
  tags?: string[];
  scope?: TemplateScope;
  isRecommended?: boolean;
}

export interface InstantiateTemplateDto {
  projectName: string;
  startDate: string; // YYYY-MM-DD
  includeAssignments: boolean;
  taskIds?: string[]; // 부분 선택: TemplateTask IDs
  dateAdjustments?: {
    templateSegmentId: string;
    startDate: string;
    endDate: string;
  }[];
}

export interface SaveAsTemplateDto {
  name: string;
  category: string;
  tags?: string[];
  scope?: TemplateScope;
  includeAssignments: boolean;
}

// ─── 미리보기 응답 ────────────────────────────────────────────────────────────

export interface TemplatePreviewTask {
  templateTaskId: string;
  name: string;
  milestoneGroup: string | null;
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
            milestoneGroup: tt.milestoneGroup ?? null,
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
                type: (dep.type as any) ?? "FS",
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
      milestoneGroup: tt.milestoneGroup,
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

      // 마일스톤 그룹 처리
      const milestoneGroupMap = new Map<string, string>();
      for (const tt of tasks) {
        if (tt.milestoneGroup && !milestoneGroupMap.has(tt.milestoneGroup)) {
          const ms = await tx.milestone.create({
            data: {
              projectId: project.id,
              name: tt.milestoneGroup,
              sortOrder: milestoneGroupMap.size,
            },
          });
          milestoneGroupMap.set(tt.milestoneGroup, ms.id);
        }
      }

      // 태스크 생성 (1차: parentId 없이)
      const taskIdMap = new Map<string, string>(); // templateTaskId → taskId
      for (const tt of tasks) {
        const task = await tx.task.create({
          data: {
            projectId: project.id,
            milestoneId: tt.milestoneGroup
              ? (milestoneGroupMap.get(tt.milestoneGroup) ?? null)
              : null,
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

      // 3차: 의존 관계 복원
      for (const tt of tasks) {
        for (const dep of tt.predecessorDeps) {
          if (!selectedTemplateTaskIds.has(dep.predecessorTemplateTaskId)) continue;
          const predId = taskIdMap.get(dep.predecessorTemplateTaskId);
          const succId = taskIdMap.get(dep.successorTemplateTaskId);
          if (predId && succId) {
            await tx.taskDependency.create({
              data: {
                predecessorId: predId,
                successorId: succId,
                type: dep.type,
                lagDays: dep.lagDays,
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
            predecessorDeps: true,
          },
          orderBy: { sortOrder: "asc" },
        },
        milestones: true,
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

    // 마일스톤 이름 맵
    const milestoneNameMap = new Map(project.milestones.map((m) => [m.id, m.name]));

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

      // 1차: parentId 없이 모든 태스크 생성
      for (const task of project.tasks) {
        const tt = await tx.templateTask.create({
          data: {
            templateId: template.id,
            name: task.name,
            description: task.description ?? null,
            milestoneGroup: task.milestoneId
              ? (milestoneNameMap.get(task.milestoneId) ?? null)
              : null,
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

      // 3차: 의존 관계 저장 (task = 선행, dep.successorId = 후행)
      for (const task of project.tasks) {
        const predTemplateId = taskIdMap.get(task.id);
        if (!predTemplateId) continue;

        for (const dep of task.predecessorDeps) {
          const succTemplateId = taskIdMap.get(dep.successorId);
          if (!succTemplateId || succTemplateId === predTemplateId) continue;

          await tx.templateDependency.createMany({
            data: [{
              predecessorTemplateTaskId: predTemplateId,
              successorTemplateTaskId: succTemplateId,
              type: dep.type,
              lagDays: dep.lagDays,
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

  // ─── #25 마일스톤 복사 ───────────────────────────────────────────────────

  async copyMilestone(
    milestoneId: string,
    targetProjectId: string,
    options: { includeTasks: boolean; includeSegments: boolean; dateOffsetDays: number },
    userId: string,
  ) {
    const ms = await this.prisma.milestone.findUnique({
      where: { id: milestoneId },
      include: {
        tasks: {
          include: {
            segments: { include: { assignments: true }, orderBy: { sortOrder: "asc" } },
          },
          orderBy: { sortOrder: "asc" },
        },
      },
    });
    if (!ms) throw new AppError(404, "MILESTONE_NOT_FOUND", "마일스톤을 찾을 수 없습니다.");

    return this.prisma.$transaction(async (tx) => {
      const newMs = await tx.milestone.create({
        data: {
          projectId: targetProjectId,
          name: `${ms.name} (복사)`,
          description: ms.description ?? null,
          sortOrder: ms.sortOrder,
        },
      });

      if (options.includeTasks) {
        for (const task of ms.tasks) {
          const newTask = await tx.task.create({
            data: {
              projectId: targetProjectId,
              milestoneId: newMs.id,
              name: task.name,
              description: task.description ?? null,
              sortOrder: task.sortOrder,
              createdBy: userId,
            },
          });

          if (options.includeSegments) {
            for (const seg of task.segments) {
              const newStart = new Date(seg.startDate);
              const newEnd = new Date(seg.endDate);
              newStart.setDate(newStart.getDate() + options.dateOffsetDays);
              newEnd.setDate(newEnd.getDate() + options.dateOffsetDays);

              await tx.taskSegment.create({
                data: {
                  taskId: newTask.id,
                  name: seg.name,
                  sortOrder: seg.sortOrder,
                  startDate: newStart,
                  endDate: newEnd,
                },
              });
            }
          }
        }
      }

      return newMs;
    });
  }
}
