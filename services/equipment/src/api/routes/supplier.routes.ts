import { FastifyInstance } from "fastify";
import { requireRole } from "../middleware/auth.middleware.js";

export async function supplierRoutes(fastify: FastifyInstance) {
  // 조회: 전체 허용
  fastify.get("/", async (request) => {
    const { search, page, limit } = request.query as any;
    return fastify.supplierService.list({
      search: search || undefined,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 100,
    });
  });

  fastify.get("/by-name", async (request, reply) => {
    const { name } = request.query as any;
    if (!name) return reply.status(400).send({ error: "name 파라미터 필요" });
    const s = await fastify.supplierService.findByName(name);
    if (!s) return reply.status(404).send({ error: "제조사를 찾을 수 없습니다." });
    return s;
  });

  fastify.get("/:id", async (request) => {
    return fastify.supplierService.getDetail((request.params as any).id);
  });

  // 생성/수정: ADMIN, MANAGER
  fastify.post("/", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request, reply) => {
    const result = await fastify.supplierService.create(request.body as any);
    return reply.status(201).send(result);
  });

  fastify.patch("/:id", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request) => {
    return fastify.supplierService.update((request.params as any).id, request.body as any);
  });

  // 삭제: ADMIN만
  fastify.delete("/:id", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    await fastify.supplierService.remove((request.params as any).id);
    return reply.status(204).send();
  });

  // ─── Contacts ──────────────────────────────────────────────────────────────

  fastify.post("/:id/contacts", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request, reply) => {
    const { id } = request.params as any;
    const result = await fastify.supplierService.addContact(id, request.body as any);
    return reply.status(201).send(result);
  });

  fastify.patch("/contacts/:contactId", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request) => {
    const { contactId } = request.params as any;
    return fastify.supplierService.updateContact(contactId, request.body as any);
  });

  fastify.delete("/contacts/:contactId", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    await fastify.supplierService.removeContact((request.params as any).contactId);
    return reply.status(204).send();
  });
}
