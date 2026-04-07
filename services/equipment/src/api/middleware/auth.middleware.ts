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

export function requireRole(...roles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!roles.includes(request.userRole)) {
      reply.status(403).send({ code: "FORBIDDEN", message: "권한이 없습니다." });
    }
  };
}
