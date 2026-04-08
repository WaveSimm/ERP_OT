import { FastifyInstance } from "fastify";
import { requireRole } from "../middleware/auth.middleware.js";

export async function categoryRoutes(fastify: FastifyInstance) {
  fastify.get("/", async (request) => {
    const { type } = request.query as any;
    return fastify.categoryService.list(type);
  });

  fastify.post("/", { preHandler: requireRole("ADMIN", "MANAGER") }, async (request, reply) => {
    const result = await fastify.categoryService.create(request.body as any);
    return reply.status(201).send(result);
  });

  fastify.put("/:id", { preHandler: requireRole("ADMIN", "MANAGER") }, async (request) => {
    const { id } = request.params as any;
    return fastify.categoryService.update(id, request.body as any);
  });

  fastify.delete("/:id", { preHandler: requireRole("ADMIN", "MANAGER") }, async (request, reply) => {
    await fastify.categoryService.remove((request.params as any).id);
    return reply.status(204).send();
  });
}
