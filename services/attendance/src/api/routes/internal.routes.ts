import { FastifyInstance } from "fastify";
import { z } from "zod";

export async function internalRoutes(fastify: FastifyInstance) {
  const leaveSvc = fastify.leaveService;
  const otSvc = fastify.overtimeService;
  const notifSvc = fastify.notificationService;

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

  // POST /internal/overtime/:id/framework-approve — 전자결재에서 OT 승인
  fastify.post("/overtime/:id/framework-approve", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      approverId: z.string(),
      action: z.enum(["APPROVE", "REJECT"]),
      rejectReason: z.string().optional(),
    }).parse(req.body);

    if (body.action === "APPROVE") {
      const updated = await otSvc.approve(id, body.approverId);
      return reply.send(updated);
    } else {
      const updated = await otSvc.reject(id, body.approverId, body.rejectReason || "전자결재 반려");
      return reply.send(updated);
    }
  });

  // GET /internal/leave/pending — 결재 대기 휴가 목록 (approval-service 연동용)
  fastify.get("/leave/pending", async (req, reply) => {
    const q = req.query as { approverId?: string };
    if (!q.approverId) return reply.status(400).send({ code: "BAD_REQUEST", message: "approverId required" });
    return reply.send(await leaveSvc.getPending(q.approverId));
  });

  // GET /internal/overtime/pending — 결재 대기 OT 목록
  fastify.get("/overtime/pending", async (req, reply) => {
    const q = req.query as { approverId?: string };
    if (!q.approverId) return reply.status(400).send({ code: "BAD_REQUEST", message: "approverId required" });
    return reply.send(await otSvc.getPending(q.approverId));
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
