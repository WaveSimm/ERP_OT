import { FastifyInstance } from "fastify";
import { AllocationMode, TaskStatus, ProjectStatus } from "@prisma/client";

interface MySegmentView {
  segmentId: string;
  segmentName: string;
  startDate: string | null;
  endDate: string | null;
  progressPercent: number;        // 세그먼트 derived 진척률 (참고용)
  myProgressPercent: number;      // 자원-기여도-진척률: 내 배정의 본인 진척률
  resourceId: string;
  allocationMode: AllocationMode;
  allocationPercent: number | null;
  allocationHoursPerDay: number | null;
  contributionWeight: number;     // 자원-기여도-진척률: 분담율
}

interface MyTaskView {
  taskId: string;
  taskName: string;
  taskStatus: TaskStatus;
  sortOrder: number;
  overallProgress: number;
  startDate: string | null;
  endDate: string | null;
  project: { id: string; name: string; status: ProjectStatus };
  mySegments: MySegmentView[];
}

export async function myTasksRoutes(fastify: FastifyInstance) {
  // GET /api/v1/tasks/mine
  fastify.get("/mine", async (req, reply) => {
    // 자원-모델-분리 Phase 4 (2026-05-13): legacy resource 조회 폐기 → auth_user id 직접 사용
    const resource = { id: req.userId };

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

    const taskMap = new Map<string, MyTaskView>();
    for (const a of assignments) {
      const seg = a.segment;
      const task = seg.task;
      if (!task) continue;

      if (!taskMap.has(task.id)) {
        const segs = task.segments ?? [];
        const overallProgress =
          segs.length > 0
            ? Math.round(
                (segs.reduce((sum, s) => sum + (s.progressPercent ?? 0), 0) /
                  segs.length) * 10,
              ) / 10
            : task.overallProgress;

        const dates = segs
          .filter((s) => s.startDate && s.endDate)
          .map((s) => ({ start: new Date(s.startDate), end: new Date(s.endDate) }));
        const startDate =
          dates.length > 0
            ? dates.reduce((m, d) => (d.start < m ? d.start : m), dates[0]!.start)
            : null;
        const endDate =
          dates.length > 0
            ? dates.reduce((m, d) => (d.end > m ? d.end : m), dates[0]!.end)
            : null;

        taskMap.set(task.id, {
          taskId: task.id,
          taskName: task.name,
          taskStatus: task.status,
          sortOrder: task.sortOrder,
          overallProgress,
          startDate: startDate ? startDate.toISOString().slice(0, 10) : null,
          endDate: endDate ? endDate.toISOString().slice(0, 10) : null,
          project: task.project,
          mySegments: [],
        });
      }

      // 이 사용자가 배정된 세그먼트 정보 (segmentId + resourceId 포함)
      taskMap.get(task.id)!.mySegments.push({
        segmentId: seg.id,
        segmentName: seg.name,
        startDate: seg.startDate ? new Date(seg.startDate).toISOString().slice(0, 10) : null,
        endDate: seg.endDate ? new Date(seg.endDate).toISOString().slice(0, 10) : null,
        progressPercent: seg.progressPercent ?? 0,
        myProgressPercent: a.progressPercent ?? 0,
        resourceId: resource.id,
        allocationMode: a.allocationMode,
        allocationPercent: a.allocationPercent,
        allocationHoursPerDay: a.allocationHoursPerDay,
        contributionWeight: a.contributionWeight ?? 0,
      });
    }

    const tasks = Array.from(taskMap.values());

    const projectMap = new Map<string, { project: MyTaskView["project"]; tasks: MyTaskView[] }>();
    for (const t of tasks) {
      const pid = t.project.id;
      if (!projectMap.has(pid)) {
        projectMap.set(pid, { project: t.project, tasks: [] });
      }
      projectMap.get(pid)!.tasks.push(t);
    }

    // 태스크를 프로젝트 목록과 동일한 sortOrder로 정렬
    const result = Array.from(projectMap.values());
    for (const g of result) {
      g.tasks.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    }

    return reply.send(result);
  });
}
