import { FastifyInstance } from "fastify";
import { requireRole } from "../middleware/auth.middleware.js";

/**
 * InboundRequest API (v1.6 신규, 2026-05-13)
 *
 * Design v1.1 §19.2.2 참고
 *
 * Public routes (자재 담당자 / ADMIN, MANAGER):
 *   GET    /api/v1/inbound-requests?status=PENDING
 *   GET    /api/v1/inbound-requests/:id
 *   POST   /api/v1/inbound-requests              (수동 생성)
 *   POST   /api/v1/inbound-requests/:id/receive  (입고 처리)
 *   PATCH  /api/v1/inbound-requests/:id/cancel
 *
 * Internal routes (cross-service 호출):
 *   POST   /api/v1/internal/inbound-requests
 */
export async function inboundRequestRoutes(fastify: FastifyInstance) {
  // 조회 — 모두 가능
  fastify.get("/", async (request) => {
    const q = request.query as { status?: string; sourceType?: string; page?: string; limit?: string; sortBy?: string; sortOrder?: string };
    return fastify.inboundRequestService.list({
      ...(q.status && { status: q.status as any }),
      ...(q.sourceType && { sourceType: q.sourceType as any }),
      ...(q.page && { page: parseInt(q.page, 10) }),
      ...(q.limit && { limit: parseInt(q.limit, 10) }),
      ...(q.sortBy && { sortBy: q.sortBy }),
      ...((q.sortOrder === "asc" || q.sortOrder === "desc") && { sortOrder: q.sortOrder }),
    });
  });

  fastify.get("/:id", async (request) => {
    return fastify.inboundRequestService.getById((request.params as any).id);
  });

  // 신규 생성 — ADMIN, MANAGER (수동 입고 요청)
  fastify.post("/", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request, reply) => {
    const body = request.body as any;
    const result = await fastify.inboundRequestService.create({
      sourceType: body.sourceType ?? "MANUAL",
      sourceId: body.sourceId,
      sourceDocNumber: body.sourceDocNumber,
      requesterId: request.userId,
      notes: body.notes,
      items: body.items ?? [],
    });
    return reply.status(201).send(result);
  });

  // 입고 처리 (PENDING → RECEIVED) — ADMIN, MANAGER, OPERATOR
  fastify.post("/:id/receive", { preHandler: [requireRole("ADMIN", "MANAGER", "OPERATOR")] }, async (request) => {
    const body = request.body as any;
    return fastify.inboundRequestService.receive((request.params as any).id, {
      receivedItems: body.receivedItems ?? [],
      receivedBy: request.userId,
    });
  });

  // 취소 — ADMIN, MANAGER
  fastify.patch("/:id/cancel", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request) => {
    const body = request.body as { reason?: string };
    return fastify.inboundRequestService.cancel((request.params as any).id, body.reason);
  });

  // v1.6.1 (2026-05-15): 해외 발주에서 입고 큐로 요청 — ADMIN, MANAGER, OPERATOR
  fastify.post("/from-overseas-order/:orderId", { preHandler: [requireRole("ADMIN", "MANAGER", "OPERATOR")] }, async (request, reply) => {
    const { orderId } = request.params as any;
    const result = await fastify.inboundRequestService.createFromOverseasOrder(orderId, request.userId);
    return reply.status(201).send(result);
  });
}

/**
 * Internal API — 다른 서비스(approval, expense 등)에서 InboundRequest 자동 생성
 *
 * Header: X-Internal-Token 필수
 */
export async function inboundRequestInternalRoutes(fastify: FastifyInstance) {
  fastify.post("/internal/inbound-requests", async (request, reply) => {
    const token = request.headers["x-internal-token"];
    if (token !== process.env.INTERNAL_API_TOKEN) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const body = request.body as any;
    if (!body.sourceType || !body.requesterId || !Array.isArray(body.items)) {
      return reply.status(400).send({ error: "sourceType, requesterId, items[] required" });
    }
    const result = await fastify.inboundRequestService.create({
      sourceType: body.sourceType,
      sourceId: body.sourceId,
      sourceDocNumber: body.sourceDocNumber,
      requesterId: body.requesterId,
      notes: body.notes,
      items: body.items,
    });
    return reply.status(201).send(result);
  });
}
