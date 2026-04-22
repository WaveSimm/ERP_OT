import { FastifyInstance } from "fastify";
import { requireRole } from "../middleware/auth.middleware.js";

export async function repairCostRoutes(fastify: FastifyInstance) {
  fastify.get("/", async (request) => {
    const { repairOrderId } = request.query as any;
    if (!repairOrderId) throw new Error("repairOrderId는 필수입니다.");
    return fastify.repairCostService.listByRepairOrder(repairOrderId);
  });

  fastify.post("/", { preHandler: [requireRole("ADMIN", "MANAGER", "OPERATOR")] }, async (request, reply) => {
    const result = await fastify.repairCostService.create(request.body as any);
    return reply.status(201).send(result);
  });

  fastify.patch("/:id", { preHandler: [requireRole("ADMIN", "MANAGER", "OPERATOR")] }, async (request) => {
    const { id } = request.params as any;
    return fastify.repairCostService.update(id, request.body as any);
  });

  fastify.delete("/:id", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    const { id } = request.params as any;
    await fastify.repairCostService.remove(id);
    return reply.status(204).send();
  });
}
