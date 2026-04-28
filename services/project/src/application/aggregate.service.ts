import { PrismaClient, Prisma } from "@prisma/client";

/**
 * 프로젝트-진도율-캐시 PDCA — Project/Task aggregate 캐시 필드 갱신.
 *
 * 갱신 대상:
 *  - Task.effectiveStartDate / EndDate (자기 segments min/max)
 *  - Project.overallProgress (leaf task segments 평균 progressPercent)
 *  - Project.effectiveStartDate / EndDate (leaf task segments min/max)
 *
 * 호출 위치 (TaskService hook):
 *  - createTask, updateTask(parentId/isMilestone/progress 변경 시), deleteTask → recomputeProject
 *  - createSegment, updateSegment, deleteSegment → recomputeTaskAndProject
 *  - TemplateService.apply 후 → recomputeProject
 */
export class AggregateService {
  constructor(private readonly prisma: PrismaClient | Prisma.TransactionClient) {}

  /** 단일 task의 effectiveDates 재계산 */
  async recomputeTask(taskId: string): Promise<void> {
    const segs = await this.prisma.taskSegment.findMany({
      where: { taskId },
      select: { startDate: true, endDate: true },
    });
    const start = segs.length > 0
      ? new Date(Math.min(...segs.map((s) => s.startDate.getTime())))
      : null;
    const end = segs.length > 0
      ? new Date(Math.max(...segs.map((s) => s.endDate.getTime())))
      : null;
    await this.prisma.task.update({
      where: { id: taskId },
      data: { effectiveStartDate: start, effectiveEndDate: end },
    });
  }

  /** project의 overallProgress + effectiveDates 재계산 (leaf task only) */
  async recomputeProject(projectId: string): Promise<void> {
    const allTasks = await this.prisma.task.findMany({
      where: { projectId },
      select: { id: true, parentId: true, isMilestone: true },
    });
    const parentIds = new Set(
      allTasks.filter((t) => t.parentId).map((t) => t.parentId!),
    );
    const leafIds = allTasks
      .filter((t) => !parentIds.has(t.id) && !t.isMilestone)
      .map((t) => t.id);

    if (leafIds.length === 0) {
      await this.prisma.project.update({
        where: { id: projectId },
        data: {
          overallProgress: null,
          effectiveStartDate: null,
          effectiveEndDate: null,
        },
      });
      return;
    }

    const segs = await this.prisma.taskSegment.findMany({
      where: { taskId: { in: leafIds } },
      select: { progressPercent: true, startDate: true, endDate: true },
    });

    if (segs.length === 0) {
      await this.prisma.project.update({
        where: { id: projectId },
        data: {
          overallProgress: null,
          effectiveStartDate: null,
          effectiveEndDate: null,
        },
      });
      return;
    }

    const avg = segs.reduce((s, x) => s + x.progressPercent, 0) / segs.length;
    const start = new Date(Math.min(...segs.map((s) => s.startDate.getTime())));
    const end = new Date(Math.max(...segs.map((s) => s.endDate.getTime())));

    await this.prisma.project.update({
      where: { id: projectId },
      data: {
        overallProgress: avg,
        effectiveStartDate: start,
        effectiveEndDate: end,
      },
    });
  }

  /** Task 변경 후 단축 호출 — task + project 일괄 갱신 */
  async recomputeTaskAndProject(taskId: string, projectId: string): Promise<void> {
    await this.recomputeTask(taskId);
    await this.recomputeProject(projectId);
  }
}
