// 보안 일괄패치 PDCA Layer 2 (H12): 에러 응답 포맷 통일
// {error: {code, message, details?}} 형식 강제

import { ErrorCode } from "./error-codes";

export interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function errorResponse(
  code: string,
  message: string,
  details?: unknown,
): ErrorResponseBody {
  const body: ErrorResponseBody = { error: { code, message } };
  if (details !== undefined) body.error.details = details;
  return body;
}

// 일반적인 에러를 ErrorResponseBody로 변환
export function toErrorResponse(err: unknown): { statusCode: number; body: ErrorResponseBody } {
  if (err instanceof Error && (err as any).statusCode && (err as any).code) {
    const e = err as Error & { statusCode: number; code: string; details?: unknown };
    return {
      statusCode: e.statusCode,
      body: errorResponse(e.code, e.message, e.details),
    };
  }
  if (err instanceof Error) {
    return {
      statusCode: 500,
      body: errorResponse(ErrorCode.INTERNAL_ERROR, err.message),
    };
  }
  return {
    statusCode: 500,
    body: errorResponse(ErrorCode.INTERNAL_ERROR, "Unknown error"),
  };
}
