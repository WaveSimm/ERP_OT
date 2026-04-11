import { FastifyInstance } from "fastify";
import { requireRole } from "../middleware/auth.middleware.js";

export async function partRoutes(fastify: FastifyInstance) {
  fastify.get("/", async (request) => {
    const { search, lowStock, page, limit } = request.query as any;
    return fastify.partService.list({
      search: search || undefined,
      lowStock: lowStock === "true",
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
    });
  });

  fastify.get("/:id", async (request) => {
    const { id } = request.params as any;
    return fastify.partService.getById(id);
  });

  fastify.post("/", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request, reply) => {
    const result = await fastify.partService.create(request.body as any);
    return reply.status(201).send(result);
  });

  fastify.patch("/:id", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request) => {
    const { id } = request.params as any;
    return fastify.partService.update(id, request.body as any);
  });

  fastify.delete("/:id", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    const { id } = request.params as any;
    await fastify.partService.remove(id);
    return reply.status(204).send();
  });
}
