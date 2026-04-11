import { FastifyInstance } from "fastify";
import { requireRole } from "../middleware/auth.middleware.js";

export async function storageLocationRoutes(fastify: FastifyInstance) {
  // 조회: 전체 허용
  fastify.get("/", async (request) => {
    const { type, search, includeInactive, page, limit } = request.query as any;
    const params: any = {
      type: type || undefined,
      search: search || undefined,
      includeInactive: includeInactive === "true",
    };
    if (page) params.page = parseInt(page);
    if (limit) params.limit = parseInt(limit);
    return fastify.storageLocationService.list(params);
  });

  fastify.get("/:id", async (request) => {
    return fastify.storageLocationService.getById((request.params as any).id);
  });

  // 생성/수정: ADMIN, MANAGER
  fastify.post("/", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request, reply) => {
    const body = request.body as any;
    const result = await fastify.storageLocationService.create({
      name: body.name,
      type: body.type || "WAREHOUSE",
      description: body.description || undefined,
      sortOrder: body.sortOrder ?? 0,
    });
    return reply.status(201).send(result);
  });

  fastify.patch("/:id", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request) => {
    const { id } = request.params as any;
    return fastify.storageLocationService.update(id, request.body as any);
  });

  // 삭제: ADMIN만
  fastify.delete("/:id", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    await fastify.storageLocationService.remove((request.params as any).id);
    return reply.status(204).send();
  });
}
