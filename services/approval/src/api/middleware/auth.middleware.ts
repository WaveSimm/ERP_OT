// 보안 일괄패치 PDCA Layer 2 (C7 + NEW-8): @erp-ot/shared로 위임 + 호환성 wrapper
// NEW-8: 기존 X-Internal-Token 자동 ADMIN 승격 패턴은 shared의 requireInternal로 폐기됨
//        (now: userRole = "OPERATOR" with explicit assignment)

import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import {
  requireAuth,
  requireInternal,
  requireRole as sharedRequireRole,
  type Role,
} from "@erp-ot/shared";

export const authMiddleware = fp(async (fastify: FastifyInstance) => {
  await fastify.register(requireAuth);
  await fastify.register(requireInternal);
});

export function requireRole(...roles: string[]) {
  return sharedRequireRole(...(roles as Role[]));
}
