import { FastifyInstance } from "fastify";
import { requireRole } from "../middleware/auth.middleware.js";

/**
 * ProductVariant API (v1.6 신규, 2026-05-13)
 *
 * Design v1.1 §19.2.1 참고
 *
 * 라우트:
 *   GET    /api/v1/product-variants?productMasterId=X
 *   GET    /api/v1/product-variants/:id
 *   POST   /api/v1/product-variants                 (ADMIN, MANAGER)
 *   PATCH  /api/v1/product-variants/:id             (ADMIN, MANAGER)
 *   DELETE /api/v1/product-variants/:id             (ADMIN, 운용 전 한정)
 *   POST   /api/v1/product-variants/:idA/merge/:idB (ADMIN)
 */
export async function productVariantRoutes(fastify: FastifyInstance) {
  // 조회 — Master 단위 또는 단건
  fastify.get("/", async (request) => {
    const q = request.query as { productMasterId?: string; includeInactive?: string };
    if (!q.productMasterId) {
      throw new Error("productMasterId 필수");
    }
    return fastify.productVariantService.listByMaster(q.productMasterId, {
      includeInactive: q.includeInactive === "true",
    });
  });

  fastify.get("/:id", async (request) => {
    return fastify.productVariantService.getById((request.params as any).id);
  });

  // 생성 — ADMIN/MANAGER
  fastify.post("/", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request, reply) => {
    const body = request.body as {
      productMasterId: string;
      skuCode?: string;
      variantSpecs?: Record<string, any>;
      isActive?: boolean;
    };
    const result = await fastify.productVariantService.create(body);
    return reply.status(201).send(result);
  });

  // 수정 — ADMIN/MANAGER
  fastify.patch("/:id", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request) => {
    const { id } = request.params as { id: string };
    return fastify.productVariantService.update(id, request.body as any);
  });

  // 삭제 — ADMIN (참조 없을 때만, 운용 전 한정)
  fastify.delete("/:id", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    await fastify.productVariantService.remove((request.params as any).id);
    return reply.status(204).send();
  });

  // Merge (통합) — ADMIN. idB의 참조를 idA로 옮긴 후 idB 삭제
  fastify.post("/:idA/merge/:idB", { preHandler: [requireRole("ADMIN")] }, async (request) => {
    const { idA, idB } = request.params as { idA: string; idB: string };
    return fastify.productVariantService.merge(idA, idB);
  });
}
