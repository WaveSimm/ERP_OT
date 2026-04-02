import { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireRole } from "../middleware/auth.middleware.js";

export async function overtimeRoutes(fastify: FastifyInstance) {
  const svc = fastify.overtimeService;
  const notifSvc = fastify.notificationService;

  // POST /api/v1/overtime/requests
  fastify.post("/requests", async (req, reply) => {
    const body = z.object({
      date: z.string(),
      plannedHours: z.number().positive(),
      reason: z.string().min(1),
      projectId: z.string().optional(),
      segmentId: z.string().optional(),
      approverId: z.string().optional(),  // 프론트에서 지정 시 우선 사용
    }).parse(req.body);

    // 결재자 조회 (위임 고려) — 프론트 지정 없을 때만
    const approverInfo = await fastify.authClient.getApprover(req.userId);
    const effectiveApproverId = body.approverId ?? approverInfo?.delegateId ?? approverInfo?.approverId ?? undefined;
    const secondApproverId = body.approverId ? undefined : (approverInfo?.secondApproverId ?? undefined);
    const thirdApproverId = body.approverId ? undefined : (approverInfo?.thirdApproverId ?? undefined);

    const request = await svc.createRequest(req.userId, {
      date: body.date,
      plannedHours: body.plannedHours,
      reason: body.reason,
      ...(body.projectId ? { projectId: body.projectId } : {}),
      ...(body.segmentId ? { segmentId: body.segmentId } : {}),
      ...(effectiveApproverId ? { approverId: effectiveApproverId } : {}),
      ...(secondApproverId ? { secondApproverId } : {}),
      ...(thirdApproverId ? { thirdApproverId } : {}),
    });

    // 1차 결재자에게 알림
    if (effectiveApproverId) {
      await notifSvc.create({
        userId: effectiveApproverId,
        type: "OT_PENDING",
        title: "OT 승인 요청",
        body: `${body.date} OT 신청(${body.plannedHours}h)이 접수되었습니다.`,
        linkUrl: "/me/team",
      });
    }

    return reply.status(201).send(request);
  });

  // GET /api/v1/overtime/requests
  fastify.get("/requests", async (req, reply) => {
    const q = req.query as { status?: string };
    return reply.send(await svc.getRequests(req.userId, q.status));
  });

  // PATCH /api/v1/overtime/requests/:id/complete
  fastify.patch("/requests/:id/complete", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ actualHours: z.number().positive() }).parse(req.body);
    return reply.send(await svc.complete(id, req.userId, body.actualHours));
  });

  // PATCH /api/v1/overtime/requests/:id/cancel
  fastify.patch("/requests/:id/cancel", async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send(await svc.cancel(id, req.userId));
  });

  // Manager: 승인 대기 목록
  fastify.get("/pending", {
    preHandler: requireRole("ADMIN", "MANAGER"),
  }, async (req, reply) => {
    return reply.send(await svc.getPending(req.userId));
  });

  // Manager: 승인
  fastify.post("/requests/:id/approve", {
    preHandler: requireRole("ADMIN", "MANAGER"),
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const updated = await svc.approve(id, req.userId);

    if (updated.status === "APPROVED") {
      await notifSvc.create({
        userId: updated.userId,
        type: "OT_APPROVED",
        title: "OT 신청 승인",
        body: `${updated.date.toISOString().slice(0, 10)} OT 신청이 승인되었습니다.`,
        linkUrl: "/me/attendance",
      });
    } else if (updated.status === "PENDING_2ND" && updated.secondApproverId) {
      await notifSvc.create({
        userId: updated.secondApproverId,
        type: "OT_PENDING",
        title: "OT 승인 요청 (2차)",
        body: `${updated.date.toISOString().slice(0, 10)} OT 신청(${updated.plannedHours}h) 2차 승인이 필요합니다.`,
        linkUrl: "/me/team",
      });
    } else if (updated.status === "PENDING_3RD" && updated.thirdApproverId) {
      await notifSvc.create({
        userId: updated.thirdApproverId,
        type: "OT_PENDING",
        title: "OT 승인 요청 (3차)",
        body: `${updated.date.toISOString().slice(0, 10)} OT 신청(${updated.plannedHours}h) 3차 승인이 필요합니다.`,
        linkUrl: "/me/team",
      });
    }
    return reply.send(updated);
  });

  // Manager: 반려
  fastify.post("/requests/:id/reject", {
    preHandler: requireRole("ADMIN", "MANAGER"),
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ rejectReason: z.string().min(1) }).parse(req.body);
    const updated = await svc.reject(id, req.userId, body.rejectReason);
    await notifSvc.create({
      userId: updated.userId,
      type: "OT_REJECTED",
      title: "OT 신청 반려",
      body: `OT 신청이 반려되었습니다. 사유: ${body.rejectReason}`,
      linkUrl: "/me/attendance",
    });
    return reply.send(updated);
  });
}
