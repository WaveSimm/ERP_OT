import { FastifyInstance } from "fastify";

export async function repairCostRoutes(fastify: FastifyInstance) {
  fastify.get("/", async (request) => {
    const { repairOrderId } = request.query as any;
    if (!repairOrderId) throw new Error("repairOrderId는 필수입니다.");
    return fastify.repairCostService.listByRepairOrder(repairOrderId);
  });

  fastify.post("/", async (request, reply) => {
    const result = await fastify.repairCostService.create(request.body as any);
    return reply.status(201).send(result);
  });

  fastify.patch("/:id", async (request) => {
    const { id } = request.params as any;
    return fastify.repairCostService.update(id, request.body as any);
  });

  fastify.delete("/:id", async (request, reply) => {
    const { id } = request.params as any;
    await fastify.repairCostService.remove(id);
    return reply.status(204).send();
  });
}
