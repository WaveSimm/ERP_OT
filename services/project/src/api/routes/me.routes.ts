import { FastifyInstance } from "fastify";
import { z } from "zod";
import { AllocationMode, ProjectStatus } from "@prisma/client";

interface MyDayCard {
  segmentId: string;
  segmentName: string;
  taskId: string;
  taskName: string;
  projectId: string;
  projectName: string;
  startDate: string;
  endDate: string;
  daysUntilEnd: number;
  progressPercent: number;
  myAllocationPercent: number;
  myAllocationMode: AllocationMode;
  isCriticalPath: boolean;
  projectRagStatus: string;
  lastUpdatedAt: string;
  staleDays: number;
}

export async function meRoutes(fastify: FastifyInstance) {
  // ─── GET /api/v1/me/kanban ────────────────────────────────────────────────
  fastify.get("/kanban", async (req, reply) => {
    const q = req.query as { date?: string };
    const today = q.date ? new Date(q.date) : new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().slice(0, 10);
    // 자원-모델-분리 Phase 4 (2026-05-13): legacy resource 조회 → auth_user id (req.userId) 직접 사용
    const resource = { id: req.userId };
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

    const columns: Record<string, MyDayCard[]> = { UPCOMING: [], IN_PROGRESS: [], DUE_SOON: [], DONE: [] };
    let staleCount = 0;

    for (const a of assignments) {
      const seg = a.segment;
      const task = seg.task;
      if (!task || task.project.status === "CANCELLED") continue;

      const start = new Date(seg.startDate);
      const end = new Date(seg.endDate);
      const daysUntilEnd = Math.floor((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      const staleDays = Math.floor((today.getTime() - new Date(seg.updatedAt).getTime()) / (1000 * 60 * 60 * 24));

      const card: MyDayCard = {
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
    // 자원-모델-분리 Phase 4 (2026-05-13): legacy resource 조회 → auth_user id (req.userId) 직접 사용
    const resource = { id: req.userId };
    if (!resource) return reply.status(403).send({ code: "FORBIDDEN", message: "자원 정보가 없습니다." });

    const assignment = await fastify.prisma.segmentAssignment.findFirst({
      where: { segmentId, resourceId: resource.id },
    });
    if (!assignment) return reply.status(403).send({ code: "FORBIDDEN", message: "배정된 세그먼트가 아닙니다." });

    // 자원-기여도-진척률: 세그먼트 직접 update → 내 배정의 본인 진척률 갱신으로 위임
    //   (세그먼트 progressPercent는 derived 캐시라 직접 쓰면 재계산 시 덮어써짐)
    const updated = await fastify.taskService.updateAssignmentProgress(
      segmentId, resource.id, body.progressPercent, req.userId, body.changeReason,
    );

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

    // 자원-모델-분리 Phase 4 (2026-05-13): legacy resource 조회 → auth_user id (req.userId) 직접 사용
    const resource = { id: req.userId };
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
    // 자원-모델-분리 Phase 4 (2026-05-13): legacy resource 조회 → auth_user id (req.userId) 직접 사용
    const resource = { id: req.userId };
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

    // 본인 배정된 프로젝트 ID 수집 + 본인 segment count
    const projectMap = new Map<string, { id: string; name: string; status: ProjectStatus; segmentCount: number }>();
    for (const a of assignments) {
      const proj = a.segment.task.project;
      if (!projectMap.has(proj.id)) {
        projectMap.set(proj.id, { id: proj.id, name: proj.name, status: proj.status, segmentCount: 0 });
      }
      projectMap.get(proj.id)!.segmentCount++;
    }

    // 캐시 필드 직접 read — 프로젝트-진도율-캐시 PDCA로 도입된 Project.overallProgress
    const projectIds = Array.from(projectMap.keys());
    const dbProjects = await fastify.prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, overallProgress: true },
    });
    const avgMap = new Map(dbProjects.map((p) => [p.id, p.overallProgress ?? 0]));

    const projects = Array.from(projectMap.values()).map((p) => ({
      projectId: p.id,
      projectName: p.name,
      status: p.status,
      segmentCount: p.segmentCount,
      avgProgress: Math.round(avgMap.get(p.id) ?? 0),
    }));

    return reply.send(projects);
  });

  // ─── GET /api/v1/me/stale-segments ───────────────────────────────────────
  fastify.get("/stale-segments", async (req, reply) => {
    const q = req.query as { staleDays?: string };
    const staleDays = parseInt(q.staleDays ?? "3");
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - staleDays);

    // 자원-모델-분리 Phase 4 (2026-05-13): legacy resource 조회 → auth_user id (req.userId) 직접 사용
    const resource = { id: req.userId };
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

  // ─── GET /api/v1/me/work-logs ─────────────────────────────────────────────
  fastify.get("/work-logs", async (req, reply) => {
    const q = req.query as { from?: string; to?: string; projectId?: string; limit?: string };
    const params: { from?: string; to?: string; projectId?: string; limit?: number } = {};
    if (q.from) params.from = q.from;
    if (q.to) params.to = q.to;
    if (q.projectId) params.projectId = q.projectId;
    if (q.limit) params.limit = parseInt(q.limit, 10);
    const items = await fastify.workLogService.listMine(
      { id: req.userId, email: req.userEmail, role: req.userRole },
      params,
    );
    return reply.send(items);
  });

  // ─── GET /api/v1/me/work-log-projects ─────────────────────────────────────
  fastify.get("/work-log-projects", async (req, reply) => {
    const items = await fastify.workLogService.listMyProjects({
      id: req.userId,
      email: req.userEmail,
      role: req.userRole,
    });
    return reply.send(items);
  });

  // ─── GET /api/v1/me/work-log-feed ─────────────────────────────────────────
  fastify.get("/work-log-feed", async (req, reply) => {
    const q = req.query as { limit?: string };
    const params: { limit?: number } = {};
    if (q.limit) params.limit = parseInt(q.limit, 10);
    const items = await fastify.workLogService.listFeed(
      { id: req.userId, email: req.userEmail, role: req.userRole },
      params,
    );
    return reply.send(items);
  });
}
