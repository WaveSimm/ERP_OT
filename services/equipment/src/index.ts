import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyJwt from "@fastify/jwt";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";

import { authMiddleware } from "./api/middleware/auth.middleware.js";
import { equipmentRoutes } from "./api/routes/equipment.routes.js";
import { sensorRoutes } from "./api/routes/sensor.routes.js";
import { categoryRoutes } from "./api/routes/category.routes.js";
import { maintenanceRoutes } from "./api/routes/maintenance.routes.js";
import { scheduleRoutes } from "./api/routes/schedule.routes.js";
import { deploymentRoutes } from "./api/routes/deployment.routes.js";
import { compatibilityRoutes } from "./api/routes/compatibility.routes.js";

import { EquipmentService } from "./application/equipment.service.js";
import { SensorService } from "./application/sensor.service.js";
import { CategoryService } from "./application/category.service.js";
import { MaintenanceService } from "./application/maintenance.service.js";
import { ScheduleService } from "./application/schedule.service.js";
import { DeploymentService } from "./application/deployment.service.js";
import { CompatibilityService } from "./application/compatibility.service.js";
import { StatsService } from "./application/stats.service.js";
import { TemplateService } from "./application/template.service.js";
import { CustomerService } from "./application/customer.service.js";
import { CustomerAssetService } from "./application/customer-asset.service.js";
import { RepairOrderService } from "./application/repair-order.service.js";
import { InspectionReportService } from "./application/inspection-report.service.js";
import { RepairCostService } from "./application/repair-cost.service.js";
import { RepairQuoteService } from "./application/repair-quote.service.js";
import { PartService } from "./application/part.service.js";
import { PurchaseOrderService } from "./application/purchase-order.service.js";
import { ShipmentService } from "./application/shipment.service.js";
import { RepairStatsService } from "./application/repair-stats.service.js";
import { statsRoutes } from "./api/routes/stats.routes.js";
import { templateRoutes } from "./api/routes/template.routes.js";
import { customerRoutes } from "./api/routes/customer.routes.js";
import { customerAssetRoutes } from "./api/routes/customer-asset.routes.js";
import { repairOrderRoutes } from "./api/routes/repair-order.routes.js";
import { inspectionReportRoutes } from "./api/routes/inspection-report.routes.js";
import { repairCostRoutes } from "./api/routes/repair-cost.routes.js";
import { repairQuoteRoutes } from "./api/routes/repair-quote.routes.js";
import { partRoutes } from "./api/routes/part.routes.js";
import { partTransactionRoutes } from "./api/routes/part-transaction.routes.js";
import { purchaseOrderRoutes } from "./api/routes/purchase-order.routes.js";
import { shipmentRoutes as shipmentMgmtRoutes } from "./api/routes/shipment.routes.js";
import { repairStatsRoutes } from "./api/routes/repair-stats.routes.js";

// ─── Env 검증 ──────────────────────────────────────────────────────────────
const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(16),
  PORT: z.string().default("3005"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  INTERNAL_API_TOKEN: z.string().min(16),
  AUTH_SERVICE_URL: z.string().default("http://auth-service:3001"),
  PROJECT_SERVICE_URL: z.string().default("http://project-service:3003"),
});

const env = envSchema.parse(process.env);

// ─── Infrastructure ────────────────────────────────────────────────────────
const prisma = new PrismaClient({
  log: env.LOG_LEVEL === "debug" ? ["query", "info", "warn", "error"] : ["warn", "error"],
});

// ─── Services ──────────────────────────────────────────────────────────────
const equipmentService = new EquipmentService(prisma);
const sensorService = new SensorService(prisma);
const categoryService = new CategoryService(prisma);
const maintenanceService = new MaintenanceService(prisma);
const scheduleService = new ScheduleService(prisma);
const deploymentService = new DeploymentService(prisma);
const compatibilityService = new CompatibilityService(prisma);
const statsService = new StatsService(prisma);
const templateService = new TemplateService(prisma);
const customerService = new CustomerService(prisma);
const customerAssetService = new CustomerAssetService(prisma);
const repairOrderService = new RepairOrderService(prisma);
const inspectionReportService = new InspectionReportService(prisma);
const repairCostService = new RepairCostService(prisma);
const repairQuoteService = new RepairQuoteService(prisma);
const partService = new PartService(prisma);
const purchaseOrderService = new PurchaseOrderService(prisma);
const shipmentService = new ShipmentService(prisma);
const repairStatsService = new RepairStatsService(prisma);

// ─── Type declarations ─────────────────────────────────────────────────────
declare module "fastify" {
  interface FastifyInstance {
    equipmentService: EquipmentService;
    sensorService: SensorService;
    categoryService: CategoryService;
    maintenanceService: MaintenanceService;
    scheduleService: ScheduleService;
    deploymentService: DeploymentService;
    compatibilityService: CompatibilityService;
    statsService: StatsService;
    templateService: TemplateService;
    customerService: CustomerService;
    customerAssetService: CustomerAssetService;
    repairOrderService: RepairOrderService;
    inspectionReportService: InspectionReportService;
    repairCostService: RepairCostService;
    repairQuoteService: RepairQuoteService;
    partService: PartService;
    purchaseOrderService: PurchaseOrderService;
    shipmentService: ShipmentService;
    repairStatsService: RepairStatsService;
    prisma: PrismaClient;
  }
}

