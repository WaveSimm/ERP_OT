import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyHelmet from "@fastify/helmet";
import fastifyRateLimit from "@fastify/rate-limit";
import { rateLimitPolicies, rateLimitErrorResponseBuilder } from "@erp-ot/shared";
import fastifyJwt from "@fastify/jwt";
import fastifyCookie from "@fastify/cookie";
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

import { EquipmentService } from "./application/asset/equipment.service.js";
import { SensorService } from "./application/asset/sensor.service.js";
import { CategoryService } from "./application/asset/category.service.js";
import { PrismaCategoryRepository } from "./infrastructure/repositories/category.repository.js";
import { MaintenanceService } from "./application/asset/maintenance.service.js";
import { ScheduleService } from "./application/asset/schedule.service.js";
import { DeploymentService } from "./application/asset/deployment.service.js";
import { CompatibilityService } from "./application/asset/compatibility.service.js";
import { StatsService } from "./application/asset/stats.service.js";
import { TemplateService } from "./application/asset/template.service.js";
import { PrismaDeploymentTemplateRepository } from "./infrastructure/repositories/deployment-template.repository.js";
import { CustomerService } from "./application/repair/customer.service.js";
import { CustomerAssetService } from "./application/repair/customer-asset.service.js";
import { RepairOrderService } from "./application/repair/repair-order.service.js";
import { PrismaRepairOrderRepository } from "./infrastructure/repositories/repair-order.repository.js";
import { InspectionReportService } from "./application/repair/inspection-report.service.js";
import { RepairCostService } from "./application/repair/repair-cost.service.js";
import { PrismaRepairCostRepository } from "./infrastructure/repositories/repair-cost.repository.js";
import { RepairQuoteService } from "./application/repair/repair-quote.service.js";
import { PartService } from "./application/repair/part.service.js";
import { PrismaPartRepository } from "./infrastructure/repositories/part.repository.js";
import { PurchaseOrderService } from "./application/procurement/purchase-order.service.js";
import { ShipmentService } from "./application/repair/shipment.service.js";
import { PrismaShipmentRepository } from "./infrastructure/repositories/shipment.repository.js";
import { RepairStatsService } from "./application/repair/repair-stats.service.js";
import { ProductMasterService } from "./application/inventory/product-master.service.js";
import { ProductVariantService } from "./application/inventory/product-variant.service.js";
import { productVariantRoutes } from "./api/routes/product-variant.routes.js";
import { InboundRequestService } from "./application/inventory/inbound-request.service.js";
import { inboundRequestRoutes, inboundRequestInternalRoutes } from "./api/routes/inbound-request.routes.js";
import { BundleShipmentService } from "./application/inventory/bundle-shipment.service.js";
import { bundleShipmentRoutes } from "./api/routes/bundle-shipment.routes.js";
import { ContractService } from "./application/procurement/contract.service.js";
import { OverseasOrderService } from "./application/procurement/overseas-order.service.js";
import { OrderProgressService } from "./application/procurement/order-progress.service.js";
import { OrderSettlementService } from "./application/procurement/order-settlement.service.js";
import { orderSettlementRoutes } from "./api/routes/order-settlement.routes.js";
import { CustomsTaxService } from "./application/procurement/customs-tax.service.js";
import { customsTaxRoutes } from "./api/routes/customs-tax.routes.js";
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
import { productMasterRoutes, contractRoutes, overseasOrderRoutes, internalOrderRoutes } from "./api/routes/procurement.routes.js";
import { inventoryRoutes, inventoryTransactionRoutes, assetCostRoutes } from "./api/routes/inventory.routes.js";
import { InventoryService } from "./application/inventory/inventory.service.js";
import { InventoryTransactionService } from "./application/inventory/inventory-transaction.service.js";
import { AssetCostService } from "./application/inventory/asset-cost.service.js";
import { ExpenseFollowUpService } from "./application/procurement/expense-followup.service.js";
import { ImportCostService } from "./application/procurement/import-cost.service.js";
import { InventoryAuditService } from "./application/inventory/inventory-audit.service.js";
import { expenseFollowUpRoutes, internalExpenseRoutes } from "./api/routes/expense-followup.routes.js";
import { importCostRoutes } from "./api/routes/import-cost.routes.js";
import { inventoryAuditRoutes } from "./api/routes/inventory-audit.routes.js";
import { SupplierService } from "./application/procurement/supplier.service.js";
import { PrismaSupplierRepository } from "./infrastructure/repositories/supplier.repository.js";
import { supplierRoutes } from "./api/routes/supplier.routes.js";
import { StorageLocationService } from "./application/inventory/storage-location.service.js";
import { PrismaStorageLocationRepository } from "./infrastructure/repositories/storage-location.repository.js";
import { storageLocationRoutes } from "./api/routes/storage-location.routes.js";

