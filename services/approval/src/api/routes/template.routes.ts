import { FastifyInstance } from "fastify";
import { requireRole } from "../middleware/auth.middleware";

export async function templateRoutes(fastify: FastifyInstance) {
  fastify.get("/", async (request) => {
    const { category, activeOnly } = request.query as any;
    return fastify.templateService.list({
      category: category || undefined,
      activeOnly: activeOnly !== "false",
    });
  });

  fastify.get("/:id", async (request) => {
    return fastify.templateService.getById((request.params as any).id);
  });

  fastify.post("/", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    const result = await fastify.templateService.create(request.body as any);
    return reply.status(201).send(result);
  });

  fastify.put("/:id", { preHandler: [requireRole("ADMIN")] }, async (request) => {
    const { id } = request.params as any;
    return fastify.templateService.update(id, request.body as any);
  });

  fastify.delete("/:id", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    await fastify.templateService.remove((request.params as any).id);
    return reply.status(204).send();
  });
}
