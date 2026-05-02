// 보안 일괄패치 PDCA Layer 2 (C7): role 검사 통합 helper
// 라우트 단위로 적용: { preHandler: [requireRole("ADMIN", "MANAGER")] }

import type { FastifyRequest, FastifyReply } from "fastify";
import { errorResponse } from "../errors/error-format";
import { ErrorCode } from "../errors/error-codes";

export type Role = "ADMIN" | "MANAGER" | "OPERATOR" | "VIEWER";

export function requireRole(...allowedRoles: Role[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!allowedRoles.includes(req.userRole as Role)) {
      return reply
        .code(403)
        .send(errorResponse(ErrorCode.FORBIDDEN, "권한이 없습니다."));
    }
  };
}

// 자주 쓰는 alias
export const requireAdmin = requireRole("ADMIN");
export const requireManager = requireRole("ADMIN", "MANAGER");
export const requireOperator = requireRole("ADMIN", "MANAGER", "OPERATOR");
