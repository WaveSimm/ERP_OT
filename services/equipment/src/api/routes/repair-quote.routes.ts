import { FastifyInstance } from "fastify";
import { requireRole } from "../middleware/auth.middleware.js";

export async function repairQuoteRoutes(fastify: FastifyInstance) {
  fastify.get("/", async (request) => {
    const { repairOrderId } = request.query as any;
    if (!repairOrderId) throw new Error("repairOrderId는 필수입니다.");
    return fastify.repairQuoteService.listByRepairOrder(repairOrderId);
  });

  fastify.get("/:id", async (request) => {
    const { id } = request.params as any;
    return fastify.repairQuoteService.getById(id);
  });

  fastify.post("/", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request, reply) => {
    const result = await fastify.repairQuoteService.create(request.body as any);
    return reply.status(201).send(result);
  });

  fastify.patch("/:id", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request) => {
    const { id } = request.params as any;
    return fastify.repairQuoteService.update(id, request.body as any);
  });

  fastify.patch("/:id/status", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request) => {
    const { id } = request.params as any;
    const { status } = request.body as any;
    const userId = (request as any).user?.id;
    return fastify.repairQuoteService.changeStatus(id, status, userId);
  });

  fastify.delete("/:id", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    const { id } = request.params as any;
    await fastify.repairQuoteService.remove(id);
    return reply.status(204).send();
  });

  // 견적 항목
  fastify.post("/:id/items", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request, reply) => {
    const { id } = request.params as any;
    const result = await fastify.repairQuoteService.addItem(id, request.body as any);
    return reply.status(201).send(result);
  });

  fastify.patch("/items/:itemId", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request) => {
    const { itemId } = request.params as any;
    return fastify.repairQuoteService.updateItem(itemId, request.body as any);
  });

  fastify.delete("/items/:itemId", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    const { itemId } = request.params as any;
    await fastify.repairQuoteService.removeItem(itemId);
    return reply.status(204).send();
  });
}
