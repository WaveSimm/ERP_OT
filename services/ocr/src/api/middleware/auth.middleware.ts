import { FastifyRequest, FastifyReply, FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { env } from "../../config/env";

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
    if (request.url === "/health" || request.url === "/dev/token" || request.url === "/api/v1/ocr/engines") return;

    // 서비스 간 호출 — x-internal-token이 INTERNAL_API_TOKEN과 일치하면 JWT 검증 우회.
    // expense-service 등 다른 서비스가 /api/v1/ocr/scan/raw를 호출할 때 사용.
    const internalToken = request.headers["x-internal-token"];
    if (typeof internalToken === "string" && internalToken === env.INTERNAL_API_TOKEN) {
      request.userId = "internal";
      request.userEmail = "service-account";
      request.userRole = "ADMIN";
      return;
    }

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

export function requireRole(...roles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!roles.includes(request.userRole)) {
      reply.status(403).send({ code: "FORBIDDEN", message: "권한이 없습니다." });
    }
  };
}
