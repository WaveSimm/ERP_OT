import { FastifyInstance } from "fastify";

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

  fastify.post("/", async (request, reply) => {
    const result = await fastify.repairQuoteService.create(request.body as any);
    return reply.status(201).send(result);
  });

  fastify.patch("/:id", async (request) => {
    const { id } = request.params as any;
    return fastify.repairQuoteService.update(id, request.body as any);
  });

  fastify.patch("/:id/status", async (request) => {
    const { id } = request.params as any;
    const { status } = request.body as any;
    const userId = (request as any).user?.id;
    return fastify.repairQuoteService.changeStatus(id, status, userId);
  });

  fastify.delete("/:id", async (request, reply) => {
    const { id } = request.params as any;
    await fastify.repairQuoteService.remove(id);
    return reply.status(204).send();
  });

  // 견적 항목
  fastify.post("/:id/items", async (request, reply) => {
    const { id } = request.params as any;
    const result = await fastify.repairQuoteService.addItem(id, request.body as any);
    return reply.status(201).send(result);
  });

  fastify.patch("/items/:itemId", async (request) => {
    const { itemId } = request.params as any;
    return fastify.repairQuoteService.updateItem(itemId, request.body as any);
  });

  fastify.delete("/items/:itemId", async (request, reply) => {
    const { itemId } = request.params as any;
    await fastify.repairQuoteService.removeItem(itemId);
    return reply.status(204).send();
  });
}
