// 보안 일괄패치 PDCA Layer 2 (C7): 4개 서비스에 분산된 auth.middleware.ts 통합
// /health 와 /internal/* 은 본 미들웨어가 통과시키고, requireInternal이 별도 처리

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import { fastifyJwtVerifyOptions, JwtPayload } from "../jwt/verify-options";
import { errorResponse } from "../errors/error-format";
import { ErrorCode } from "../errors/error-codes";

// FastifyRequest 타입 증강. @fastify/jwt가 자체적으로 jwtVerify/user 추가하지만
// shared 패키지 단독 컴파일에서는 모듈 augment가 한 번 더 필요.
declare module "fastify" {
  interface FastifyRequest {
    userId: string;
    userEmail: string;
    userName: string;
    userRole: "ADMIN" | "MANAGER" | "OPERATOR" | "VIEWER";
    jwtVerify(options?: unknown): Promise<unknown>;
    user: unknown;
  }
}

export interface RequireAuthOptions {
  /** Skip 경로 prefix (default: ["/health", "/internal/"]) */
  skipPaths?: string[];
}

export const requireAuth = fp<RequireAuthOptions>(
  async (fastify: FastifyInstance, opts) => {
    const skipPaths = opts.skipPaths ?? ["/health", "/internal/"];

    fastify.decorateRequest("userId", "");
    fastify.decorateRequest("userEmail", "");
    fastify.decorateRequest("userName", "");
    fastify.decorateRequest("userRole", "VIEWER");

    fastify.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
      // skip 경로
      for (const prefix of skipPaths) {
        if (req.url === prefix || req.url.startsWith(prefix)) return;
      }

      try {
        // fastify-jwt의 jwtVerify 사용. algorithms 명시 (NEW-4 alg confusion 방지)
        await req.jwtVerify(fastifyJwtVerifyOptions);
        const payload = req.user as JwtPayload;
        req.userId = payload.sub;
        req.userEmail = payload.email ?? "";
        req.userName = payload.name ?? "";
        req.userRole = payload.role;
        return;
      } catch {
        return reply
          .code(401)
          .send(errorResponse(ErrorCode.UNAUTHORIZED, "인증이 필요합니다."));
      }
    });
  },
  { name: "require-auth" },
);
