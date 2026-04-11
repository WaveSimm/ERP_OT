import { FastifyInstance } from "fastify";
import { requireRole } from "../middleware/auth.middleware.js";

// ─── Internal API (결재 콜백) ───────────────────────────────────────────

export async function internalOrderRoutes(fastify: FastifyInstance) {
  // 결재 승인 → 발주 확정 (approval-service에서 ORDER_CONFIRM 콜백)
  fastify.post("/internal/orders/:id/confirm", async (request, reply) => {
    const token = request.headers["x-internal-token"];
    if (token !== process.env.INTERNAL_API_TOKEN) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const { id } = request.params as any;
    const order = await fastify.prisma.overseasOrder.findUnique({ where: { id } });
    if (!order) return reply.status(404).send({ error: "발주를 찾을 수 없습니다." });

    // PENDING_APPROVAL → ORDERED (결재 승인으로 바로 발주확정)
    const result = await fastify.prisma.overseasOrder.update({
      where: { id },
      data: { status: "ORDERED" },
    });
    return result;
  });

  // 결재 반려 → 발주 반려
  fastify.post("/internal/orders/:id/reject", async (request, reply) => {
    const token = request.headers["x-internal-token"];
    if (token !== process.env.INTERNAL_API_TOKEN) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const { id } = request.params as any;
    const result = await fastify.prisma.overseasOrder.update({
      where: { id },
      data: { status: "REJECTED" },
    });
    return result;
  });
}

export async function productMasterRoutes(fastify: FastifyInstance) {
  // 조회: 전체 허용
  fastify.get("/", async (request) => {
    const { search, manufacturer, page, limit } = request.query as any;
    return fastify.productMasterService.list({
      search: search || undefined,
      manufacturer: manufacturer || undefined,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
    });
  });

  fastify.get("/manufacturers", async () => {
    return fastify.productMasterService.getManufacturers();
  });

  fastify.get("/:id", async (request) => {
    return fastify.productMasterService.getById((request.params as any).id);
  });

  // 생성/수정: ADMIN, MANAGER
  fastify.post("/", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request, reply) => {
    const result = await fastify.productMasterService.create(request.body as any);
    return reply.status(201).send(result);
  });

  fastify.patch("/:id", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request) => {
    const { id } = request.params as any;
    return fastify.productMasterService.update(id, request.body as any);
  });

  // 삭제: ADMIN만
  fastify.delete("/:id", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    await fastify.productMasterService.remove((request.params as any).id);
    return reply.status(204).send();
  });
}

export async function contractRoutes(fastify: FastifyInstance) {
  // 조회: 전체 허용
  fastify.get("/", async (request) => {
    const { search, status, page, limit } = request.query as any;
    return fastify.contractService.list({
      search: search || undefined,
      status: status || undefined,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
    });
  });

  fastify.get("/:id", async (request) => {
    return fastify.contractService.getById((request.params as any).id);
  });

  // 생성/수정: ADMIN, MANAGER
  fastify.post("/", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request, reply) => {
    const result = await fastify.contractService.create({
      ...(request.body as any),
      createdBy: request.userId || "system",
    });
    return reply.status(201).send(result);
  });

  fastify.patch("/:id", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request) => {
    const { id } = request.params as any;
    return fastify.contractService.update(id, request.body as any);
  });

  // 삭제: ADMIN만
  fastify.delete("/:id", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    await fastify.contractService.remove((request.params as any).id);
    return reply.status(204).send();
  });
}

export async function overseasOrderRoutes(fastify: FastifyInstance) {
  // 조회: 전체 허용
  fastify.get("/", async (request) => {
    const { search, status, currency, orderType, contractId, page, limit } = request.query as any;
    return fastify.overseasOrderService.list({
      search: search || undefined,
      status: status || undefined,
      currency: currency || undefined,
      orderType: orderType || undefined,
      contractId: contractId || undefined,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
    });
  });

  fastify.get("/dashboard", async () => {
    return fastify.overseasOrderService.getDashboardStats();
  });

  fastify.get("/:id", async (request) => {
    return fastify.overseasOrderService.getById((request.params as any).id);
  });

  // 생성: ADMIN, MANAGER, OPERATOR (영업팀원도 발주 등록 가능)
  fastify.post("/", { preHandler: [requireRole("ADMIN", "MANAGER", "OPERATOR")] }, async (request, reply) => {
    const result = await fastify.overseasOrderService.create({
      ...(request.body as any),
      orderedBy: request.userId || "system",
    });
    return reply.status(201).send(result);
  });

  // 수정: ADMIN, MANAGER
  fastify.patch("/:id", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request) => {
    const { id } = request.params as any;
    return fastify.overseasOrderService.update(id, request.body as any);
  });

  // 상태 전환: ADMIN, MANAGER
  fastify.post("/:id/transition", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request) => {
    const { id } = request.params as any;
    const { status } = request.body as any;
    return fastify.overseasOrderService.transition(id, status, request.userId || "system");
  });

  // 삭제: ADMIN만
  fastify.delete("/:id", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    await fastify.overseasOrderService.remove((request.params as any).id);
    return reply.status(204).send();
  });

  // ─── Items (ADMIN, MANAGER) ────────────────────────────────────────────

  fastify.post("/:id/items", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request, reply) => {
    const { id } = request.params as any;
    const result = await fastify.overseasOrderService.addItem(id, request.body as any);
    return reply.status(201).send(result);
  });

  fastify.patch("/items/:itemId", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request) => {
    const { itemId } = request.params as any;
    return fastify.overseasOrderService.updateItem(itemId, request.body as any);
  });

  fastify.delete("/items/:itemId", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    await fastify.overseasOrderService.removeItem((request.params as any).itemId);
    return reply.status(204).send();
  });

  // ─── Partial Receipt (ADMIN, MANAGER) ──────────────────────────────────

  fastify.post("/:id/receive", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request) => {
    const { id } = request.params as any;
    const { receipts } = request.body as any;
    return fastify.overseasOrderService.receiveItems(id, receipts, request.userId || "system");
  });

  // ─── Progress Logs ─────────────────────────────────────────────────────

  fastify.get("/:id/progress", async (request) => {
    const { id } = request.params as any;
    const { page, limit } = request.query as any;
    return fastify.orderProgressService.list(id, {
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
    });
  });

  fastify.post("/:id/progress", { preHandler: [requireRole("ADMIN", "MANAGER", "OPERATOR")] }, async (request, reply) => {
    const { id } = request.params as any;
    const result = await fastify.orderProgressService.create(id, {
      ...(request.body as any),
      updatedBy: request.userId || "system",
    });
    return reply.status(201).send(result);
  });

  fastify.delete("/progress/:logId", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    await fastify.orderProgressService.remove((request.params as any).logId);
    return reply.status(204).send();
  });
}
