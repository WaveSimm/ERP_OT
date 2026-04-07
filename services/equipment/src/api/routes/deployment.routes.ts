import { FastifyInstance } from "fastify";
import { requireRole } from "../middleware/auth.middleware.js";

export async function deploymentRoutes(fastify: FastifyInstance) {
  fastify.get("/", async (request) => {
    const { projectId, equipmentId, sensorId, status, page, limit } = request.query as any;
    return fastify.deploymentService.list({
      ...(projectId && { projectId }),
      ...(equipmentId && { equipmentId }),
      ...(sensorId && { sensorId }),
      ...(status && { status }),
      ...(page && { page: parseInt(page) }),
      ...(limit && { limit: parseInt(limit) }),
    });
  });

  fastify.get("/by-task/:taskId", async (request) => {
    return fastify.deploymentService.listByTask((request.params as any).taskId);
  });

  fastify.get("/:id", async (request) => {
    return fastify.deploymentService.getById((request.params as any).id);
  });

  fastify.post("/", { preHandler: requireRole("ADMIN", "MANAGER") }, async (request, reply) => {
    const result = await fastify.deploymentService.create(request.body as any, request.userId);
    return reply.status(201).send(result);
  });

  fastify.post("/:id/activate", { preHandler: requireRole("ADMIN", "MANAGER") }, async (request) => {
    return fastify.deploymentService.activate((request.params as any).id);
  });

  fastify.post("/:id/complete", { preHandler: requireRole("ADMIN", "MANAGER") }, async (request) => {
    return fastify.deploymentService.complete((request.params as any).id);
  });

  fastify.post("/:id/cancel", { preHandler: requireRole("ADMIN", "MANAGER") }, async (request) => {
    return fastify.deploymentService.cancel((request.params as any).id);
  });
}
