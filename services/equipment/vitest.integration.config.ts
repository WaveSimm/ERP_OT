import { defineConfig } from "vitest/config";

// 통합테스트 전용 설정 — 실 DB(DATABASE_URL) 의존, *.itest.ts 만 수집.
// 단위테스트(*.test.ts/*.spec.ts)는 기본 `vitest run`이 담당(이 config 미사용) → CI 단위 게이트와 분리.
export default defineConfig({
  test: {
    include: ["src/**/*.itest.ts"],
    // 통합테스트는 공유 DB를 쓰므로 순차 실행(파일 간 격리 보장)
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
