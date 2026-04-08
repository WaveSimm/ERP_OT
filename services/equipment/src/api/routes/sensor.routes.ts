import { FastifyInstance } from "fastify";
import { requireRole } from "../middleware/auth.middleware.js";

export async function sensorRoutes(fastify: FastifyInstance) {
  fastify.get("/", async (request) => {
    const { categoryId, status, search, page, limit } = request.query as any;
    return fastify.sensorService.list({
      ...(categoryId && { categoryId }),
      ...(status && { status }),
      ...(search && { search }),
      ...(page && { page: parseInt(page) }),
      ...(limit && { limit: parseInt(limit) }),
    });
  });

  fastify.get("/available", async (request) => {
    const { categoryId, startDate, endDate } = request.query as any;
    return fastify.sensorService.listAvailable(categoryId, startDate, endDate);
  });

  fastify.get("/:id", async (request) => {
    return fastify.sensorService.getById((request.params as any).id);
  });

  fastify.post("/", { preHandler: requireRole("ADMIN", "MANAGER") }, async (request, reply) => {
    const result = await fastify.sensorService.create(request.body as any, request.userId);
    return reply.status(201).send(result);
  });

  fastify.put("/:id", { preHandler: requireRole("ADMIN", "MANAGER") }, async (request) => {
    const { id } = request.params as any;
    return fastify.sensorService.update(id, request.body as any);
  });

  fastify.patch("/:id/status", { preHandler: requireRole("ADMIN", "MANAGER") }, async (request) => {
    const { id } = request.params as any;
    const { status } = request.body as any;
    return fastify.sensorService.changeStatus(id, status);
  });

  fastify.delete("/:id", { preHandler: requireRole("ADMIN", "MANAGER") }, async (request, reply) => {
    await fastify.sensorService.remove((request.params as any).id);
    return reply.status(204).send();
  });

  fastify.get("/:id/deployment-history", async (request) => {
    return fastify.sensorService.getDeploymentHistory((request.params as any).id);
  });

  // 센서 정비 이력
  fastify.get("/:id/maintenance", async (request) => {
    const { id } = request.params as any;
    const { page, limit } = request.query as any;
    return fastify.maintenanceService.listBySensor(id, page ? parseInt(page) : 1, limit ? parseInt(limit) : 20);
  });

  // 센서 일정
  fastify.get("/:id/schedules", async (request) => {
    const { id } = request.params as any;
    const { startDate, endDate } = request.query as any;
    return fastify.scheduleService.listBySensor(id, startDate, endDate);
  });
}
