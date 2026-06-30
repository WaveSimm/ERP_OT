import Fastify from "fastify";
import fastifyHelmet from "@fastify/helmet";
import fastifyRateLimit from "@fastify/rate-limit";
import { rateLimitPolicies, rateLimitErrorResponseBuilder, userRateLimitKey } from "@erp-ot/shared";
import fastifyJwt from "@fastify/jwt";
import fastifyCookie from "@fastify/cookie";
import fastifyCors from "@fastify/cors";

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || "info",
  },
});

// 보안 일괄패치 PDCA Layer 1 (C2 + NEW-14): inline 검증 (user-service는 작은 서비스라 별도 envSchema 미적용)
const corsOrigin = (() => {
  const v = process.env.CORS_ORIGIN || "http://localhost:3000";
  if (v === "*") throw new Error("CORS_ORIGIN cannot be '*' with credentials");
  return v;
})();
const jwtSecret = (() => {
  const v = process.env.JWT_ACCESS_SECRET;
  if (!v || v.length < 32) throw new Error("JWT_ACCESS_SECRET required (min 32 chars)");
  return v;
})();

// ─── Plugins ──────────────────────────────────────────────────────────────────
// 보안 일괄패치 PDCA Layer 5 (H1)
app.register(fastifyHelmet, { contentSecurityPolicy: false, crossOriginEmbedderPolicy: false, hsts: { maxAge: 63072000, includeSubDomains: true, preload: true } });
app.register(fastifyRateLimit, { ...rateLimitPolicies.default, keyGenerator: userRateLimitKey, errorResponseBuilder: rateLimitErrorResponseBuilder });

app.register(fastifyCors, {
  origin: corsOrigin,
  credentials: true,
});

// 보안 일괄패치 PDCA Layer 3 (C1): cookie 파서 + JWT cookie 인식
app.register(fastifyCookie);
app.register(fastifyJwt, {
  secret: jwtSecret,
  cookie: { cookieName: "accessToken", signed: false },
});

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get("/health", async () => {
  return { status: "ok", service: "user-service", timestamp: new Date().toISOString() };
});

// ─── Routes ───────────────────────────────────────────────────────────────────
// TODO: Register user routes
// app.register(userRoutes, { prefix: "/api/v1/users" });

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || "3002", 10);

app.listen({ port: PORT, host: "0.0.0.0" }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`user-service running on port ${PORT}`);
});
