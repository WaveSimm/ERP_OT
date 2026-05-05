import { FastifyInstance } from "fastify";
import { z } from "zod";
import { HolidayWorkError } from "../../application/holiday-work.service.js";
import { LeaveError } from "../../application/leave.service.js";

export async function internalRoutes(fastify: FastifyInstance) {
  const leaveSvc = fastify.leaveService;
  const holidayWorkSvc = fastify.holidayWorkService;
  const notifSvc = fastify.notificationService;
  const prisma = fastify.prisma;

  // GET /internal/work-schedule/by-users?userIds=&start=&end=
  // 사용자별 일자별 WorkScheduleEntry bulk 조회 (project-service utilization 계산용)
  fastify.get("/work-schedule/by-users", async (req, reply) => {
    const q = req.query as { userIds?: string; start?: string; end?: string };
    if (!q.userIds || !q.start || !q.end) {
      return reply.status(400).send({ code: "BAD_REQUEST", message: "userIds, start, end required" });
    }
    const userIds = q.userIds.split(",").filter(Boolean);
    if (userIds.length === 0) return reply.send([]);

    const start = new Date(q.start + "T00:00:00.000Z");
    const end = new Date(q.end + "T00:00:00.000Z");
    const entries = await prisma.workScheduleEntry.findMany({
      where: {
        userId: { in: userIds },
        date: { gte: start, lte: end },
      },
      select: { userId: true, date: true, entryType: true, sourceType: true, label: true, startTime: true, endTime: true },
    });
    // ISO date 문자열로 평탄화
    return reply.send(
      entries.map((e) => ({
        userId: e.userId,
        date: e.date.toISOString().slice(0, 10),
        entryType: e.entryType,
        sourceType: e.sourceType,
        label: e.label,
        startTime: e.startTime,
        endTime: e.endTime,
      })),
    );
  });

  // 보안 일괄패치 iterate-1: inline hook 제거 — shared requireInternal이 글로벌 onRequest로 처리
  // (services/shared/src/middleware/require-internal.ts 참고)

  // POST /internal/leave/:id/framework-approve — 전자결재에서 휴가 승인
  fastify.post("/leave/:id/framework-approve", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      approverId: z.string(),
      action: z.enum(["APPROVE", "REJECT"]),
      rejectReason: z.string().optional(),
    }).parse(req.body);

    if (body.action === "APPROVE") {
      const updated = await leaveSvc.approve(id, body.approverId);
      return reply.send(updated);
    } else {
      const updated = await leaveSvc.reject(id, body.approverId, body.rejectReason || "전자결재 반려");
      return reply.send(updated);
    }
  });

  // POST /internal/holiday-work/from-approval — 전자결재 최종 승인 시 HolidayWorkRequest(APPROVED) 직접 생성
  // (기존 framework-approve는 attendance에 사전 생성된 record를 update하는 패턴이었으나,
  //  v1.3부터 전자결재 OT 신청 시 attendance pre-create 안 함 — postAction에서 직접 생성)
  fastify.post("/holiday-work/from-approval", async (req, reply) => {
    const body = z.object({
      userId: z.string(),
      date: z.string(),
      reason: z.string().min(1),
      projectId: z.string().optional(),
      taskId: z.string().optional(),
      approvalDocumentId: z.string(),
    }).parse(req.body);

    try {
      const created = await holidayWorkSvc.createFromApproval(body);
      return reply.status(201).send(created);
    } catch (err: any) {
      if (err instanceof HolidayWorkError) {
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } });
      }
      throw err;
    }
  });

  // POST /internal/leave/from-approval — 전자결재 최종 승인 시 LeaveRequest(APPROVED) 직접 생성
  // (기존 framework-approve는 attendance에 사전 생성된 record를 update하는 패턴.
  //  v1.4부터 전자결재 LEAVE 신청 시 attendance pre-create 안 함 — postAction에서 직접 생성)
  fastify.post("/leave/from-approval", async (req, reply) => {
    const body = z.object({
      userId: z.string(),
      type: z.string(),       // 한국어("연차") 또는 enum("ANNUAL")
      startDate: z.string(),
      endDate: z.string(),
      reason: z.string().min(1),
      startTime: z.string().optional(),  // 시간 단위 휴가일 때 (HALF/QUARTER/FAMILY_DAY)
      endTime: z.string().optional(),    // FAMILY_DAY 1h vs 2h 결정 시
      approvalDocumentId: z.string(),
    }).parse(req.body);

    try {
      const created = await leaveSvc.createFromApproval(body);
      return reply.status(201).send(created);
    } catch (err: any) {
      if (err instanceof LeaveError) {
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } });
      }
      throw err;
    }
  });

  // GET /internal/leave/pending — 결재 대기 휴가 목록 (approval-service 연동용)
  fastify.get("/leave/pending", async (req, reply) => {
    const q = req.query as { approverId?: string };
    if (!q.approverId) return reply.status(400).send({ code: "BAD_REQUEST", message: "approverId required" });
    return reply.send(await leaveSvc.getPending(q.approverId));
  });

  // GET /internal/holiday-work/pending — 결재 대기 휴일근무 목록
  fastify.get("/holiday-work/pending", async (req, reply) => {
    const q = req.query as { approverId?: string };
    if (!q.approverId) return reply.status(400).send({ code: "BAD_REQUEST", message: "approverId required" });
    return reply.send(await holidayWorkSvc.getPending(q.approverId));
  });

  // POST /internal/notifications/bulk — 다수 사용자에게 알림 일괄 생성 (board service 등에서 호출)
  fastify.post("/notifications/bulk", async (req, reply) => {
    const body = z.object({
      userIds: z.array(z.string()).min(1).max(2000),
      type: z.string(),
      source: z.string().optional(),
      title: z.string().min(1).max(200),
      body: z.string().max(500),
      priority: z.number().int().min(1).max(3).optional(),
      linkUrl: z.string().optional(),
      metadata: z.any().optional(),
    }).parse(req.body);

    let createdCount = 0;
    for (const userId of body.userIds) {
      try {
        const payload: any = {
          userId,
          type: body.type,
          source: body.source ?? "internal",
          title: body.title,
          body: body.body,
        };
        if (body.priority !== undefined) payload.priority = body.priority;
        if (body.linkUrl !== undefined) payload.linkUrl = body.linkUrl;
        if (body.metadata !== undefined) payload.metadata = body.metadata;
        await notifSvc.create(payload);
        createdCount++;
      } catch (err) {
        req.log.error({ err, userId }, "[internal/notifications/bulk] failed for user");
      }
    }
    return reply.send({ requested: body.userIds.length, created: createdCount });
  });
}
