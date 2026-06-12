// expense-service — 경비정산-ERP통합 V2 (Phase 2)
//
// Phase 1: 부트스트랩 + /health
// Phase 2: Source / Category / Transaction / Statement 도메인 + JWT 인증
// 후속 phase: Receipt / Match / Settlement / Approval / Finance

import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyCors from "@fastify/cors";
import fastifyHelmet from "@fastify/helmet";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyMultipart from "@fastify/multipart";
import fastifyJwt from "@fastify/jwt";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  rateLimitPolicies,
  rateLimitErrorResponseBuilder,
  fastifyJwtVerifyOptions,
  type JwtPayload,
  requireAuth,
} from "@erp-ot/shared";

import { SourceService } from "./application/source.service";
import { TransactionService } from "./application/transaction.service";
import { StatementService } from "./application/statement.service";
import { ReceiptService } from "./application/receipt.service";
import { MatchService } from "./application/match.service";
import { SettlementService } from "./application/settlement.service";

import { sourceRoutes } from "./api/routes/source.routes";
import { transactionRoutes } from "./api/routes/transaction.routes";
import { statementRoutes } from "./api/routes/statement.routes";
import { receiptRoutes } from "./api/routes/receipt.routes";
import { matchRoutes } from "./api/routes/match.routes";
import {
  settlementRoutes,
  financeRoutes,
  settlementInternalRoutes,
} from "./api/routes/settlement.routes";

import { LocalFsStorage } from "./infrastructure/storage";
import { OcrClient } from "./infrastructure/ocr-client";
import { ApprovalClient } from "./infrastructure/approval-client";
import { AuthClient } from "./infrastructure/auth-client";
import { closePublisher } from "./infrastructure/event-publisher";

// ─── Env 검증 ─────────────────────────────────────────────────────────────────
const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be >= 32 chars"),
  INTERNAL_API_TOKEN: z.string().min(16, "INTERNAL_API_TOKEN must be >= 16 chars"),
  PORT: z.string().default("3008"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
  CORS_ORIGIN: z
    .string()
    .min(1)
    .refine((v) => v !== "*", "CORS_ORIGIN cannot be '*' with credentials")
    .default("http://localhost:3000"),
  AUTH_SERVICE_URL: z.string().default("http://auth-service:3001"),
  OCR_SERVICE_URL: z.string().default("http://ocr-service:3007"),
  APPROVAL_SERVICE_URL: z.string().default("http://approval-service:3006"),
  RABBITMQ_URL: z.string().optional(),
  EXPENSE_ATTACHMENT_DIR: z.string().default("/app/uploads"),
  EXPENSE_ATTACHMENT_MAX_SIZE: z.string().default("10485760"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

const env = envSchema.parse(process.env);
const ATTACHMENT_MAX_SIZE = parseInt(env.EXPENSE_ATTACHMENT_MAX_SIZE, 10);

const app = Fastify({
  logger: { level: env.LOG_LEVEL },
});

// ─── Plugins ──────────────────────────────────────────────────────────────────
app.register(fastifyHelmet, {
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
});

app.register(fastifyRateLimit, {
  ...rateLimitPolicies.default,
  errorResponseBuilder: rateLimitErrorResponseBuilder,
  allowList: (req) => req.url.startsWith("/internal/"),
});

app.register(fastifyCors, {
  origin: env.CORS_ORIGIN,
  credentials: true,
});

app.register(fastifyCookie);

app.register(fastifyMultipart, {
  limits: { fileSize: ATTACHMENT_MAX_SIZE },
});

// JWT (cookie 기반 — 보안 일괄패치 PDCA Layer 3)
app.register(fastifyJwt, {
  secret: env.JWT_ACCESS_SECRET,
  cookie: { cookieName: "accessToken", signed: false },
  verify: fastifyJwtVerifyOptions,
});

// ─── 인증 미들웨어 ────────────────────────────────────────────────────────────
app.register(requireAuth, { skipPaths: ["/health", "/internal/"] });

// ─── Prisma & Services ────────────────────────────────────────────────────────
const prisma = new PrismaClient();

const sourceService = new SourceService(prisma);
const transactionService = new TransactionService(prisma);
const statementService = new StatementService(prisma, env.EXPENSE_ATTACHMENT_DIR);

const storage = new LocalFsStorage(env.EXPENSE_ATTACHMENT_DIR);
const ocrClient = new OcrClient(env.OCR_SERVICE_URL, env.INTERNAL_API_TOKEN);
const matchService = new MatchService(prisma);
const receiptService = new ReceiptService(
  prisma,
  storage,
  ocrClient,
  (id) => matchService.suggestMatchesForReceipt(id),
);
const approvalClient = new ApprovalClient(env.APPROVAL_SERVICE_URL, env.INTERNAL_API_TOKEN);
const authClient = new AuthClient(env.AUTH_SERVICE_URL, env.INTERNAL_API_TOKEN);
const settlementService = new SettlementService(prisma, approvalClient);

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get("/health", async () => ({
  ok: true,
  service: "expense-service",
  version: "0.2.0",
  timestamp: new Date().toISOString(),
}));

app.register(async (instance) => {
  await instance.register(sourceRoutes, { service: sourceService, prefix: "/sources" });
  await instance.register(transactionRoutes, { service: transactionService, prefix: "/transactions" });
  await instance.register(statementRoutes, { service: statementService, prefix: "/statements" });
  await instance.register(receiptRoutes, {
    service: receiptService,
    storage,
    maxSize: ATTACHMENT_MAX_SIZE,
    prefix: "/receipts",
  });
  await instance.register(matchRoutes, { service: matchService, prefix: "/matches" });
  await instance.register(settlementRoutes, { service: settlementService, storage, prefix: "/settlements" });
  await instance.register(financeRoutes, {
    service: settlementService,
    isFinanceTeam: (userId) => authClient.isFinanceTeam(userId),
    prefix: "/finance",
  });
}, { prefix: "/api/v1/expense" });

// Internal API (서비스 간 통신, 인증 미들웨어 우회)
app.register(async (instance) => {
  await instance.register(settlementInternalRoutes, {
    service: settlementService,
    internalToken: env.INTERNAL_API_TOKEN,
  });
}, { prefix: "/internal" });

// ─── Bootstrap ────────────────────────────────────────────────────────────────
const port = parseInt(env.PORT, 10);
app
  .listen({ port, host: "0.0.0.0" })
  .then(() => {
    app.log.info(`expense-service running on port ${port}`);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });

// ─── Graceful shutdown ────────────────────────────────────────────────────────
const shutdown = async () => {
  app.log.info("shutting down...");
  await app.close();
  await closePublisher();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
