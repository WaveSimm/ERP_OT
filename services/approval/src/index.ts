import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyJwt from "@fastify/jwt";
import fastifyCookie from "@fastify/cookie";
import fastifyMultipart from "@fastify/multipart";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";

import { authMiddleware } from "./api/middleware/auth.middleware.js";
import { templateRoutes } from "./api/routes/template.routes.js";
import { documentRoutes } from "./api/routes/document.routes.js";
import { fileRoutes } from "./api/routes/file.routes.js";

import { TemplateService } from "./application/template.service.js";
import { DocumentService } from "./application/document.service.js";
import { FileService } from "./application/file.service.js";

// ─── Env 검증 ──────────────────────────────────────────────────────────────
const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(16),
  PORT: z.string().default("3006"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
  // 보안 일괄패치 PDCA Layer 1 (NEW-14): * 차단 + 빈 값 차단
  CORS_ORIGIN: z
    .string()
    .min(1, "CORS_ORIGIN required")
    .refine((v) => v !== "*", "CORS_ORIGIN cannot be '*' with credentials")
    .default("http://localhost:3000"),
  INTERNAL_API_TOKEN: z.string().min(16),
  EQUIPMENT_SERVICE_URL: z.string().default("http://equipment-service:3005"),
  ATTENDANCE_SERVICE_URL: z.string().default("http://attendance-service:3004"),
  AUTH_SERVICE_URL: z.string().default("http://auth-service:3001"),
});

const env = envSchema.parse(process.env);

// ─── Infrastructure ────────────────────────────────────────────────────────
const prisma = new PrismaClient({
  log: env.LOG_LEVEL === "debug" ? ["query", "info", "warn", "error"] : ["warn", "error"],
});

// ─── Services ──────────────────────────────────────────────────────────────
const templateService = new TemplateService(prisma);
const documentService = new DocumentService(prisma);
const fileService = new FileService(prisma);

// ─── Type declarations ─────────────────────────────────────────────────────
declare module "fastify" {
  interface FastifyInstance {
    templateService: TemplateService;
    documentService: DocumentService;
    fileService: FileService;
    prisma: PrismaClient;
  }
}

async function buildApp() {
  const app = Fastify({ logger: { level: env.LOG_LEVEL } });

  await app.register(fastifyCors, { origin: env.CORS_ORIGIN, credentials: true });
  // 보안 일괄패치 PDCA Layer 3 (C1): cookie 파서 + JWT cookie 인식
  await app.register(fastifyCookie);
  await app.register(fastifyJwt, { secret: env.JWT_ACCESS_SECRET, cookie: { cookieName: "accessToken", signed: false } });
  await app.register(fastifyMultipart, { limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB

  app.decorate("templateService", templateService);
  app.decorate("documentService", documentService);
  app.decorate("fileService", fileService);
  app.decorate("prisma", prisma);

  await app.register(authMiddleware);

  // 에러 핸들러
  app.setErrorHandler((error, _req, reply) => {
    app.log.error({ err: error, url: _req.url, method: _req.method }, "Request error");
    if (error.message.includes("찾을 수 없습니다") || error.message.includes("권한이 없습니다") ||
        error.message.includes("상태") || error.message.includes("필요합니다") ||
        error.message.includes("불가")) {
      return reply.status(400).send({ code: "BUSINESS_ERROR", message: error.message });
    }
    if (error.name === "ZodError") {
      return reply.status(400).send({ code: "VALIDATION_ERROR", message: "요청 데이터가 올바르지 않습니다." });
    }
    return reply.status(500).send({ code: "INTERNAL_ERROR", message: "서버 내부 오류가 발생했습니다." });
  });

  // Health check
  app.get("/health", async () => ({
    status: "ok", service: "approval-service", timestamp: new Date().toISOString(),
  }));

  // Routes
  app.register(templateRoutes, { prefix: "/api/v1/approval/templates" });
  app.register(documentRoutes, { prefix: "/api/v1/approval/documents" });
  app.register(fileRoutes, { prefix: "/api/v1/approval/files" });

  // Internal API (서비스 간 통신, 인증 미들웨어 우회)
  app.get("/internal/documents/:id", async (request, reply) => {
    const token = request.headers["x-internal-token"];
    if (token !== process.env.INTERNAL_API_TOKEN) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const { id } = request.params as any;
    try {
      const doc = await prisma.approvalDocument.findUnique({
        where: { id },
        include: { template: { select: { code: true, name: true } } },
      });
      if (!doc) return reply.status(404).send({ error: "Not found" });
      return doc;
    } catch {
      return reply.status(500).send({ error: "Internal error" });
    }
  });

  return app;
}

async function start() {
  const app = await buildApp();
  const PORT = parseInt(env.PORT, 10);
  await app.listen({ port: PORT, host: "0.0.0.0" });
  app.log.info(`approval-service running on port ${PORT}`);

  const shutdown = async () => {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

start().catch((err) => {
  console.error("Failed to start approval-service:", err);
  process.exit(1);
});
