import { FastifyInstance } from "fastify";
import { requireRole } from "../middleware/auth.middleware.js";

export async function templateRoutes(fastify: FastifyInstance) {
  fastify.get("/", async (request) => {
    const { categoryId, isPublic } = request.query as any;
    return fastify.templateService.list({
      ...(categoryId && { categoryId }),
      ...(isPublic !== undefined && { isPublic: isPublic === "true" }),
    });
  });

  fastify.get("/:id", async (request) => {
    return fastify.templateService.getById((request.params as any).id);
  });

  fastify.post("/", { preHandler: requireRole("ADMIN", "MANAGER") }, async (request, reply) => {
    const result = await fastify.templateService.create(request.body as any, request.userId);
    return reply.status(201).send(result);
  });

  fastify.put("/:id", { preHandler: requireRole("ADMIN", "MANAGER") }, async (request) => {
    return fastify.templateService.update((request.params as any).id, request.body as any);
  });

  fastify.delete("/:id", { preHandler: requireRole("ADMIN", "MANAGER") }, async (request, reply) => {
    await fastify.templateService.remove((request.params as any).id);
    return reply.status(204).send();
  });

  // 투입 구성에서 템플릿 저장
  fastify.post("/from-deployment/:deploymentId", { preHandler: requireRole("ADMIN", "MANAGER") }, async (request, reply) => {
    const result = await fastify.templateService.saveFromDeployment(
      (request.params as any).deploymentId,
      request.body as any,
      request.userId,
    );
    return reply.status(201).send(result);
  });
}
