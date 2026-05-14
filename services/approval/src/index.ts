import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyHelmet from "@fastify/helmet";
import fastifyRateLimit from "@fastify/rate-limit";
import { rateLimitPolicies, rateLimitErrorResponseBuilder } from "@erp-ot/shared";
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

  // 보안 일괄패치 PDCA Layer 5 (H1)
  await app.register(fastifyHelmet, { contentSecurityPolicy: false, crossOriginEmbedderPolicy: false, hsts: { maxAge: 63072000, includeSubDomains: true, preload: true } });
  await app.register(fastifyRateLimit, { ...rateLimitPolicies.default, errorResponseBuilder: rateLimitErrorResponseBuilder });
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
  const requireInternalToken = (request: any, reply: any) => {
    const token = request.headers["x-internal-token"];
    if (token !== process.env.INTERNAL_API_TOKEN) {
      reply.status(403).send({ error: "Forbidden" });
      return false;
    }
    return true;
  };

  app.get("/internal/documents/:id", async (request, reply) => {
    if (!requireInternalToken(request, reply)) return;
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

  // 다른 서비스가 자동 결재 상신할 때 사용 (expense-service의 EXPENSE_CLAIM 등)
  // body에 명시적 userId 필요 (사용자 JWT 우회)
  app.post("/internal/documents", async (request, reply) => {
    if (!requireInternalToken(request, reply)) return;
    const body = request.body as any;
    if (!body.userId || (!body.templateId && !body.templateCode)) {
      return reply.status(400).send({ error: "userId + (templateId | templateCode) required" });
    }

    // templateCode 주어진 경우 templateId 조회
    let templateId = body.templateId as string | undefined;
    if (!templateId && body.templateCode) {
      const tpl = await prisma.approvalTemplate.findUnique({ where: { code: body.templateCode } });
      if (!tpl) return reply.status(404).send({ error: `template code=${body.templateCode} not found` });
      templateId = tpl.id;
    }

    // approver: body.steps override > 자동 로드
    let steps: any[] = [];
    if (Array.isArray(body.steps) && body.steps.length > 0) {
      steps = body.steps.map((s: any, i: number) => ({
        stepOrder: typeof s.stepOrder === "number" ? s.stepOrder : i + 1,
        roleName: s.roleName || "결재",
        approverId: s.approverId,
        approverName: s.approverName || "—",
      }));
    } else {
      try {
        const authUrl = process.env.AUTH_SERVICE_URL || "http://auth-service:3001";
        const token = process.env.INTERNAL_API_TOKEN as string;
        const resp = await fetch(`${authUrl}/internal/users/${body.userId}/approver`, {
          headers: { "X-Internal-Token": token },
        });
        if (resp.ok) {
          const line = (await resp.json()) as any;
          if (line.approverId) steps.push({ stepOrder: 1, roleName: "결재", approverId: line.approverId, approverName: line.approverName || "—" });
          if (line.secondApproverId) steps.push({ stepOrder: 2, roleName: "결재", approverId: line.secondApproverId, approverName: line.secondApproverName || "—" });
          if (line.thirdApproverId) steps.push({ stepOrder: 3, roleName: "결재", approverId: line.thirdApproverId, approverName: line.thirdApproverName || "—" });
        }
      } catch { /* fallback: no steps */ }
    }

    // requesterName · department 자동 로드
    let department = body.department || "";
    let requesterName = body.requesterName || "";
    if (!department || !requesterName) {
      try {
        const authUrl = process.env.AUTH_SERVICE_URL || "http://auth-service:3001";
        const token = process.env.INTERNAL_API_TOKEN as string;
        const resp = await fetch(`${authUrl}/internal/users/${body.userId}/profile`, {
          headers: { "X-Internal-Token": token },
        });
        if (resp.ok) {
          const user = (await resp.json()) as any;
          if (!department) department = user.profile?.departmentName || user.departmentName || "미지정";
          if (!requesterName) requesterName = user.name || "";
        }
      } catch { if (!department) department = "미지정"; }
    }

    try {
      const result = await app.documentService.create({
        templateId: templateId!,
        title: body.title,
        requestedBy: body.userId,
        requesterName,
        department,
        approvalStepCount: steps.length,
        content: body.fields,
        richBody: body.richBody,
        itemsData: body.items,
        itemsTotal: body.totalAmount,
        amount: body.totalAmount,
        referenceType: body.referenceType,
        referenceId: body.referenceId,
        steps,
      });

      // 즉시 상신 옵션: DRAFT → STEP_1_PENDING/AGREEMENT_PENDING 전이
      // 결재선 비어있으면 상신 불가 — DRAFT 그대로 반환 (호출 측에서 처리)
      if (body.submitImmediately === true && steps.length > 0) {
        try {
          const submitted = await app.documentService.submit(result.id);
          return reply.status(201).send(submitted);
        } catch (err: any) {
          // 상신 실패 시 문서는 DRAFT로 남고 에러만 응답
          return reply.status(500).send({ error: `document created but submit failed: ${err.message}`, documentId: result.id });
        }
      }
      return reply.status(201).send(result);
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // 서비스 간 파일 업로드 (expense-service가 영수증을 결재 첨부로 추가할 때 사용)
  // multipart/form-data: file + form fields(documentId, uploadedBy, referenceType?, referenceId?)
  app.post("/internal/files/upload", async (request, reply) => {
    if (!requireInternalToken(request, reply)) return;
    const data = await request.file();
    if (!data) return reply.status(400).send({ error: "file required" });

    const fields = data.fields as Record<string, any>;
    const documentId = fields.documentId?.value as string | undefined;
    const uploadedBy = fields.uploadedBy?.value as string | undefined;
    const referenceType = fields.referenceType?.value as string | undefined;
    const referenceId = fields.referenceId?.value as string | undefined;
    if (!uploadedBy) return reply.status(400).send({ error: "uploadedBy required" });

    const buffer = await data.toBuffer();
    try {
      const result = await app.fileService.upload({
        ...(documentId && { documentId }),
        ...(referenceType && { referenceType }),
        ...(referenceId && { referenceId }),
        fileName: data.filename,
        fileBuffer: buffer,
        mimeType: data.mimetype,
        uploadedBy,
      });
      return reply.status(201).send(result);
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // 서비스 간 결재 상신 취소 (expense-service의 정산 취소 흐름에서 호출)
  app.post("/internal/documents/:id/withdraw", async (request, reply) => {
    if (!requireInternalToken(request, reply)) return;
    const { id } = request.params as { id: string };
    const body = request.body as { requesterId: string };
    if (!body.requesterId) return reply.status(400).send({ error: "requesterId required" });
    try {
      const doc = await app.documentService.withdraw(id, body.requesterId);
      return reply.send(doc);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // v1.6 (2026-05-14): referenceType/referenceId로 진행중인 결재 문서들 일괄 withdraw
  //   발주 상신 취소 등에서 사용. 진행중(DRAFT/SUBMITTED/STEP_*)인 모든 문서를 RETURNED 처리.
  app.post("/internal/documents/withdraw-by-reference", async (request, reply) => {
    if (!requireInternalToken(request, reply)) return;
    const body = request.body as { referenceType?: string; referenceId?: string };
    if (!body.referenceType || !body.referenceId) {
      return reply.status(400).send({ error: "referenceType, referenceId required" });
    }
    try {
      const inflight = await prisma.approvalDocument.findMany({
        where: {
          referenceType: body.referenceType,
          referenceId: body.referenceId,
          status: { in: ["DRAFT", "AGREEMENT_PENDING", "SUBMITTED", "STEP_1_PENDING", "STEP_2_PENDING", "STEP_3_PENDING"] as any },
        },
        select: { id: true },
      });
      const updated = await prisma.approvalDocument.updateMany({
        where: { id: { in: inflight.map((d) => d.id) } },
        data: { status: "RETURNED" },
      });
      return reply.send({ withdrawn: updated.count });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
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
