import { FastifyInstance } from "fastify";
import { requireRole } from "../middleware/auth.middleware.js";

export async function importCostRoutes(fastify: FastifyInstance) {
  // 조회: 전체 허용
  fastify.get("/", async () => {
    return fastify.importCostService.list();
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

  // 삭제: ADMIN만
  fastify.delete("/:id", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    await fastify.importCostService.remove((request.params as any).id);
    return reply.status(204).send();
  });
}
