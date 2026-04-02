import { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireRole } from "../middleware/auth.middleware.js";

export async function leaveRoutes(fastify: FastifyInstance) {
  const svc = fastify.leaveService;
  const notifSvc = fastify.notificationService;

  // GET /api/v1/leave/balance
  fastify.get("/balance", async (req, reply) => {
    const q = req.query as { year?: string };
    const year = parseInt(q.year ?? String(new Date().getFullYear()));
    return reply.send(await svc.getBalance(req.userId, year));
  });

  // POST /api/v1/leave/requests
  fastify.post("/requests", async (req, reply) => {
    const body = z.object({
      type: z.enum(["ANNUAL", "HALF_AM", "HALF_PM", "SICK", "SPECIAL"]),
      startDate: z.string(),
      endDate: z.string(),
      reason: z.string().min(1),
      approverId: z.string().optional(),  // 프론트에서 지정 시 우선 사용
    }).parse(req.body);

    // 결재자 조회 (위임 고려) — 프론트 지정 없을 때만
    const approverInfo = await fastify.authClient.getApprover(req.userId);
    const effectiveApproverId = body.approverId ?? approverInfo?.delegateId ?? approverInfo?.approverId ?? undefined;
    const secondApproverId = body.approverId ? undefined : (approverInfo?.secondApproverId ?? undefined);
    const thirdApproverId = body.approverId ? undefined : (approverInfo?.thirdApproverId ?? undefined);

    const request = await svc.createRequest(req.userId, {
      type: body.type,
      startDate: body.startDate,
      endDate: body.endDate,
      reason: body.reason,
      ...(effectiveApproverId ? { approverId: effectiveApproverId } : {}),
      ...(secondApproverId ? { secondApproverId } : {}),
      ...(thirdApproverId ? { thirdApproverId } : {}),
    });

    // 1차 결재자에게 알림
    if (effectiveApproverId) {
      await notifSvc.create({
        userId: effectiveApproverId,
        type: "LEAVE_PENDING",
        title: "휴가 승인 요청",
        body: `${body.startDate} ~ ${body.endDate} 휴가 신청이 접수되었습니다.`,
        linkUrl: "/me/team",
      });
    }

    return reply.status(201).send(request);
  });

  // GET /api/v1/leave/requests
  fastify.get("/requests", async (req, reply) => {
    const q = req.query as { status?: string };
    return reply.send(await svc.getRequests(req.userId, q.status));
  });

  // PATCH /api/v1/leave/requests/:id/cancel
  fastify.patch("/requests/:id/cancel", async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send(await svc.cancelRequest(id, req.userId));
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
      // 최종 승인 → 신청자에게 알림
      await notifSvc.create({
        userId: updated.userId,
        type: "LEAVE_APPROVED",
        title: "휴가 신청 승인",
        body: `${updated.startDate.toISOString().slice(0, 10)} 휴가 신청이 승인되었습니다.`,
        linkUrl: "/me/attendance",
      });
    } else if (updated.status === "PENDING_2ND" && updated.secondApproverId) {
      // 2차 결재자에게 알림
      await notifSvc.create({
        userId: updated.secondApproverId,
        type: "LEAVE_PENDING",
        title: "휴가 승인 요청 (2차)",
        body: `${updated.startDate.toISOString().slice(0, 10)} ~ ${updated.endDate.toISOString().slice(0, 10)} 휴가 신청 2차 승인이 필요합니다.`,
        linkUrl: "/me/team",
      });
    } else if (updated.status === "PENDING_3RD" && updated.thirdApproverId) {
      // 3차 결재자에게 알림
      await notifSvc.create({
        userId: updated.thirdApproverId,
        type: "LEAVE_PENDING",
        title: "휴가 승인 요청 (3차)",
        body: `${updated.startDate.toISOString().slice(0, 10)} ~ ${updated.endDate.toISOString().slice(0, 10)} 휴가 신청 3차 승인이 필요합니다.`,
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
      type: "LEAVE_REJECTED",
      title: "휴가 신청 반려",
      body: `휴가 신청이 반려되었습니다. 사유: ${body.rejectReason}`,
      linkUrl: "/me/attendance",
    });
    return reply.send(updated);
  });

  // Admin: 연차 수동 조정
  fastify.post("/balance/adjust", {
    preHandler: requireRole("ADMIN"),
  }, async (req, reply) => {
    const body = z.object({
      userId: z.string(),
      year: z.number().int(),
      adjustedDays: z.number(),
      reason: z.string(),
    }).parse(req.body);
    return reply.send(await svc.adjustBalance(body.userId, body.year, body.adjustedDays, req.userId));
  });
}
