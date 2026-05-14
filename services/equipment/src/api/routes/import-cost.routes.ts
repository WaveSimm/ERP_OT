import { FastifyInstance } from "fastify";
import { requireRole } from "../middleware/auth.middleware.js";

export async function importCostRoutes(fastify: FastifyInstance) {
  // 조회: 전체 허용
  fastify.get("/", async (request) => {
    const q = request.query as any;
    return fastify.importCostService.list({
      ...(q.sortBy && { sortBy: q.sortBy }),
      ...((q.sortOrder === "asc" || q.sortOrder === "desc") && { sortOrder: q.sortOrder }),
    });
  });

  fastify.get("/:id", async (request) => {
    return fastify.importCostService.getById((request.params as any).id);
  });

  // 생성: ADMIN, MANAGER
  fastify.post("/", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request, reply) => {
    const body = request.body as any;
    const result = await fastify.importCostService.create({
      ...body,
      createdBy: request.userId,
    });
    return reply.status(201).send(result);
  });

  // 부대비용 추가: ADMIN, MANAGER
  fastify.post("/:id/extras", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request, reply) => {
    const body = request.body as any;
    const result = await fastify.importCostService.addExtra((request.params as any).id, body);
    return reply.status(201).send(result);
  });

  // 계약 연결: ADMIN, MANAGER
  fastify.patch("/:id/contract", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request) => {
    const { contractId } = request.body as any;
    return fastify.importCostService.updateContract((request.params as any).id, contractId || null);
  });

  // 송금 추가: ADMIN, MANAGER
  fastify.post("/:id/remittances", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request, reply) => {
    const body = request.body as any;
    const result = await fastify.importCostService.addRemittance((request.params as any).id, body);
    return reply.status(201).send(result);
  });

  // 송금 삭제: ADMIN, MANAGER
  fastify.delete("/remittances/:remittanceId", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request, reply) => {
    await fastify.importCostService.removeRemittance((request.params as any).remittanceId);
    return reply.status(204).send();
  });

  // 삭제: ADMIN만
  fastify.delete("/:id", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    await fastify.importCostService.remove((request.params as any).id);
    return reply.status(204).send();
  });
}
