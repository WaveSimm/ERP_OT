// Shared types, utilities, and interfaces for all services

export * from "./types/common";
export * from "./types/errors";
// 에러 응답 표준 = errors/error-format 의 errorResponse({error:{code,message}}) 단일.
//   (utils/response 의 legacy errorResponse 는 제거됨 — successResponse/ApiResponse 만 유지)
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
