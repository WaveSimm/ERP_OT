import { FastifyInstance } from "fastify";
import { requireRole } from "../middleware/auth.middleware.js";

/**
 * 회계정산 라우트 (v1.6, 2026-05-14)
 *  - GET    /api/v1/procurement/orders/:id/settlement  → invoice + payments + summary
 *  - GET    /api/v1/procurement/orders/:id/invoice
 *  - POST   /api/v1/procurement/orders/:id/invoice
 *  - PATCH  /api/v1/procurement/orders/:id/invoice
 *  - GET    /api/v1/procurement/orders/:id/payments
 *  - POST   /api/v1/procurement/orders/:id/payments
 *  - PATCH  /api/v1/procurement/payments/:paymentId
 *  - DELETE /api/v1/procurement/payments/:paymentId
 */
export async function orderSettlementRoutes(fastify: FastifyInstance) {
  // 통합 조회 (invoice + payments + summary)
  fastify.get("/orders/:id/settlement", async (request) => {
    const { id } = request.params as any;
    return fastify.orderSettlementService.getSummary(id);
  });

  // Invoice 조회
  fastify.get("/orders/:id/invoice", async (request) => {
    const { id } = request.params as any;
    return fastify.orderSettlementService.getInvoice(id);
  });

  // Invoice 등록 — OPERATOR 이상
  fastify.post("/orders/:id/invoice", { preHandler: [requireRole("ADMIN", "MANAGER", "OPERATOR")] }, async (request, reply) => {
    const result = await fastify.orderSettlementService.createInvoice((request.params as any).id, request.body as any);
    return reply.status(201).send(result);
  });

  // Invoice 수정 (amendment 자동 기록) — OPERATOR 이상
  fastify.patch("/orders/:id/invoice", { preHandler: [requireRole("ADMIN", "MANAGER", "OPERATOR")] }, async (request) => {
    return fastify.orderSettlementService.updateInvoice((request.params as any).id, request.body as any, request.userId);
  });

  // 송금 목록 조회
  fastify.get("/orders/:id/payments", async (request) => {
    const { id } = request.params as any;
    return fastify.orderSettlementService.listPayments(id);
  });

  // 송금 직접 등록 (재무팀이 이미 송금된 건 기록) — OPERATOR 이상
  fastify.post("/orders/:id/payments", { preHandler: [requireRole("ADMIN", "MANAGER", "OPERATOR")] }, async (request, reply) => {
    const result = await fastify.orderSettlementService.createPayment((request.params as any).id, request.body as any, request.userId);
    return reply.status(201).send(result);
  });

  // 송금 수정 — OPERATOR 이상
  fastify.patch("/payments/:paymentId", { preHandler: [requireRole("ADMIN", "MANAGER", "OPERATOR")] }, async (request) => {
    return fastify.orderSettlementService.updatePayment((request.params as any).paymentId, request.body as any);
  });

  // 송금 삭제 — OPERATOR 이상
  fastify.delete("/payments/:paymentId", { preHandler: [requireRole("ADMIN", "MANAGER", "OPERATOR")] }, async (request, reply) => {
    await fastify.orderSettlementService.deletePayment((request.params as any).paymentId);
    return reply.status(204).send();
  });

  // ─── 송금 요청 워크플로우 (v1.6, 2026-05-14) ───────────────────
  // 송금 요청 (발주 담당자) — OPERATOR 이상
  fastify.post("/orders/:id/payment-requests", { preHandler: [requireRole("ADMIN", "MANAGER", "OPERATOR")] }, async (request, reply) => {
    const result = await fastify.orderSettlementService.requestPayment((request.params as any).id, request.body as any, request.userId);
    return reply.status(201).send(result);
  });

  // 송금 요청 큐 (재무팀) — 조회
  fastify.get("/payment-requests", async (request) => {
    const { status } = request.query as any;
    return fastify.orderSettlementService.listPaymentRequests(status);
  });

  // 송금 완료 처리 (재무팀) — OPERATOR 이상
  fastify.patch("/payments/:paymentId/complete", { preHandler: [requireRole("ADMIN", "MANAGER", "OPERATOR")] }, async (request) => {
    return fastify.orderSettlementService.completePaymentRequest((request.params as any).paymentId, request.body as any, request.userId);
  });

  // 송금 요청 반려 (재무팀) — OPERATOR 이상
  fastify.patch("/payments/:paymentId/reject", { preHandler: [requireRole("ADMIN", "MANAGER", "OPERATOR")] }, async (request) => {
    const { reason } = request.body as any;
    return fastify.orderSettlementService.rejectPaymentRequest((request.params as any).paymentId, reason, request.userId);
  });
}
