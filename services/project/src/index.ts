import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyJwt from "@fastify/jwt";
import fastifyMultipart from "@fastify/multipart";
import fastifyPlugin from "fastify-plugin";
import { Server } from "socket.io";
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import { z } from "zod";
import cron from "node-cron";

import { authMiddleware } from "./api/middleware/auth.middleware.js";
import { projectRoutes } from "./api/routes/project.routes.js";
import { taskRoutes } from "./api/routes/task.routes.js";
import { groupRoutes } from "./api/routes/group.routes.js";
import { impactRoutes } from "./api/routes/impact.routes.js";
import { baselineRoutes } from "./api/routes/baseline.routes.js";
import { templateRoutes } from "./api/routes/template.routes.js";
import { resourceRoutes } from "./api/routes/resource.routes.js";
import { collabRoutes } from "./api/routes/collab.routes.js";
import { notificationRoutes } from "./api/routes/notification.routes.js";
import { myTasksRoutes } from "./api/routes/my-tasks.routes.js";
import { meRoutes } from "./api/routes/me.routes.js";
import { dashboardRoutes } from "./api/routes/dashboard.routes.js";

import { ProjectService } from "./application/project.service.js";
import { TaskService } from "./application/task.service.js";
import { CpmService } from "./application/cpm.service.js";
import { GroupService } from "./application/group.service.js";
import { ImpactService } from "./application/impact.service.js";
import { BaselineService } from "./application/baseline.service.js";
import { TemplateService } from "./application/template.service.js";
import { ResourceService } from "./application/resource.service.js";
import { CollabService } from "./application/collab.service.js";

import { ProjectCacheService } from "./infrastructure/cache/project.cache.js";
import { ProjectGateway } from "./infrastructure/websocket/project.gateway.js";
import { RiskDetectionService } from "./application/risk-detection.service.js";
import { DashboardService } from "./application/dashboard/dashboard.service.js";

// ─── Env 검증 ─────────────────────────────────────────────────────────────────
const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  JWT_ACCESS_SECRET: z.string().min(16),
  PORT: z.string().default("3003"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  INTERNAL_API_TOKEN: z.string().min(16),
  STORAGE_PATH: z.string().default("/app/storage"),
});

const env = envSchema.parse(process.env);

// ─── Infrastructure ────────────────────────────────────────────────────────────
const prisma = new PrismaClient({
  log: env.LOG_LEVEL === "debug" ? ["query", "info", "warn", "error"] : ["warn", "error"],
});

const redis = new Redis(env.REDIS_URL);

redis.on("error", (err) => {
  console.error("Redis connection error:", err);
});

// ─── Services ─────────────────────────────────────────────────────────────────
const gateway = new ProjectGateway();
const cache = new ProjectCacheService(redis);
const projectService = new ProjectService(prisma, cache, gateway);
const taskService = new TaskService(prisma, cache, gateway);
const cpmService = new CpmService(prisma, cache, gateway);
const groupService = new GroupService(prisma, cache, gateway);
const impactService = new ImpactService(prisma, cpmService);
const baselineService = new BaselineService(prisma);
const templateService = new TemplateService(prisma);
const resourceService = new ResourceService(prisma, cache);
const collabService = new CollabService(prisma, gateway, env.STORAGE_PATH);
const riskDetectionService = new RiskDetectionService(prisma, gateway);
const dashboardService = new DashboardService(prisma, redis);

// ─── Fastify + Socket.io Setup ────────────────────────────────────────────────
declare module "fastify" {
  interface FastifyInstance {
    projectService: ProjectService;
    taskService: TaskService;
    cpmService: CpmService;
    groupService: GroupService;
    impactService: ImpactService;
    baselineService: BaselineService;
    templateService: TemplateService;
    resourceService: ResourceService;
    collabService: CollabService;
    prisma: PrismaClient;
    redis: Redis;
  }
}

