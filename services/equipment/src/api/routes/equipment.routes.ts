import { FastifyInstance } from "fastify";
import { requireRole } from "../middleware/auth.middleware.js";

export async function equipmentRoutes(fastify: FastifyInstance) {
  // GET /equipment — 장비 목록
  fastify.get("/", async (request) => {
    const { categoryId, status, search, page, limit } = request.query as any;
    return fastify.equipmentService.list({
      ...(categoryId && { categoryId }),
      ...(status && { status }),
      ...(search && { search }),
      ...(page && { page: parseInt(page) }),
      ...(limit && { limit: parseInt(limit) }),
    });
  });

  // GET /equipment/:id — 장비 상세
  fastify.get("/:id", async (request) => {
    const { id } = request.params as any;
    return fastify.equipmentService.getById(id);
  });

  // POST /equipment — 장비 등록
  fastify.post("/", { preHandler: requireRole("ADMIN", "MANAGER") }, async (request, reply) => {
    const result = await fastify.equipmentService.create(request.body as any, request.userId);
    return reply.status(201).send(result);
  });

  // PUT /equipment/:id — 장비 수정
  fastify.put("/:id", { preHandler: requireRole("ADMIN", "MANAGER") }, async (request) => {
    const { id } = request.params as any;
    return fastify.equipmentService.update(id, request.body as any);
  });

  // PATCH /equipment/:id/status — 상태 변경
  fastify.patch("/:id/status", { preHandler: requireRole("ADMIN", "MANAGER") }, async (request) => {
    const { id } = request.params as any;
    const { status } = request.body as any;
    return fastify.equipmentService.changeStatus(id, status);
  });

  // DELETE /equipment/:id — 장비 퇴역
  fastify.delete("/:id", { preHandler: requireRole("ADMIN") }, async (request, reply) => {
    await fastify.equipmentService.remove((request.params as any).id);
    return reply.status(204).send();
  });

  // ── 구성요소 ──

  // GET /equipment/:id/components
  fastify.get("/:id/components", async (request) => {
    const { id } = request.params as any;
    return fastify.equipmentService.listComponents(id);
  });

  // POST /equipment/:id/components
  fastify.post("/:id/components", { preHandler: requireRole("ADMIN", "MANAGER") }, async (request, reply) => {
    const { id } = request.params as any;
    const result = await fastify.equipmentService.addComponent(id, request.body as any);
    return reply.status(201).send(result);
  });

  // PUT /equipment/components/:compId
  fastify.put("/components/:compId", { preHandler: requireRole("ADMIN", "MANAGER") }, async (request) => {
    const { compId } = request.params as any;
    return fastify.equipmentService.updateComponent(compId, request.body as any);
  });

  // DELETE /equipment/components/:compId
  fastify.delete("/components/:compId", { preHandler: requireRole("ADMIN") }, async (request, reply) => {
    await fastify.equipmentService.removeComponent((request.params as any).compId);
    return reply.status(204).send();
  });
}
