// 보안 일괄패치 PDCA Layer 2 (C7): @erp-ot/shared로 위임 + 호환성 wrapper

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
