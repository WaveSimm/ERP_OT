import { FastifyInstance } from "fastify";
import { requireRole } from "../middleware/auth.middleware.js";

export async function inventoryRoutes(fastify: FastifyInstance) {
  // 조회: 전체 허용
  fastify.get("/", async (request) => {
    const q = request.query as any;
    return fastify.inventoryService.list({
      category: q.category,
      status: q.status,
      location: q.location,
      search: q.search,
      page: q.page ? parseInt(q.page) : 1,
      limit: q.limit ? parseInt(q.limit) : 50,
    });
  });

  fastify.get("/filter-options", async () => {
    return fastify.inventoryService.getFilterOptions();
  });

  fastify.get("/stats", async () => {
    return fastify.inventoryService.getStats();
  });

  fastify.get("/by-no/:inventoryNo", async (request, reply) => {
    const { inventoryNo } = request.params as any;
    const item = await fastify.prisma.inventoryItem.findUnique({
      where: { inventoryNo },
      select: { id: true, inventoryNo: true, itemName: true },
    });
    if (!item) return reply.status(404).send({ error: "재고를 찾을 수 없습니다." });
    return item;
  });

  fastify.get("/:id", async (request) => {
    return fastify.inventoryService.getById((request.params as any).id);
  });

  // 생성: ADMIN, MANAGER
  fastify.post("/", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request, reply) => {
    const body = request.body as any;
    const result = await fastify.inventoryService.create({
      ...body,
      createdBy: request.userId,
    });
    return reply.status(201).send(result);
  });

  fastify.post("/from-receipt", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request, reply) => {
    const body = request.body as any;
    const result = await fastify.inventoryService.createFromReceipt({
      orderItemId: body.orderItemId,
      serialNumber: body.serialNumber,
      currentLocation: body.currentLocation,
      createdBy: request.userId,
    });
    return reply.status(201).send(result);
  });

  // 수정: ADMIN, MANAGER
  fastify.patch("/:id", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request) => {
    return fastify.inventoryService.update((request.params as any).id, request.body as any);
  });

  // 삭제 (2026-05-13, 운용 전 한정): ADMIN — 재고+의존 이력 cascade
  // 운용 도입 후엔 폐기/EXCLUDED 상태 변경으로 대체 예정
  fastify.delete("/:id", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    await fastify.inventoryService.delete((request.params as any).id);
    return reply.status(204).send();
  });
}

export async function inventoryTransactionRoutes(fastify: FastifyInstance) {
  // 조회: 전체 허용
  fastify.get("/item/:itemId", async (request) => {
    return fastify.inventoryTransactionService.listByItem((request.params as any).itemId);
  });

  fastify.get("/recent", async (request) => {
    const q = request.query as any;
    return fastify.inventoryTransactionService.listRecent({
      type: q.type,
      limit: q.limit ? parseInt(q.limit) : 50,
    });
  });

  // 입출고 등록: ADMIN, MANAGER
  fastify.post("/", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request, reply) => {
    const body = request.body as any;
    const result = await fastify.inventoryTransactionService.create({
      ...body,
      createdBy: request.userId,
    });
    return reply.status(201).send(result);
  });
}

export async function assetCostRoutes(fastify: FastifyInstance) {
  // 조회: 전체 허용
  fastify.get("/item/:itemId", async (request) => {
    return fastify.assetCostService.listByItem((request.params as any).itemId);
  });

  // 비용 등록: ADMIN, MANAGER
  fastify.post("/", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request, reply) => {
    const body = request.body as any;
    const result = await fastify.assetCostService.create({
      ...body,
      createdBy: request.userId,
    });
    return reply.status(201).send(result);
  });

  // 비용 삭제: ADMIN만
  fastify.delete("/:id", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    await fastify.assetCostService.remove((request.params as any).id);
    return reply.status(204).send();
  });
}
