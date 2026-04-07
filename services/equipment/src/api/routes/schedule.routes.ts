import { FastifyInstance } from "fastify";
import { requireRole } from "../middleware/auth.middleware.js";

export async function scheduleRoutes(fastify: FastifyInstance) {
  // 장비 일정
  fastify.get("/equipment/:id", async (request) => {
    const { id } = request.params as any;
    const { startDate, endDate } = request.query as any;
    return fastify.scheduleService.listByEquipment(id, startDate, endDate);
  });

  // 센서 일정
  fastify.get("/sensor/:id", async (request) => {
    const { id } = request.params as any;
    const { startDate, endDate } = request.query as any;
    return fastify.scheduleService.listBySensor(id, startDate, endDate);
  });

  // 전체 타임라인
  fastify.get("/timeline", async (request) => {
    const { startDate, endDate, assetType, categoryId } = request.query as any;
    return fastify.scheduleService.getTimeline({ startDate, endDate, assetType, categoryId });
  });

  // 일정 등록
  fastify.post("/", { preHandler: requireRole("ADMIN", "MANAGER") }, async (request, reply) => {
    const result = await fastify.scheduleService.create(request.body as any, request.userId);
    return reply.status(201).send(result);
  });

  // 일정 수정
  fastify.put("/:id", { preHandler: requireRole("ADMIN", "MANAGER") }, async (request) => {
    const { id } = request.params as any;
    return fastify.scheduleService.update(id, request.body as any);
  });

  // 일정 삭제
  fastify.delete("/:id", { preHandler: requireRole("ADMIN") }, async (request, reply) => {
    await fastify.scheduleService.remove((request.params as any).id);
    return reply.status(204).send();
  });
}
