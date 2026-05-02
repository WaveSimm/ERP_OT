// Shared types, utilities, and interfaces for all services

export * from "./types/common";
export * from "./types/errors";
// utils/response의 errorResponse는 ApiResponse<never> 형식 (legacy)
// errors/error-format의 errorResponse가 신규 표준 — Layer 2부터 사용
export {
  successResponse,
  type ApiResponse,
} from "./utils/response";

// 보안 일괄패치 PDCA Layer 2: 신규 보안 모듈
export * from "./jwt/verify-options";
export * from "./errors/error-codes";
export * from "./errors/error-format";
export * from "./middleware/require-auth";
export * from "./middleware/require-internal";
export * from "./middleware/require-role";

// 보안 일괄패치 PDCA Layer 5: rate-limit 정책 SSOT
export * from "./rate-limit/policies";
