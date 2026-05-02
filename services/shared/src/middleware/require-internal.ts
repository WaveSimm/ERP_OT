// 보안 일괄패치 PDCA Layer 2: /internal/* 라우트 토큰 검증
//
// Layer 2 정책 (현재):
//   - X-Internal-Token 검증 (env.INTERNAL_API_TOKEN과 일치 + 길이 검증)
//   - userId = "system", userRole = "OPERATOR" (NEW-8 자동 ADMIN 승격 제거)
//   - 기존 approval-service의 자동 ADMIN 패턴 제거됨
//
// Layer 5 변경 예정 (Big Bang):
//   - Bearer Service JWT만 허용 (5분 TTL)
//   - X-Internal-Token은 service-token 발급 (POST /internal/service-token)에만
//
// project/attendance가 단순 `return`으로 통과시키던 패턴 (NEW-8 변형) 폐기

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import { errorResponse } from "../errors/error-format";
import { ErrorCode } from "../errors/error-codes";

export interface RequireInternalOptions {
  /** internal route prefix (default: "/internal/") */
  internalPrefix?: string;
  /**
   * /internal/service-token 같은 부트스트랩 라우트는 token 검증을 라우트 핸들러가 직접 수행.
   * 본 미들웨어는 skip 처리.
   */
  bootstrapPaths?: string[];
}

export const requireInternal = fp<RequireInternalOptions>(
  async (fastify: FastifyInstance, opts) => {
    const internalPrefix = opts.internalPrefix ?? "/internal/";
    const bootstrapPaths = opts.bootstrapPaths ?? [];

    fastify.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
      if (!req.url.startsWith(internalPrefix)) return;

      // 부트스트랩 라우트(예: POST /internal/service-token)는 핸들러가 직접 검증
      for (const path of bootstrapPaths) {
        if (req.url.startsWith(path)) return;
      }

      const token = req.headers["x-internal-token"];
      const expectedToken = process.env.INTERNAL_API_TOKEN;

      // defense-in-depth: 길이 검증 (Zod env가 startup에 보장하지만 한 번 더)
      if (
        typeof token !== "string" ||
        typeof expectedToken !== "string" ||
        expectedToken.length < 16 ||
        token !== expectedToken
      ) {
        return reply
          .code(401)
          .send(errorResponse(ErrorCode.INTERNAL_TOKEN_INVALID, "유효하지 않은 internal token입니다."));
      }

      // NEW-8 수정: 자동 ADMIN 승격 제거
      // system 사용자는 명시적으로 OPERATOR 역할 부여
      // 단, internal 라우트들은 어차피 role 체크를 하지 않으므로 실제 권한과 무관
      req.userId = "system";
      req.userRole = "OPERATOR";
    });
  },
  { name: "require-internal" },
);
