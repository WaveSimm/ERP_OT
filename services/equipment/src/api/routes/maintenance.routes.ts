import { FastifyInstance } from "fastify";
import { requireRole } from "../middleware/auth.middleware.js";

export async function maintenanceRoutes(fastify: FastifyInstance) {
  // 장비 정비 이력
  fastify.get("/equipment/:id", async (request) => {
    const { id } = request.params as any;
    const { page, limit } = request.query as any;
    return fastify.maintenanceService.listByEquipment(id, page ? parseInt(page) : 1, limit ? parseInt(limit) : 20);
  });

  // 센서 정비 이력
  fastify.get("/sensor/:id", async (request) => {
    const { id } = request.params as any;
    const { page, limit } = request.query as any;
    return fastify.maintenanceService.listBySensor(id, page ? parseInt(page) : 1, limit ? parseInt(limit) : 20);
  });

  // 정비 기록 등록
  fastify.post("/", { preHandler: requireRole("ADMIN", "MANAGER") }, async (request, reply) => {
    const result = await fastify.maintenanceService.create(request.body as any, request.userId);
    return reply.status(201).send(result);
  });

  // 정비 기록 수정
  fastify.put("/:id", { preHandler: requireRole("ADMIN", "MANAGER") }, async (request) => {
    const { id } = request.params as any;
    return fastify.maintenanceService.update(id, request.body as any);
  });

  // 정비 기록 삭제
  fastify.delete("/:id", { preHandler: requireRole("ADMIN", "MANAGER") }, async (request, reply) => {
    await fastify.maintenanceService.remove((request.params as any).id);
    return reply.status(204).send();
  });
}
