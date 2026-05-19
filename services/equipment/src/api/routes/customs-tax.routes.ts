import { FastifyInstance } from "fastify";
import { requireRole } from "../middleware/auth.middleware.js";

/**
 * 관부가세 처리 라우트 (v1.6.1, 2026-05-15)
 *  GET    /orders/:id/customs-tax           발주별 관부가세 조회
 *  GET    /customs-taxes?status=PENDING     재무팀 큐
 *  PATCH  /customs-taxes/:id/pay            납부 완료 처리
 *  PATCH  /customs-taxes/:id/reject         반려
 *  PATCH  /customs-taxes/:id/reopen         반려 재개
 */
export async function customsTaxRoutes(fastify: FastifyInstance) {
  // 발주별 조회 (모든 로그인 사용자)
  fastify.get("/orders/:id/customs-tax", async (request) => {
    const { id } = request.params as any;
    return fastify.customsTaxService.getByOrder(id);
  });

  // 재무팀 큐 — 모든 로그인 사용자 (탭 표시용)
  fastify.get("/customs-taxes", async (request) => {
    const { status } = request.query as any;
    return fastify.customsTaxService.list(status);
  });

  // 납부 완료 처리 — OPERATOR 이상
  fastify.patch("/customs-taxes/:id/pay", { preHandler: [requireRole("ADMIN", "MANAGER", "OPERATOR")] }, async (request) => {
    const { id } = request.params as any;
    const body = request.body as any;
    return fastify.customsTaxService.pay(id, body, request.userId, (request as any).userName);
  });

  // PAID 정정 — OPERATOR 이상
  fastify.patch("/customs-taxes/:id/correct", { preHandler: [requireRole("ADMIN", "MANAGER", "OPERATOR")] }, async (request) => {
    const { id } = request.params as any;
    const body = request.body as any;
    return fastify.customsTaxService.correct(id, body);
  });

  // 반려 — OPERATOR 이상
  fastify.patch("/customs-taxes/:id/reject", { preHandler: [requireRole("ADMIN", "MANAGER", "OPERATOR")] }, async (request) => {
    const { id } = request.params as any;
    const { reason } = request.body as any;
    if (!reason) throw new Error("반려 사유가 필요합니다.");
    return fastify.customsTaxService.reject(id, reason, request.userId);
  });

  // 반려 재개 — OPERATOR 이상
  fastify.patch("/customs-taxes/:id/reopen", { preHandler: [requireRole("ADMIN", "MANAGER", "OPERATOR")] }, async (request) => {
    const { id } = request.params as any;
    return fastify.customsTaxService.reopen(id);
  });
}
