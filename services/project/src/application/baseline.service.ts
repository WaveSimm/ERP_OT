import { PrismaClient, ProjectBaseline } from "@prisma/client";
import { AppError } from "@erp-ot/shared";

export interface CreateBaselineDto {
  name: string;
  reason: string;
}

export interface TaskBaselineDiff {
  taskId: string;
  taskName: string;
  baseline: {
    effectiveStart: string;
    effectiveEnd: string;
    segments: { name: string; startDate: string; endDate: string }[];
  };
  current: {
    effectiveStart: string;
    effectiveEnd: string;
    segments: { name: string; startDate: string; endDate: string }[];
  } | null; // null = 태스크 삭제됨
  deviationDays: number;
  status: "AHEAD" | "ON_TRACK" | "DELAYED" | "REMOVED";
}

export class BaselineService {
  constructor(private readonly prisma: PrismaClient) {}

  async listBaselines(projectId: string): Promise<ProjectBaseline[]> {
    return this.prisma.projectBaseline.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    });
  }

  async getBaseline(baselineId: string) {
    const baseline = await this.prisma.projectBaseline.findUnique({
      where: { id: baselineId },
      include: {
        taskBaselines: {
          include: { segmentSnapshots: true },
        },
      },
    });
    if (!baseline) throw new AppError(404, "BASELINE_NOT_FOUND", "기준선을 찾을 수 없습니다.");
    return baseline;
  }

  // ─── #18 스냅샷 저장 (벌크 INSERT) ─────────────────────────────────────────

  async createBaseline(
    projectId: string,
    dto: CreateBaselineDto,
    userId: string,
  ): Promise<ProjectBaseline> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "프로젝트를 찾을 수 없습니다.");

    // 현재 태스크 + 세그먼트 + 배정 스냅샷
    const tasks = await this.prisma.task.findMany({
      where: { projectId },
      include: {
        segments: {
          include: { assignments: true },
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    return this.prisma.$transaction(async (tx) => {
      const baseline = await tx.projectBaseline.create({
        data: {
          projectId,
          name: dto.name,
          reason: dto.reason,
          createdBy: userId,
        },
      });

      for (const task of tasks) {
        if (task.segments.length === 0) continue;

        const startDates = task.segments.map((s) => s.startDate.getTime());
        const endDates = task.segments.map((s) => s.endDate.getTime());
        const effectiveStart = new Date(Math.min(...startDates));
        const effectiveEnd = new Date(Math.max(...endDates));

        const taskBaseline = await tx.taskBaseline.create({
          data: {
            baselineId: baseline.id,
            taskId: task.id,
            baselineEffectiveStart: effectiveStart,
            baselineEffectiveEnd: effectiveEnd,
            baselineProgress: task.overallProgress,
          },
        });

        // 세그먼트 스냅샷 (assignments를 JSON으로 직렬화)
        for (const seg of task.segments) {
          await tx.taskBaselineSegment.create({
            data: {
              taskBaselineId: taskBaseline.id,
              segmentId: seg.id,
              name: seg.name,
              sortOrder: seg.sortOrder,
              startDate: seg.startDate,
              endDate: seg.endDate,
              assignments: seg.assignments.map((a) => ({
                resourceId: a.resourceId,
                allocationMode: a.allocationMode,
                allocationPercent: a.allocationPercent,
                allocationHoursPerDay: a.allocationHoursPerDay,
              })),
            },
          });
        }
      }

      return baseline;
    });
  }

  async deleteBaseline(baselineId: string): Promise<void> {
    const baseline = await this.prisma.projectBaseline.findUnique({
      where: { id: baselineId },
    });
    if (!baseline) throw new AppError(404, "BASELINE_NOT_FOUND", "기준선을 찾을 수 없습니다.");

    await this.prisma.projectBaseline.delete({ where: { id: baselineId } });
  }

  // ─── #19 Baseline vs 현재 편차 비교 ────────────────────────────────────────

  async diffBaseline(baselineId: string): Promise<{ tasks: TaskBaselineDiff[] }> {
    const baseline = await this.prisma.projectBaseline.findUnique({
      where: { id: baselineId },
      include: {
        taskBaselines: {
          include: { segmentSnapshots: true, task: true },
        },
        project: {
          include: {
            tasks: {
              include: {
                segments: { orderBy: { sortOrder: "asc" } },
              },
            },
          },
        },
      },
    });
    if (!baseline) throw new AppError(404, "BASELINE_NOT_FOUND", "기준선을 찾을 수 없습니다.");

    const currentTaskMap = new Map(baseline.project.tasks.map((t) => [t.id, t]));

    const diffs: TaskBaselineDiff[] = baseline.taskBaselines.map((tb) => {
      const currentTask = currentTaskMap.get(tb.taskId);

      const baselineData = {
        effectiveStart: tb.baselineEffectiveStart.toISOString().slice(0, 10),
        effectiveEnd: tb.baselineEffectiveEnd.toISOString().slice(0, 10),
        segments: tb.segmentSnapshots
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((s) => ({
            name: s.name,
            startDate: s.startDate.toISOString().slice(0, 10),
            endDate: s.endDate.toISOString().slice(0, 10),
          })),
      };

      // 태스크 삭제됨
      if (!currentTask || currentTask.segments.length === 0) {
        return {
          taskId: tb.taskId,
          taskName: tb.task.name,
          baseline: baselineData,
          current: null,
          deviationDays: 0,
          status: "REMOVED" as const,
        };
      }

      const currentStartDates = currentTask.segments.map((s) => s.startDate.getTime());
      const currentEndDates = currentTask.segments.map((s) => s.endDate.getTime());
      const currentEffectiveStart = new Date(Math.min(...currentStartDates));
      const currentEffectiveEnd = new Date(Math.max(...currentEndDates));

      const currentData = {
        effectiveStart: currentEffectiveStart.toISOString().slice(0, 10),
        effectiveEnd: currentEffectiveEnd.toISOString().slice(0, 10),
        segments: currentTask.segments.map((s) => ({
          name: s.name,
          startDate: s.startDate.toISOString().slice(0, 10),
          endDate: s.endDate.toISOString().slice(0, 10),
        })),
      };

      // 편차 계산 (현재 완료일 - 기준선 완료일, 단위: 일)
      const deviationMs =
        currentEffectiveEnd.getTime() - tb.baselineEffectiveEnd.getTime();
      const deviationDays = Math.round(deviationMs / 86_400_000);

      const status: "AHEAD" | "ON_TRACK" | "DELAYED" =
        deviationDays < -1 ? "AHEAD" : deviationDays > 1 ? "DELAYED" : "ON_TRACK";

      return {
        taskId: tb.taskId,
        taskName: tb.task.name,
        baseline: baselineData,
        current: currentData,
        deviationDays,
        status,
      };
    });

    return { tasks: diffs };
  }

  // 태스크 이력 조회
  async getTaskHistory(taskId: string, limit = 50) {
    return this.prisma.taskScheduleHistory.findMany({
      where: { taskId },
      orderBy: { changedAt: "desc" },
      take: Math.min(limit, 200),
    });
  }
}
