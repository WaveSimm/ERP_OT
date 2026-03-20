import type { FastifyRequest, FastifyReply } from "fastify";
import type { AuthService } from "../../application/auth.service";

declare module "fastify" {
  interface FastifyRequest {
    userId: string;
    userEmail: string;
    userRole: string;
    userName: string;
  }
}

export function createAuthHook(authService: AuthService) {
  return async function authenticate(req: FastifyRequest, reply: FastifyReply) {
    const auth = req.headers["authorization"];
    if (!auth || !auth.startsWith("Bearer ")) {
      return reply.code(401).send({ error: "인증이 필요합니다." });
    }

    const token = auth.slice(7);
    try {
      const payload = authService.verifyAccess(token);
      req.userId = payload.sub;
      req.userEmail = payload.email;
      req.userRole = payload.role;
      req.userName = payload.name;
    } catch {
      return reply.code(401).send({ error: "유효하지 않은 토큰입니다." });
    }
  };
}

export function requireRole(...roles: string[]) {
  return async function checkRole(req: FastifyRequest, reply: FastifyReply) {
    if (!roles.includes(req.userRole)) {
      return reply.code(403).send({ error: "권한이 없습니다." });
    }
  };
}
