import { FastifyInstance } from "fastify";
import { requireRole } from "../middleware/auth.middleware.js";

export async function repairOrderRoutes(fastify: FastifyInstance) {
  // 목록
  fastify.get("/", async (request) => {
    const { status, statusGroup, customerId, search, page, limit } = request.query as any;
    return fastify.repairOrderService.list({
      status: status || undefined,
      statusGroup: statusGroup || undefined,
      customerId: customerId || undefined,
      search: search || undefined,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
    });
  });

  // 상세
  fastify.get("/:id", async (request) => {
    const { id } = request.params as any;
    return fastify.repairOrderService.getById(id);
  });

  // 상태 전이 가능 목록
  fastify.get("/:id/transitions", async (request) => {
    const { id } = request.params as any;
    return fastify.repairOrderService.getStatusTransitions(id);
  });

  // 생성
  fastify.post("/", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request, reply) => {
    const result = await fastify.repairOrderService.create(request.body as any);
    return reply.status(201).send(result);
  });

  // 수정
  fastify.patch("/:id", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request) => {
    const { id } = request.params as any;
    return fastify.repairOrderService.update(id, request.body as any);
  });

  // 상태 변경 (FSM)
  fastify.patch("/:id/status", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request) => {
    const { id } = request.params as any;
    const { status } = request.body as any;
    const userId = (request as any).user?.id;
    return fastify.repairOrderService.changeStatus(id, status, userId);
  });

  // 점검진행상황 업데이트
  fastify.patch("/:id/tech-status", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request) => {
    const { id } = request.params as any;
    const { techStatus } = request.body as any;
    return fastify.repairOrderService.updateTechStatus(id, techStatus);
  });

  // 영업부진행상황 업데이트
  fastify.patch("/:id/sales-status", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request) => {
    const { id } = request.params as any;
    const { salesStatus } = request.body as any;
    return fastify.repairOrderService.updateSalesStatus(id, salesStatus);
  });

  // 삭제
  fastify.delete("/:id", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    await fastify.repairOrderService.remove((request.params as any).id);
    return reply.status(204).send();
  });
}
