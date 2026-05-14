import { FastifyInstance } from "fastify";
import { requireRole } from "../middleware/auth.middleware.js";

export async function customerRoutes(fastify: FastifyInstance) {
  // 목록
  fastify.get("/", async (request) => {
    const { search, page, limit, sortBy, sortOrder } = request.query as any;
    return fastify.customerService.list({
      search: search || undefined,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
      ...(sortBy && { sortBy }),
      ...((sortOrder === "asc" || sortOrder === "desc") && { sortOrder }),
    });
  });

  // 상세
  fastify.get("/:id", async (request) => {
    const { id } = request.params as any;
    return fastify.customerService.getById(id);
  });

  // 생성
  fastify.post("/", { preHandler: [requireRole("ADMIN", "MANAGER", "OPERATOR")] }, async (request, reply) => {
    const result = await fastify.customerService.create(request.body as any);
    return reply.status(201).send(result);
  });

  // 수정
  fastify.patch("/:id", { preHandler: [requireRole("ADMIN", "MANAGER", "OPERATOR")] }, async (request) => {
    const { id } = request.params as any;
    return fastify.customerService.update(id, request.body as any);
  });

  // 삭제
  fastify.delete("/:id", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    await fastify.customerService.remove((request.params as any).id);
    return reply.status(204).send();
  });

  // ─── 담당자 (Contacts) ──────────────────────────────────────────────

  // 담당자 목록
  fastify.get("/:id/contacts", async (request) => {
    const { id } = request.params as any;
    return fastify.customerService.listContacts(id);
  });

  // 담당자 추가
  fastify.post("/:id/contacts", { preHandler: [requireRole("ADMIN", "MANAGER", "OPERATOR")] }, async (request, reply) => {
    const { id } = request.params as any;
    const result = await fastify.customerService.createContact(id, request.body as any);
    return reply.status(201).send(result);
  });

  // 담당자 수정
  fastify.patch("/contacts/:contactId", { preHandler: [requireRole("ADMIN", "MANAGER", "OPERATOR")] }, async (request) => {
    const { contactId } = request.params as any;
    return fastify.customerService.updateContact(contactId, request.body as any);
  });

  // 담당자 삭제
  fastify.delete("/contacts/:contactId", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    await fastify.customerService.removeContact((request.params as any).contactId);
    return reply.status(204).send();
  });
}
