// 보안 일괄패치 PDCA Layer 2 (C7): @erp-ot/shared로 위임 + 호환성 wrapper
// 라우트 12개의 import 경로 유지를 위해 thin proxy 유지

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import {
  requireAuth,
  requireInternal,
  requireRole as sharedRequireRole,
  type Role,
} from "@erp-ot/shared";

// authMiddleware: requireAuth + requireInternal 조합 (기존 API 호환)
export const authMiddleware = fp(async (fastify: FastifyInstance) => {
  await fastify.register(requireAuth);
  await fastify.register(requireInternal);
});

// 라우트 단위 권한 검사 (기존 호출 패턴: requireRole("ADMIN", "MANAGER"))
export function requireRole(...roles: string[]) {
  return sharedRequireRole(...(roles as Role[]));
}

// MANAGER 이상 (factory 패턴 — 기존 호출: preHandler: requireManager())
export function requireManager() {
  return sharedRequireRole("ADMIN", "MANAGER");
}

// ADMIN 전용
export function requireAdmin() {
  return sharedRequireRole("ADMIN");
}

// OPERATOR 이상
export function requireOperator() {
  return sharedRequireRole("ADMIN", "MANAGER", "OPERATOR");
}

// MANAGER 이상이거나 본인인 경우 (라우트 핸들러에서 직접 호출)
export function requireSelfOrManager(req: FastifyRequest, ownerId: string): boolean {
  const role = req.userRole;
  if (role === "ADMIN" || role === "MANAGER") return true;
  return req.userId === ownerId;
}