// ─── Env 검증 ──────────────────────────────────────────────────────────────
const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(16),
  PORT: z.string().default("3005"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
  // 보안 일괄패치 PDCA Layer 1 (NEW-14): * 차단 + 빈 값 차단
  CORS_ORIGIN: z
    .string()
    .min(1, "CORS_ORIGIN required")
    .refine((v) => v !== "*", "CORS_ORIGIN cannot be '*' with credentials")
    .default("http://localhost:3000"),
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
const categoryService = new CategoryService(new PrismaCategoryRepository(prisma), prisma);
const maintenanceService = new MaintenanceService(prisma);
const scheduleService = new ScheduleService(prisma);
const deploymentService = new DeploymentService(prisma);
const compatibilityService = new CompatibilityService(prisma);
const statsService = new StatsService(prisma);
const templateService = new TemplateService(new PrismaDeploymentTemplateRepository(prisma), prisma);
const customerService = new CustomerService(prisma);
const customerAssetService = new CustomerAssetService(prisma);
const repairOrderService = new RepairOrderService(new PrismaRepairOrderRepository(prisma), prisma);
const inspectionReportService = new InspectionReportService(prisma);
const repairCostService = new RepairCostService(new PrismaRepairCostRepository(prisma));
const repairQuoteService = new RepairQuoteService(prisma);
const partService = new PartService(new PrismaPartRepository(prisma), prisma);
const purchaseOrderService = new PurchaseOrderService(prisma);
const shipmentService = new ShipmentService(new PrismaShipmentRepository(prisma), prisma);
const repairStatsService = new RepairStatsService(prisma);
const productMasterService = new ProductMasterService(prisma);
const productVariantService = new ProductVariantService(prisma);
const contractService = new ContractService(prisma);
const overseasOrderService = new OverseasOrderService(prisma);
const orderProgressService = new OrderProgressService(prisma);
const orderSettlementService = new OrderSettlementService(prisma);
const customsTaxService = new CustomsTaxService(prisma);
const inventoryService = new InventoryService(prisma);
const inventoryTransactionService = new InventoryTransactionService(prisma);
const assetCostService = new AssetCostService(prisma);
const importCostService = new ImportCostService(prisma);
const inventoryAuditService = new InventoryAuditService(prisma);
const supplierService = new SupplierService(new PrismaSupplierRepository(prisma), prisma);
const storageLocationService = new StorageLocationService(new PrismaStorageLocationRepository(prisma), prisma);
const inboundRequestService = new InboundRequestService(prisma, inventoryService);
const bundleShipmentService = new BundleShipmentService(prisma);
const expenseFollowUpService = new ExpenseFollowUpService(prisma, inboundRequestService);

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
    productMasterService: ProductMasterService;
    productVariantService: ProductVariantService;
    contractService: ContractService;
    overseasOrderService: OverseasOrderService;
    orderProgressService: OrderProgressService;
    orderSettlementService: OrderSettlementService;
    customsTaxService: CustomsTaxService;
    inventoryService: InventoryService;
    inventoryTransactionService: InventoryTransactionService;
    assetCostService: AssetCostService;
    expenseFollowUpService: ExpenseFollowUpService;
    importCostService: ImportCostService;
    inventoryAuditService: InventoryAuditService;
    supplierService: SupplierService;
    storageLocationService: StorageLocationService;
    inboundRequestService: InboundRequestService;
    bundleShipmentService: BundleShipmentService;
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
  app.decorate("productMasterService", productMasterService);
  app.decorate("productVariantService", productVariantService);
  app.decorate("contractService", contractService);
  app.decorate("overseasOrderService", overseasOrderService);
  app.decorate("orderProgressService", orderProgressService);
  app.decorate("orderSettlementService", orderSettlementService);
  app.decorate("customsTaxService", customsTaxService);
  app.decorate("inventoryService", inventoryService);
  app.decorate("inventoryTransactionService", inventoryTransactionService);
  app.decorate("assetCostService", assetCostService);
  app.decorate("expenseFollowUpService", expenseFollowUpService);
  app.decorate("importCostService", importCostService);
  app.decorate("inventoryAuditService", inventoryAuditService);
  app.decorate("supplierService", supplierService);
  app.decorate("storageLocationService", storageLocationService);
  app.decorate("inboundRequestService", inboundRequestService);
  app.decorate("bundleShipmentService", bundleShipmentService);
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

  // 구매 관리
  app.register(productMasterRoutes, { prefix: "/api/v1/procurement/products" });
  app.register(productVariantRoutes, { prefix: "/api/v1/product-variants" });
  app.register(contractRoutes, { prefix: "/api/v1/procurement/contracts" });
  app.register(supplierRoutes, { prefix: "/api/v1/suppliers" });
  app.register(overseasOrderRoutes, { prefix: "/api/v1/procurement/orders" });
  app.register(internalOrderRoutes);

  // v1.6 회계정산 (2026-05-14)
  app.register(orderSettlementRoutes, { prefix: "/api/v1/procurement" });
  app.register(customsTaxRoutes, { prefix: "/api/v1/procurement" });

  // 재고 관리
  app.register(inventoryRoutes, { prefix: "/api/v1/inventory/items" });
  app.register(inventoryTransactionRoutes, { prefix: "/api/v1/inventory/transactions" });
  app.register(assetCostRoutes, { prefix: "/api/v1/inventory/costs" });

  // 지출결의 후속처리
  app.register(expenseFollowUpRoutes, { prefix: "/api/v1/procurement/expenses" });
  app.register(internalExpenseRoutes);

  // 수입원가정산
  app.register(importCostRoutes, { prefix: "/api/v1/procurement/settlements" });

  // 재고 실사
  app.register(inventoryAuditRoutes, { prefix: "/api/v1/inventory/audits" });

  // 보관위치 관리
  app.register(storageLocationRoutes, { prefix: "/api/v1/inventory/locations" });

  // v1.6 입고 대기 큐 (2026-05-13)
  app.register(inboundRequestRoutes, { prefix: "/api/v1/inbound-requests" });
  app.register(inboundRequestInternalRoutes);

  // v1.6 Bundle (2026-05-13). B안 적용 후 BomDefinition은 ProductMaster(BUNDLE)로 통합됨
  app.register(bundleShipmentRoutes, { prefix: "/api/v1/bundle-shipments" });

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
