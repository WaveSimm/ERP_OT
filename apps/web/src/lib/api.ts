"use client";

// 도메인별 분할 후 배럴 re-export — 기존 `@/lib/api` import 경로 비파괴 유지.
//   core HTTP 클라이언트(request, 토큰/CSRF/silent-refresh) → ./api/client
//   도메인 API 객체 → ./api/{core-domains,equipment,collab}
export * from "./api/client";
export * from "./api/core-domains";
export * from "./api/equipment";
export * from "./api/collab";
export * from "./api/monitoring";
