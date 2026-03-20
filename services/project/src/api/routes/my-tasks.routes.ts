import { FastifyInstance } from "fastify";

export async function myTasksRoutes(fastify: FastifyInstance) {
  // GET /api/v1/tasks/mine
  fastify.get("/mine", async (req, reply) => {
    const resource = await fastify.prisma.resource.findFirst({
      where: { userId: req.userEmail },
    });

    if (!resource) return reply.send([]);

    const assignments = await fastify.prisma.segmentAssignment.findMany({
      where: { resourceId: resource.id },
      include: {
        segment: {
          include: {
            task: {
              include: {
                project: { select: { id: true, name: true, status: true } },
                segments: { orderBy: { sortOrder: "asc" } },
              },
            },
          },
        },
      },
    });

    const taskMap = new Map<string, any>();
    for (const a of assignments) {
      const seg = a.segment;
      const task = seg.task;
      if (!task) continue;

      if (!taskMap.has(task.id)) {
        const segs = task.segments ?? [];
        const overallProgress =
          segs.length > 0
            ? Math.round(
                (segs.reduce((sum: number, s: any) => sum + (s.progressPercent ?? 0), 0) /
                  segs.length) * 10,
              ) / 10
            : task.overallProgress;

        const dates = segs
          .filter((s: any) => s.startDate && s.endDate)
          .map((s: any) => ({ start: new Date(s.startDate), end: new Date(s.endDate) }));
        const startDate =
          dates.length > 0
            ? dates.reduce((m: Date, d: any) => (d.start < m ? d.start : m), dates[0]!.start)
            : null;
        const endDate =
          dates.length > 0
            ? dates.reduce((m: Date, d: any) => (d.end > m ? d.end : m), dates[0]!.end)
            : null;

        taskMap.set(task.id, {
          taskId: task.id,
          taskName: task.name,
          taskStatus: task.status,
          isMilestone: task.isMilestone,
          sortOrder: task.sortOrder,
          overallProgress,
          startDate: startDate ? startDate.toISOString().slice(0, 10) : null,
          endDate: endDate ? endDate.toISOString().slice(0, 10) : null,
          project: task.project,
          mySegments: [],
        });
      }

      // 이 사용자가 배정된 세그먼트 정보 (segmentId + resourceId 포함)
      taskMap.get(task.id).mySegments.push({
        segmentId: seg.id,
        segmentName: seg.name,
        startDate: seg.startDate ? new Date(seg.startDate).toISOString().slice(0, 10) : null,
        endDate: seg.endDate ? new Date(seg.endDate).toISOString().slice(0, 10) : null,
        progressPercent: seg.progressPercent ?? 0,
        resourceId: resource.id,
        allocationMode: a.allocationMode,
        allocationPercent: a.allocationPercent,
        allocationHoursPerDay: a.allocationHoursPerDay,
      });
    }

    const tasks = Array.from(taskMap.values());

    const projectMap = new Map<string, any>();
    for (const t of tasks) {
      const pid = t.project.id;
      if (!projectMap.has(pid)) {
        projectMap.set(pid, { project: t.project, tasks: [] });
      }
      projectMap.get(pid).tasks.push(t);
    }

    // 태스크를 프로젝트 목록과 동일한 sortOrder로 정렬
    const result = Array.from(projectMap.values());
    for (const g of result) {
      g.tasks.sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    }

    return reply.send(result);
  });
}
