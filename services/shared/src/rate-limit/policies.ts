// 보안 일괄패치 PDCA Layer 5 (H1)
// rate-limit 정책 SSOT — @fastify/rate-limit에 사용

import { ErrorCode } from "../errors/error-codes";

export const rateLimitPolicies = {
  // 일반 API: IP 기준 분당 100회 (정상 사용에 영향 없음)
  default: {
    max: 100,
    timeWindow: "1 minute" as const,
  },

  // 로그인: brute-force 방어 — IP 기준 분당 5회
  login: {
    max: 5,
    timeWindow: "1 minute" as const,
  },

  // refresh: replay 방지 — IP 기준 분당 10회
  refresh: {
    max: 10,
    timeWindow: "1 minute" as const,
  },

  // search: 임베딩 비용 — 사용자 기준 분당 30회
  search: {
    max: 30,
    timeWindow: "1 minute" as const,
  },
} as const;

// rate-limit 응답 본문 (H12 표준 에러 포맷)
// @fastify/rate-limit의 errorResponseBuilder는 statusCode를 반드시 포함해야 429로 처리됨
export function rateLimitErrorResponseBuilder(_req: unknown, context: { ttl: number }) {
  return {
    statusCode: 429,
    error: ErrorCode.TOO_MANY_ATTEMPTS,
    message: `요청이 너무 많습니다. ${Math.ceil(context.ttl / 1000)}초 후 다시 시도하세요.`,
  };
}
