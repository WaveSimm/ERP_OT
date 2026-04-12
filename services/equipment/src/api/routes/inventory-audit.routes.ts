import { FastifyInstance } from "fastify";
import { requireRole } from "../middleware/auth.middleware.js";

export async function inventoryAuditRoutes(fastify: FastifyInstance) {
  // 조회: 전체 허용
  fastify.get("/", async () => fastify.inventoryAuditService.list());

  fastify.get("/:id", async (request) =>
    fastify.inventoryAuditService.getById((request.params as any).id));

  // 생성/시작/완료: ADMIN, MANAGER
  fastify.post("/", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request, reply) => {
    const body = request.body as any;
    const result = await fastify.inventoryAuditService.create({
      ...body,
      createdBy: request.userId,
    });
    return reply.status(201).send(result);
  });

  fastify.post("/:id/start", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request) =>
    fastify.inventoryAuditService.start((request.params as any).id));

  fastify.post("/:id/complete", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request) =>
    fastify.inventoryAuditService.complete((request.params as any).id));

  // 실사 체크: ADMIN, MANAGER, OPERATOR
  fastify.post("/items/:itemId/check", { preHandler: [requireRole("ADMIN", "MANAGER", "OPERATOR")] }, async (request) => {
    const body = request.body as any;
    return fastify.inventoryAuditService.checkItem((request.params as any).itemId, {
      ...body,
      checkedBy: request.userId,
    });
  });

  // 실사 항목 리셋 (미확인으로 되돌리기)
  fastify.post("/items/:itemId/reset", { preHandler: [requireRole("ADMIN", "MANAGER", "OPERATOR")] }, async (request) =>
    fastify.inventoryAuditService.resetItem((request.params as any).itemId));
}
