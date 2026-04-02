import { FastifyRequest, FastifyReply, FastifyInstance } from "fastify";
import fp from "fastify-plugin";

declare module "fastify" {
  interface FastifyRequest {
    userId: string;
    userEmail: string;
    userRole: "ADMIN" | "MANAGER" | "OPERATOR" | "VIEWER";
  }
}

export const authMiddleware = fp(async (fastify: FastifyInstance) => {
  fastify.decorateRequest("userId", "");
  fastify.decorateRequest("userEmail", "");
  fastify.decorateRequest("userRole", "VIEWER");

  fastify.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    // 헬스체크 제외
    if (request.url === "/health") return;

    try {
      await request.jwtVerify();
      const payload = request.user as { sub: string; email: string; role: string };
      request.userId = payload.sub;
      request.userEmail = payload.email ?? "";
      request.userRole = payload.role as any;
    } catch {
      reply.status(401).send({ code: "UNAUTHORIZED", message: "인증이 필요합니다." });
    }
  });
});

/** 역할 기반 권한 검사 데코레이터 */
export function requireRole(...roles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!roles.includes(request.userRole)) {
      reply.status(403).send({ code: "FORBIDDEN", message: "권한이 없습니다." });
    }
  };
}

/** MANAGER 이상 (MANAGER + ADMIN) */
export function requireManager() {
  return requireRole("ADMIN", "MANAGER");
}

/** ADMIN 전용 */
export function requireAdmin() {
  return requireRole("ADMIN");
}

/**
 * MANAGER 이상이거나 본인인 경우 허용
 * 핸들러에서 req.userId로 본인 여부를 직접 확인한 후 이 함수를 활용
 * 예: if (!isManager && ownerId !== req.userId) return 403
 */
export function requireSelfOrManager(req: FastifyRequest, ownerId: string): boolean {
  const role = req.userRole;
  if (role === "ADMIN" || role === "MANAGER") return true;
  return req.userId === ownerId;
}
