import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyJwt from "@fastify/jwt";
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import { z } from "zod";
import cron from "node-cron";

import { authMiddleware } from "./api/middleware/auth.middleware.js";
import { attendanceRoutes } from "./api/routes/attendance.routes.js";
import { leaveRoutes } from "./api/routes/leave.routes.js";
import { overtimeRoutes } from "./api/routes/overtime.routes.js";
import { policyRoutes } from "./api/routes/policy.routes.js";
import { teamRoutes } from "./api/routes/team.routes.js";
import { notificationRoutes } from "./api/routes/notification.routes.js";

import { AttendanceService } from "./application/attendance.service.js";
import { LeaveService } from "./application/leave.service.js";
import { OvertimeService } from "./application/overtime.service.js";
import { PolicyService } from "./application/policy.service.js";
import { NotificationService } from "./application/notification.service.js";
import { AuthClient } from "./infrastructure/auth-client.js";

// ─── Env 검증 ──────────────────────────────────────────────────────────────
const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  JWT_ACCESS_SECRET: z.string().min(16),
  PORT: z.string().default("3004"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  INTERNAL_API_TOKEN: z.string().min(16),
  PROJECT_SERVICE_URL: z.string().default("http://project-service:3003"),
  AUTH_SERVICE_URL: z.string().default("http://auth-service:3001"),
});

const env = envSchema.parse(process.env);

// ─── Infrastructure ────────────────────────────────────────────────────────
const prisma = new PrismaClient({
  log: env.LOG_LEVEL === "debug" ? ["query", "info", "warn", "error"] : ["warn", "error"],
});
const redis = new Redis(env.REDIS_URL);
redis.on("error", (err) => console.error("Redis error:", err));

// ─── Services ──────────────────────────────────────────────────────────────
const attendanceService = new AttendanceService(prisma);
const leaveService = new LeaveService(prisma);
const overtimeService = new OvertimeService(prisma);
const policyService = new PolicyService(prisma);
const notificationService = new NotificationService(prisma, redis);
const authClient = new AuthClient(env.AUTH_SERVICE_URL, env.INTERNAL_API_TOKEN, redis);

// ─── Type declarations ─────────────────────────────────────────────────────
declare module "fastify" {
  interface FastifyInstance {
    attendanceService: AttendanceService;
    leaveService: LeaveService;
    overtimeService: OvertimeService;
    policyService: PolicyService;
    notificationService: NotificationService;
    authClient: AuthClient;
    prisma: PrismaClient;
  }
}

async function buildApp() {
  const app = Fastify({ logger: { level: env.LOG_LEVEL } });

  await app.register(fastifyCors, { origin: env.CORS_ORIGIN, credentials: true });
  await app.register(fastifyJwt, { secret: env.JWT_ACCESS_SECRET });

  // 서비스 데코레이터
  app.decorate("attendanceService", attendanceService);
  app.decorate("leaveService", leaveService);
  app.decorate("overtimeService", overtimeService);
  app.decorate("policyService", policyService);
  app.decorate("notificationService", notificationService);
  app.decorate("authClient", authClient);
  app.decorate("prisma", prisma);

  await app.register(authMiddleware);

  // 에러 핸들러
  app.setErrorHandler((error, _req, reply) => {
    if (error.message.includes("허용되지 않습니다") || error.message.includes("초과합니다") ||
        error.message.includes("없습니다") || error.message.includes("없는 신청")) {
      return reply.status(400).send({ code: "BUSINESS_ERROR", message: error.message });
    }
    if (error.name === "ZodError") {
      return reply.status(400).send({ code: "VALIDATION_ERROR", message: "요청 데이터가 올바르지 않습니다." });
    }
    app.log.error(error);
    return reply.status(500).send({ code: "INTERNAL_ERROR", message: "서버 내부 오류가 발생했습니다." });
  });

  // Health check
  app.get("/health", async () => ({
    status: "ok", service: "attendance-service", timestamp: new Date().toISOString(),
  }));

  // Routes
  app.register(attendanceRoutes, { prefix: "/api/v1/attendance" });
  app.register(leaveRoutes, { prefix: "/api/v1/leave" });
  app.register(overtimeRoutes, { prefix: "/api/v1/overtime" });
  app.register(policyRoutes, { prefix: "/api/v1/policy" });
  app.register(teamRoutes, { prefix: "/api/v1/team" });
  app.register(notificationRoutes, { prefix: "/api/v1/notifications" });

  return app;
}

async function start() {
  const app = await buildApp();
  const PORT = parseInt(env.PORT, 10);
  await app.listen({ port: PORT, host: "0.0.0.0" });
  app.log.info(`attendance-service running on port ${PORT}`);

  // ─── Cron Jobs ───────────────────────────────────────────────────────────

  // 미출근 자동 처리 (매일 자정 +10분)
  cron.schedule("10 0 * * *", async () => {
    try {
      await attendanceService.processAbsentRecords();
      app.log.info("Absent records processed");
    } catch (err) {
      app.log.error({ err }, "Absent cron failed");
    }
  });

  // 연차 자동 부여 (1월 1일 00:01 — FISCAL_YEAR)
  cron.schedule("1 0 1 1 *", async () => {
    try {
      const year = new Date().getFullYear();
      await leaveService.grantAnnualLeaveAll(year);
      app.log.info(`Annual leave granted for year ${year}`);
    } catch (err) {
      app.log.error({ err }, "Annual leave grant cron failed");
    }
  });

  // 마감 임박 + Stale 세그먼트 알림 (매일 오전 9시)
  cron.schedule("0 9 * * 1-5", async () => {
    try {
      await notifyDueSoonAndStale(app.log);
    } catch (err) {
      app.log.error({ err }, "Due/stale notification cron failed");
    }
  });

  app.log.info("Cron jobs scheduled");

  // Graceful shutdown
  const shutdown = async () => {
    await app.close();
    await prisma.$disconnect();
    redis.disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

async function notifyDueSoonAndStale(log: any) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueSoon = new Date(today);
  dueSoon.setDate(dueSoon.getDate() + 3);

  // project-service에서 D-3 세그먼트 조회
  try {
    const resp = await fetch(
      `${env.PROJECT_SERVICE_URL}/api/v1/me/stale-segments?staleDays=3`,
      { headers: { "X-Internal-Token": env.INTERNAL_API_TOKEN } },
    );
    if (resp.ok) {
      const stale = await resp.json() as any[];
      for (const seg of stale) {
        await notificationService.create({
          userId: seg.userId,
          type: "PROGRESS_STALE",
          title: "진행률 미업데이트",
          body: `[${seg.projectName}] ${seg.segmentName} 세그먼트가 ${seg.staleDays}일간 업데이트되지 않았습니다.`,
          linkUrl: `/projects/${seg.projectId}`,
          priority: 2,
        });
      }
    }
  } catch (err) {
    log.warn({ err }, "Failed to fetch stale segments");
  }
}

start().catch((err) => {
  console.error("Failed to start attendance-service:", err);
  process.exit(1);
});