async function buildApp() {
  const app = Fastify({ logger: { level: env.LOG_LEVEL } });

  await app.register(fastifyCors, { origin: env.CORS_ORIGIN, credentials: true });
  await app.register(fastifyJwt, { secret: env.JWT_ACCESS_SECRET });

  // 서비스 데코레이터
  app.decorate("equipmentService", equipmentService);
  app.decorate("sensorService", sensorService);
  app.decorate("categoryService", categoryService);
  app.decorate("maintenanceService", maintenanceService);
  app.decorate("scheduleService", scheduleService);
  app.decorate("deploymentService", deploymentService);
  app.decorate("compatibilityService", compatibilityService);
  app.decorate("statsService", statsService);
  app.decorate("templateService", templateService);
  app.decorate("customerService", customerService);
  app.decorate("customerAssetService", customerAssetService);
  app.decorate("repairOrderService", repairOrderService);
  app.decorate("inspectionReportService", inspectionReportService);
  app.decorate("repairCostService", repairCostService);
  app.decorate("repairQuoteService", repairQuoteService);
  app.decorate("partService", partService);
  app.decorate("purchaseOrderService", purchaseOrderService);
  app.decorate("shipmentService", shipmentService);
  app.decorate("repairStatsService", repairStatsService);
  app.decorate("prisma", prisma);

  await app.register(authMiddleware);

  // 에러 핸들러
  app.setErrorHandler((error, _req, reply) => {
    app.log.error({ err: error, url: _req.url, method: _req.method }, "Request error");
    if (error.message.includes("찾을 수 없습니다") || error.message.includes("허용되지 않습니다") ||
        error.message.includes("사용할 수 없습니다") || error.message.includes("호환되지 않습니다") ||
        error.message.includes("일정 충돌") || error.message.includes("삭제할 수 없습니다") ||
        error.message.includes("필수입니다")) {
      return reply.status(400).send({ code: "BUSINESS_ERROR", message: error.message });
    }
    if (error.name === "ZodError") {
      return reply.status(400).send({ code: "VALIDATION_ERROR", message: "요청 데이터가 올바르지 않습니다." });
    }
    return reply.status(500).send({ code: "INTERNAL_ERROR", message: "서버 내부 오류가 발생했습니다." });
  });

  // Health check
  app.get("/health", async () => ({
    status: "ok", service: "equipment-service", timestamp: new Date().toISOString(),
  }));

  // Routes
  app.register(equipmentRoutes, { prefix: "/api/v1/equipment" });
  app.register(sensorRoutes, { prefix: "/api/v1/sensors" });
  app.register(categoryRoutes, { prefix: "/api/v1/categories" });
  app.register(maintenanceRoutes, { prefix: "/api/v1/maintenance" });
  app.register(scheduleRoutes, { prefix: "/api/v1/schedules" });
  app.register(deploymentRoutes, { prefix: "/api/v1/deployments" });
  app.register(compatibilityRoutes, { prefix: "/api/v1/compatibility" });
  app.register(statsRoutes, { prefix: "/api/v1/stats" });
  app.register(templateRoutes, { prefix: "/api/v1/deployment-templates" });
  app.register(customerRoutes, { prefix: "/api/v1/customers" });
  app.register(customerAssetRoutes, { prefix: "/api/v1/customer-assets" });
  app.register(repairOrderRoutes, { prefix: "/api/v1/repair-orders" });
  app.register(inspectionReportRoutes, { prefix: "/api/v1/inspection-reports" });
  app.register(repairCostRoutes, { prefix: "/api/v1/repair-costs" });
  app.register(repairQuoteRoutes, { prefix: "/api/v1/repair-quotes" });
  app.register(partRoutes, { prefix: "/api/v1/parts" });
  app.register(partTransactionRoutes, { prefix: "/api/v1/part-transactions" });
  app.register(purchaseOrderRoutes, { prefix: "/api/v1/purchase-orders" });
  app.register(shipmentMgmtRoutes, { prefix: "/api/v1/shipments" });
  app.register(repairStatsRoutes, { prefix: "/api/v1/repair-stats" });

  return app;
}

async function start() {
  const app = await buildApp();
  const PORT = parseInt(env.PORT, 10);
  await app.listen({ port: PORT, host: "0.0.0.0" });
  app.log.info(`equipment-service running on port ${PORT}`);

  // Graceful shutdown
  const shutdown = async () => {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

start().catch((err) => {
  console.error("Failed to start equipment-service:", err);
  process.exit(1);
});
