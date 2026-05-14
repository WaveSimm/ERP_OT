import { FastifyInstance } from "fastify";
import { requireRole } from "../middleware/auth.middleware.js";

/**
 * BundleShipment API (v1.6 신규, 2026-05-13)
 *
 *   GET    /api/v1/bundle-shipments?customerId=...&from=...&to=...
 *   GET    /api/v1/bundle-shipments/:id
 *   GET    /api/v1/bundle-shipments/:id/sibling-assets   (AS관리에서 사용)
 *   POST   /api/v1/bundle-shipments
 *   PATCH  /api/v1/bundle-shipments/:id
 */
export async function bundleShipmentRoutes(fastify: FastifyInstance) {
  fastify.get("/", async (request) => {
    const q = request.query as { customerId?: string; from?: string; to?: string; page?: string; limit?: string; sortBy?: string; sortOrder?: string };
    return fastify.bundleShipmentService.list({
      ...(q.customerId && { customerId: q.customerId }),
      ...(q.from && { from: new Date(q.from) }),
      ...(q.to && { to: new Date(q.to) }),
      ...(q.page && { page: parseInt(q.page, 10) }),
      ...(q.limit && { limit: parseInt(q.limit, 10) }),
      ...(q.sortBy && { sortBy: q.sortBy }),
      ...((q.sortOrder === "asc" || q.sortOrder === "desc") && { sortOrder: q.sortOrder }),
    });
  });

  fastify.get("/:id", async (request) => {
    return fastify.bundleShipmentService.getById((request.params as any).id);
  });

  /** AS관리 — 같은 번들의 형제 자산 조회 */
  fastify.get("/:id/sibling-assets", async (request) => {
    return fastify.bundleShipmentService.getSiblingAssets((request.params as any).id);
  });

  fastify.post("/", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request, reply) => {
    const body = request.body as any;
    const result = await fastify.bundleShipmentService.create({
      customerId: body.customerId,
      shippedAt: body.shippedAt ? new Date(body.shippedAt) : new Date(),
      items: body.items ?? [],
      createdBy: request.userId,
      ...(body.bomDefinitionId && { bomDefinitionId: body.bomDefinitionId }),
      ...(body.projectId && { projectId: body.projectId }),
      ...(body.shipTo && { shipTo: body.shipTo }),
      ...(body.warrantyUntil && { warrantyUntil: new Date(body.warrantyUntil) }),
      ...(body.totalPrice !== undefined && { totalPrice: body.totalPrice }),
      ...(body.notes && { notes: body.notes }),
    });
    return reply.status(201).send(result);
  });

  fastify.patch("/:id", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request) => {
    const body = request.body as any;
    const update: any = {};
    if (body.shipTo !== undefined) update.shipTo = body.shipTo;
    if (body.warrantyUntil !== undefined) {
      update.warrantyUntil = body.warrantyUntil ? new Date(body.warrantyUntil) : null;
    }
    if (body.totalPrice !== undefined) update.totalPrice = body.totalPrice;
    if (body.notes !== undefined) update.notes = body.notes;
    return fastify.bundleShipmentService.update((request.params as any).id, update);
  });
}
