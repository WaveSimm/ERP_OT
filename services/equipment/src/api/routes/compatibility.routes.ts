import { FastifyInstance } from "fastify";
import { requireRole } from "../middleware/auth.middleware.js";

export async function compatibilityRoutes(fastify: FastifyInstance) {
  // 장비에 호환되는 센서 목록
  fastify.get("/equipment/:id", async (request) => {
    return fastify.compatibilityService.listByEquipment((request.params as any).id);
  });

  // 센서에 호환되는 장비 목록
  fastify.get("/sensor/:id", async (request) => {
    return fastify.compatibilityService.listBySensor((request.params as any).id);
  });

  // 호환성 등록
  fastify.post("/", { preHandler: requireRole("ADMIN", "MANAGER") }, async (request, reply) => {
    const result = await fastify.compatibilityService.create(request.body as any);
    return reply.status(201).send(result);
  });

  // 호환성 삭제
  fastify.delete("/:id", { preHandler: requireRole("ADMIN") }, async (request, reply) => {
    await fastify.compatibilityService.remove((request.params as any).id);
    return reply.status(204).send();
  });
}
