import { FastifyInstance } from "fastify";
import { requireRole } from "../middleware/auth.middleware.js";

export async function purchaseOrderRoutes(fastify: FastifyInstance) {
  fastify.get("/", async (request) => {
    const { status, page, limit } = request.query as any;
    return fastify.purchaseOrderService.list({
      status: status || undefined,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
    });
  });

  fastify.get("/:id", async (request) => {
    const { id } = request.params as any;
    return fastify.purchaseOrderService.getById(id);
  });

  fastify.post("/", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request, reply) => {
    const result = await fastify.purchaseOrderService.create(request.body as any);
    return reply.status(201).send(result);
  });

  fastify.patch("/:id", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request) => {
    const { id } = request.params as any;
    return fastify.purchaseOrderService.update(id, request.body as any);
  });

  fastify.patch("/:id/receive", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request) => {
    const { id } = request.params as any;
    const { items } = request.body as any;
    return fastify.purchaseOrderService.receive(id, items);
  });
}
