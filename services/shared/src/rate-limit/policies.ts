// 보안 일괄패치 PDCA Layer 5 (H1)
// rate-limit 정책 SSOT — @fastify/rate-limit에 사용

import { ErrorCode } from "../errors/error-codes";
import type { FastifyRequest } from "fastify";

export const rateLimitPolicies = {
  // 일반 API: 사용자(키) 기준 분당 1000회. 단일 출구IP 공유·쿠키없는 서버사이드 호출 등으로
  // 키 분리가 완전하지 않을 수 있어 넉넉히 설정(사내 ERP, DoS 위험 낮음).
  default: {
    max: 1000,
    timeWindow: "1 minute" as const,
  },

  // 로그인: brute-force 방어 — 단일 출구IP 공유 환경이라 다인 동시로그인 고려해 분당 50
  login: {
    max: 50,
    timeWindow: "1 minute" as const,
  },

  // refresh: replay 방지 — 분당 10회
  refresh: {
    max: 10,
    timeWindow: "1 minute" as const,
  },

  // search: 임베딩 비용(서버 CPU) — 사용자 기준 분당 60회
  search: {
    max: 60,
    timeWindow: "1 minute" as const,
  },
} as const;

// 사용자별 rate-limit 키 — 전 사용자가 web 프록시 단일 IP로 들어와 IP기준이면 한도를 공유함.
// rate-limit은 쿠키 파서보다 먼저 돌므로 쿠키 헤더에서 accessToken을 직접 추출(없으면 IP 폴백).
// 로그인 등 비인증 요청은 토큰이 없어 IP 폴백(공유) — 그래서 login 한도를 상향함.
export function userRateLimitKey(req: FastifyRequest): string {
  const m = (req.headers.cookie || "").match(/accessToken=([^;]+)/);
  return (m && m[1]) || (req.headers.authorization as string) || req.ip;
}

// rate-limit 응답 본문 (H12 표준 에러 포맷)
// @fastify/rate-limit의 errorResponseBuilder는 statusCode를 반드시 포함해야 429로 처리됨
export function rateLimitErrorResponseBuilder(_req: unknown, context: { ttl: number }) {
  return {
    statusCode: 429,
    code: ErrorCode.TOO_MANY_ATTEMPTS,   // 전역 에러핸들러가 429로 인식하도록(code 필요) — 500 표출 방지
    error: ErrorCode.TOO_MANY_ATTEMPTS,
    message: `요청이 너무 많습니다. ${Math.ceil(context.ttl / 1000)}초 후 다시 시도하세요.`,
  };
}
