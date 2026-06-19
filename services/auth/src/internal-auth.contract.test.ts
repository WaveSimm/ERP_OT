import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { requireInternal } from "@erp-ot/shared";

// 내부인증(requireInternal) 계약 테스트 — 인프라(DB) 불필요, fastify inject 로 라우트 동작만 검증.
//   Phase 1 "내부인증 일원화"(auth/approval/expense/ocr → shared requireInternal)의 회귀 가드.
const TOKEN = "test-internal-token-0123456789ab"; // 길이 ≥16 (hook 검증 통과용)

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(requireInternal); // 전역 onRequest: /internal/* 토큰 가드
  app.get("/internal/ping", async () => ({ ok: true }));
  app.get("/public/ping", async () => ({ ok: true }));
  await app.ready();
  return app;
}

describe("requireInternal 계약", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    process.env.INTERNAL_API_TOKEN = TOKEN;
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it("/internal/* 토큰 없으면 401", async () => {
    const res = await app.inject({ method: "GET", url: "/internal/ping" });
    expect(res.statusCode).toBe(401);
  });

  it("/internal/* 유효 토큰이면 통과(200)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/internal/ping",
      headers: { "x-internal-token": TOKEN },
    });
    expect(res.statusCode).toBe(200);
  });

  it("/internal/* 틀린 토큰이면 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/internal/ping",
      headers: { "x-internal-token": "wrong-token" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("비-internal 경로(/public)는 토큰 없어도 통과", async () => {
    const res = await app.inject({ method: "GET", url: "/public/ping" });
    expect(res.statusCode).toBe(200);
  });
});
