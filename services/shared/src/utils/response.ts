export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function successResponse<T>(data: T): ApiResponse<T> {
  return { success: true, data };
}

// legacy errorResponse({success,error}) 제거 — 호출처 0, 배럴 비노출이었음.
//   에러 응답 표준은 errors/error-format 의 errorResponse({error:{code,message}}) 단일.
