import { FastifyInstance } from "fastify";
import { z } from "zod";

export async function meRoutes(fastify: FastifyInstance) {
  // ─── GET /api/v1/me/kanban ────────────────────────────────────────────────
  fastify.get("/kanban", async (req, reply) => {
    const q = req.query as { date?: string };
    const today = q.date ? new Date(q.date) : new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().slice(0, 10);
    const resource = await fastify.prisma.resource.findFirst({ where: { userId: req.userEmail } });
    if (!resource) return reply.send({ date: todayStr, columns: { UPCOMING: [], IN_PROGRESS: [], DUE_SOON: [], DONE: [] }, staleCount: 0, totalAssigned: 0 });

    const assignments = await fastify.prisma.segmentAssignment.findMany({
      where: { resourceId: resource.id },
      include: {
        segment: {
          include: {
            task: {
              include: {
                project: { select: { id: true, name: true, status: true } },
              },
            },
          },
        },
      },
    });

    const columns: Record<string, any[]> = { UPCOMING: [], IN_PROGRESS: [], DUE_SOON: [], DONE: [] };
    let staleCount = 0;

    for (const a of assignments) {
      const seg = a.segment;
      const task = seg.task;
      if (!task || task.project.status === "CANCELLED") continue;

      const start = new Date(seg.startDate);
      const end = new Date(seg.endDate);
      const daysUntilEnd = Math.floor((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      const staleDays = Math.floor((today.getTime() - new Date(seg.updatedAt).getTime()) / (1000 * 60 * 60 * 24));

      const card: any = {
        segmentId: seg.id,
        segmentName: seg.name,
        taskId: task.id,
        taskName: task.name,
        projectId: task.project.id,
        projectName: task.project.name,
        startDate: start.toISOString().slice(0, 10),
        endDate: end.toISOString().slice(0, 10),
        daysUntilEnd,
        progressPercent: seg.progressPercent,
        myAllocationPercent: a.allocationPercent ?? 0,
        myAllocationMode: a.allocationMode,
        isCriticalPath: task.isCritical,
        projectRagStatus: "GREEN" as const,
        lastUpdatedAt: seg.updatedAt.toISOString(),
        staleDays: staleDays > 0 ? staleDays : 0,
      };

      if (staleDays >= 3) staleCount++;

      const isDone = seg.progressPercent >= 100 || (daysUntilEnd < 0 && task.status === "DONE");
      if (isDone) {
        columns.DONE!.push(card);
      } else if (start <= today && today <= end) {
        if (daysUntilEnd <= 3) columns.DUE_SOON!.push(card);
        else columns.IN_PROGRESS!.push(card);
      } else if (start > today && daysUntilEnd <= 7) {
        columns.UPCOMING!.push(card);
      } else if (start > today) {
        columns.UPCOMING!.push(card);
      }
    }

    // DUE_SOON 오름차순 정렬
    columns.DUE_SOON!.sort((a, b) => a.daysUntilEnd - b.daysUntilEnd);

    return reply.send({
      date: todayStr,
      columns,
      staleCount,
      totalAssigned: assignments.length,
    });
  });

  // ─── PATCH /api/v1/me/segments/:segmentId/progress ───────────────────────
  fastify.patch("/segments/:segmentId/progress", async (req, reply) => {
    const { segmentId } = req.params as { segmentId: string };
    const body = z.object({
      progressPercent: z.number().min(0).max(100),
      changeReason: z.string().optional(),
    }).parse(req.body);

    // 권한 확인: 해당 세그먼트에 배정된 사용자인지
    const resource = await fastify.prisma.resource.findFirst({ where: { userId: req.userEmail } });
    if (!resource) return reply.status(403).send({ code: "FORBIDDEN", message: "자원 정보가 없습니다." });

    const assignment = await fastify.prisma.segmentAssignment.findFirst({
      where: { segmentId, resourceId: resource.id },
    });
    if (!assignment) return reply.status(403).send({ code: "FORBIDDEN", message: "배정된 세그먼트가 아닙니다." });

    const updated = await fastify.prisma.taskSegment.update({
      where: { id: segmentId },
      data: { progressPercent: body.progressPercent },
    });

    return reply.send(updated);
  });

  // ─── GET /api/v1/me/week-calendar ────────────────────────────────────────
  fastify.get("/week-calendar", async (req, reply) => {
    const q = req.query as { date?: string };
    const ref = q.date ? new Date(q.date) : new Date();
    // 주의 월요일 계산
    const day = ref.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const weekStart = new Date(ref);
    weekStart.setDate(ref.getDate() + diff);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);

    const resource = await fastify.prisma.resource.findFirst({ where: { userId: req.userEmail } });
    if (!resource) return reply.send({ weekStart: weekStart.toISOString().slice(0, 10), weekEnd: weekEnd.toISOString().slice(0, 10), days: [] });

    const assignments = await fastify.prisma.segmentAssignment.findMany({
      where: {
        resourceId: resource.id,
        segment: {
          startDate: { lte: weekEnd },
          endDate: { gte: weekStart },
        },
      },
      include: {
        segment: {
          include: {
            task: {
              include: {
                project: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const days = [];
    for (let i = 0; i < 7; i++) {
      const cur = new Date(weekStart);
      cur.setDate(weekStart.getDate() + i);
      const dateStr = cur.toISOString().slice(0, 10);

      const segments = assignments
        .filter((a) => new Date(a.segment.startDate) <= cur && cur <= new Date(a.segment.endDate))
        .map((a) => {
          const seg = a.segment;
          const start = new Date(seg.startDate);
          const end = new Date(seg.endDate);
          const spanDays = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
          return {
            segmentId: seg.id,
            segmentName: seg.name,
            taskName: seg.task.name,
            projectName: seg.task.project.name,
            startDate: start.toISOString().slice(0, 10),
            endDate: end.toISOString().slice(0, 10),
            progressPercent: seg.progressPercent,
            isCriticalPath: seg.task.isCritical,
            isStartDay: start.toISOString().slice(0, 10) === dateStr,
            isEndDay: end.toISOString().slice(0, 10) === dateStr,
            spanDays,
          };
        });

      days.push({
        date: dateStr,
        dayOfWeek: cur.getDay(),
        isToday: cur.getTime() === today.getTime(),
        segments,
      });
    }

    return reply.send({
      weekStart: weekStart.toISOString().slice(0, 10),
      weekEnd: weekEnd.toISOString().slice(0, 10),
      days,
    });
  });

  // ─── GET /api/v1/me/projects ──────────────────────────────────────────────
  fastify.get("/projects", async (req, reply) => {
    const resource = await fastify.prisma.resource.findFirst({ where: { userId: req.userEmail } });
    if (!resource) return reply.send([]);

    const assignments = await fastify.prisma.segmentAssignment.findMany({
      where: { resourceId: resource.id },
      include: {
        segment: {
          include: {
            task: {
              include: {
                project: { select: { id: true, name: true, status: true } },
                segments: { select: { progressPercent: true } },
              },
            },
          },
        },
      },
    });

    const projectMap = new Map<string, any>();
    for (const a of assignments as any[]) {
      const proj = a.segment.task.project;
      if (!projectMap.has(proj.id)) {
        projectMap.set(proj.id, { ...proj, segmentCount: 0, avgProgress: 0, _totalProgress: 0 });
      }
      const p = projectMap.get(proj.id);
      p.segmentCount++;
      p._totalProgress += a.segment.progressPercent;
    }

    const projects = Array.from(projectMap.values()).map((p) => ({
      projectId: p.id,
      projectName: p.name,
      status: p.status,
      segmentCount: p.segmentCount,
      avgProgress: p.segmentCount > 0 ? Math.round(p._totalProgress / p.segmentCount) : 0,
    }));

    return reply.send(projects);
  });

  // ─── GET /api/v1/me/stale-segments ───────────────────────────────────────
  fastify.get("/stale-segments", async (req, reply) => {
    const q = req.query as { staleDays?: string };
    const staleDays = parseInt(q.staleDays ?? "3");
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - staleDays);

    const resource = await fastify.prisma.resource.findFirst({ where: { userId: req.userEmail } });
    if (!resource) return reply.send([]);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const assignments = await fastify.prisma.segmentAssignment.findMany({
      where: {
        resourceId: resource.id,
        segment: {
          progressPercent: { lt: 100 },
          endDate: { gte: today },
          updatedAt: { lt: cutoff },
        },
      },
      include: {
        segment: {
          include: {
            task: {
              include: {
                project: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });

    const stale = assignments.map((a) => ({
      segmentId: a.segment.id,
      segmentName: a.segment.name,
      taskName: a.segment.task.name,
      projectId: a.segment.task.project.id,
      projectName: a.segment.task.project.name,
      progressPercent: a.segment.progressPercent,
      lastUpdatedAt: a.segment.updatedAt.toISOString(),
      staleDays: Math.floor((today.getTime() - new Date(a.segment.updatedAt).getTime()) / (1000 * 60 * 60 * 24)),
      userId: req.userId,
    }));

    return reply.send(stale);
  });
}
