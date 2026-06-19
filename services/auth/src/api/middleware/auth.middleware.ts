import type { FastifyRequest, FastifyReply } from "fastify";
import type { AuthService } from "../../application/auth.service";

// Note: shared 패키지의 require-auth.ts에서 FastifyRequest를 augment하므로
//       여기서는 별도 declare module 안 함 (충돌 방지)

export function createAuthHook(authService: AuthService) {
  return async function authenticate(req: FastifyRequest, reply: FastifyReply) {
    // 보안 일괄패치 PDCA Layer 3 (C1): Authorization 헤더 + cookie accessToken 둘 다 지원
    const auth = req.headers["authorization"];
    let token: string | undefined;
    if (auth && auth.startsWith("Bearer ")) {
      token = auth.slice(7);
    } else if (req.cookies?.accessToken) {
      token = req.cookies.accessToken;
    }
    if (!token) {
      return reply.code(401).send({ error: "인증이 필요합니다." });
    }
    try {
      const payload = authService.verifyAccess(token);
      req.userId = payload.sub;
      req.userEmail = payload.email;
      req.userRole = payload.role as "ADMIN" | "MANAGER" | "OPERATOR" | "VIEWER";
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
