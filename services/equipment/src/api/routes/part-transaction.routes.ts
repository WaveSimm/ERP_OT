import { FastifyInstance } from "fastify";
import { requireRole } from "../middleware/auth.middleware.js";

export async function partTransactionRoutes(fastify: FastifyInstance) {
  fastify.get("/", async (request) => {
    const { partId, repairOrderId, page, limit } = request.query as any;
    return fastify.partService.listTransactions({
      partId: partId || undefined,
      repairOrderId: repairOrderId || undefined,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
    });
  });

  fastify.post("/", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request, reply) => {
    const result = await fastify.partService.createTransaction(request.body as any);
    return reply.status(201).send(result);
  });
}