async function buildApp() {
  const app = Fastify({
    logger: { level: env.LOG_LEVEL },
  });

  // CORS
  await app.register(fastifyCors, {
    origin: env.CORS_ORIGIN,
    credentials: true,
  });

  // JWT
  await app.register(fastifyJwt, {
    secret: env.JWT_ACCESS_SECRET,
  });

  // Multipart (파일 업로드)
  await app.register(fastifyMultipart, {
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  });

  // 서비스 인스턴스 데코레이터
  app.decorate("projectService", projectService);
  app.decorate("taskService", taskService);
  app.decorate("cpmService", cpmService);
  app.decorate("groupService", groupService);
  app.decorate("impactService", impactService);
  app.decorate("baselineService", baselineService);
  app.decorate("templateService", templateService);
  app.decorate("resourceService", resourceService);
  app.decorate("collabService", collabService);
  app.decorate("prisma", prisma);
  app.decorate("redis", redis);

  // 인증 미들웨어
  await app.register(authMiddleware);

  // 에러 핸들러
  app.setErrorHandler((error, request, reply) => {
    const isAppError = "code" in error && "statusCode" in error;
    if (isAppError) {
      return reply.status((error as any).statusCode).send({
        code: (error as any).code,
        message: error.message,
      });
    }

    if (error.name === "ZodError") {
      return reply.status(400).send({
        code: "VALIDATION_ERROR",
        message: "요청 데이터가 올바르지 않습니다.",
        details: (error as any).errors,
      });
    }

    app.log.error(error);
    return reply.status(500).send({
      code: "INTERNAL_ERROR",
      message: "서버 내부 오류가 발생했습니다.",
    });
  });

  // ─── Routes ──────────────────────────────────────────────────────────────────
  app.get("/health", async () => ({
    status: "ok",
    service: "project-service",
    timestamp: new Date().toISOString(),
  }));

  app.register(projectRoutes, { prefix: "/api/v1/projects" });
  app.register(groupRoutes, { prefix: "/api/v1/groups" });
  app.register(impactRoutes, { prefix: "/api/v1/projects" });
  app.register(baselineRoutes, { prefix: "/api/v1/projects" });
  app.register(templateRoutes, { prefix: "/api/v1" });
  app.register(resourceRoutes, { prefix: "/api/v1/resources" });
  app.register(collabRoutes, { prefix: "/api/v1" });
  app.register(notificationRoutes, { prefix: "/api/v1/notifications" });
  app.register(myTasksRoutes, { prefix: "/api/v1/tasks" });
  app.register(meRoutes, { prefix: "/api/v1/me" });
  app.register(dashboardRoutes, { prefix: "/api/v1/dashboard" });
  app.register(
    async (instance) => {
      instance.register(taskRoutes, { prefix: "/:projectId/tasks" });
      // CPM 경로
      instance.post("/:projectId/cpm", {
        preHandler: async (req, reply) => {
          if (!["ADMIN", "MANAGER"].includes(req.userRole)) {
            return reply.status(403).send({ code: "FORBIDDEN", message: "권한이 없습니다." });
          }
        },
      }, async (req, reply) => {
        const { projectId } = req.params as { projectId: string };
        const result = await cpmService.runProjectCpm(projectId);
        return reply.send(result);
      });
    },
    { prefix: "/api/v1/projects" },
  );

  return app;
}

// ─── Start ─────────────────────────────────────────────────────────────────────
async function start() {
  const app = await buildApp();
  const PORT = parseInt(env.PORT, 10);

  await app.ready();

  // Socket.io를 Fastify 내부 서버에 붙이기
  const io = new Server(app.server, {
    cors: { origin: env.CORS_ORIGIN, credentials: true },
  });
  gateway.setServer(io);

  await app.listen({ port: PORT, host: "0.0.0.0" });
  app.log.info(`project-service running on port ${PORT}`);

  // 지연 리스크 감지 Cron Job (매 5분마다 실행)
  cron.schedule("*/5 * * * *", async () => {
    try {
      await riskDetectionService.detectAndNotify();
    } catch (err) {
      app.log.error({ err }, "Risk detection cron failed");
    }
  });
  app.log.info("Risk detection cron job scheduled (every 5 minutes)");

  // 대시보드 캐시 갱신 Cron Job (매 5분마다 실행)
  cron.schedule("*/5 * * * *", async () => {
    try {
      await dashboardService.refreshAll();
    } catch (err) {
      app.log.error({ err }, "Dashboard cache refresh cron failed");
    }
  });
  app.log.info("Dashboard cache refresh cron job scheduled (every 5 minutes)");

  // Graceful shutdown
  const shutdown = async () => {
    app.log.info("Shutting down project-service...");
    await app.close();
    await prisma.$disconnect();
    redis.disconnect();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

start().catch((err) => {
  console.error("Failed to start project-service:", err);
  process.exit(1);
});
