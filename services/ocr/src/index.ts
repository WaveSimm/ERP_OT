import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyJwt from "@fastify/jwt";
import fastifyMultipart from "@fastify/multipart";
import { PrismaClient } from "@prisma/client";

import { env } from "./config/env.js";
import { authMiddleware } from "./api/middleware/auth.middleware.js";
import { ocrRoutes } from "./api/routes/ocr.routes.js";
import { templateRoutes } from "./api/routes/template.routes.js";

import { OcrService } from "./application/ocr.service.js";
import { MappingService } from "./application/mapping.service.js";
import { TemplateService } from "./application/template.service.js";
import { CorrectionService } from "./application/correction.service.js";
import { AutoExtractService } from "./application/auto-extract.service.js";
import { PaddleOcrClient } from "./infrastructure/engines/paddle-ocr.client.js";
import { EquipmentServiceClient } from "./infrastructure/erp/equipment.client.js";

// ─── Infrastructure ────────────────────────────────────────────────────────
const prisma = new PrismaClient({
  log: env.LOG_LEVEL === "debug" ? ["query", "info", "warn", "error"] : ["warn", "error"],
});

const ocrEngine = new PaddleOcrClient(env.OCR_ENGINE_URL);
const mappingService = new MappingService();
const ocrService = new OcrService(prisma, ocrEngine, mappingService, env.UPLOAD_DIR);
const templateService = new TemplateService(prisma);
const correctionService = new CorrectionService(prisma);
const autoExtractService = new AutoExtractService();
const equipmentClient = new EquipmentServiceClient(env.EQUIPMENT_SERVICE_URL, env.INTERNAL_API_TOKEN);

// ─── Type declarations ─────────────────────────────────────────────────────
declare module "fastify" {
  interface FastifyInstance {
    ocrService: OcrService;
    ocrEngine: PaddleOcrClient;
    templateService: TemplateService;
    correctionService: CorrectionService;
    autoExtractService: AutoExtractService;
    equipmentClient: EquipmentServiceClient;
    prisma: PrismaClient;
  }
}

async function buildApp() {
  const app = Fastify({ logger: { level: env.LOG_LEVEL } });

  await app.register(fastifyCors, {
    origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN,
    credentials: env.CORS_ORIGIN !== "*",
  });
  await app.register(fastifyJwt, { secret: env.JWT_ACCESS_SECRET });
  await app.register(fastifyMultipart, {
    limits: { fileSize: parseInt(env.MAX_FILE_SIZE_MB) * 1024 * 1024 },
  });

  // 서비스 데코레이터
  app.decorate("ocrService", ocrService);
  app.decorate("ocrEngine", ocrEngine);
  app.decorate("templateService", templateService);
  app.decorate("correctionService", correctionService);
  app.decorate("autoExtractService", autoExtractService);
  app.decorate("equipmentClient", equipmentClient);
  app.decorate("prisma", prisma);

  await app.register(authMiddleware);

  // 에러 핸들러
  app.setErrorHandler((error, _req, reply) => {
    app.log.error({ err: error, url: _req.url, method: _req.method }, "Request error");
    if (error.message.includes("찾을 수 없습니다") || error.message.includes("Not Found")) {
      return reply.status(404).send({ code: "NOT_FOUND", message: error.message });
    }
    if (error.message.includes("OCR engine error")) {
      return reply.status(422).send({ code: "OCR_ENGINE_FAILED", message: "OCR 처리에 실패했습니다. 이미지 품질을 확인해주세요." });
    }
    if (error.message.includes("ERP service error")) {
      return reply.status(502).send({ code: "ERP_SERVICE_UNAVAILABLE", message: error.message });
    }
    if (error.name === "ZodError") {
      return reply.status(400).send({ code: "VALIDATION_ERROR", message: "요청 데이터가 올바르지 않습니다." });
    }
    return reply.status(500).send({ code: "INTERNAL_ERROR", message: "서버 내부 오류가 발생했습니다." });
  });

  // Health check
  app.get("/health", async () => {
    const engineHealthy = await ocrEngine.healthCheck();
    return {
      status: "ok",
      service: "ocr-service",
      engine: engineHealthy ? "ok" : "unavailable",
      timestamp: new Date().toISOString(),
    };
  });

  // Dev-only: 테스트용 JWT 발급 (운영에서는 제거)
  app.get("/dev/token", async () => {
    const token = app.jwt.sign(
      { sub: "dev-admin-001", email: "dev@oceant.com", role: "ADMIN", name: "Dev Admin" },
      { expiresIn: "8h" },
    );
    return { token };
  });

  // Routes
  app.register(ocrRoutes, { prefix: "/api/v1/ocr" });
  app.register(templateRoutes, { prefix: "/api/v1/ocr/templates" });

  return app;
}

async function start() {
  const app = await buildApp();
  const PORT = parseInt(env.PORT, 10);
  await app.listen({ port: PORT, host: "0.0.0.0" });
  app.log.info(`ocr-service running on port ${PORT}`);

  const shutdown = async () => {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

start().catch((err) => {
  console.error("Failed to start ocr-service:", err);
  process.exit(1);
});
