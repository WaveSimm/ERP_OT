import { FastifyInstance } from "fastify";
import { requireRole } from "../middleware/auth.middleware.js";

export async function customerAssetRoutes(fastify: FastifyInstance) {
  fastify.get("/", async (request) => {
    const { customerId, search, page, limit } = request.query as any;
    return fastify.customerAssetService.list({
      customerId: customerId || undefined,
      search: search || undefined,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
    });
  });

  fastify.get("/:id", async (request) => {
    const { id } = request.params as any;
    return fastify.customerAssetService.getById(id);
  });

  fastify.post("/", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request, reply) => {
    const result = await fastify.customerAssetService.create(request.body as any);
    return reply.status(201).send(result);
  });

  fastify.patch("/:id", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request) => {
    const { id } = request.params as any;
    return fastify.customerAssetService.update(id, request.body as any);
  });

  fastify.delete("/:id", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    await fastify.customerAssetService.remove((request.params as any).id);
    return reply.status(204).send();
  });
}
