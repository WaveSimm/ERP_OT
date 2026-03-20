import { FastifyInstance } from "fastify";
import { z } from "zod";
import { ResourceService } from "../../application/resource.service.js";
import { requireRole } from "../middleware/auth.middleware.js";
import { ResourceType } from "@prisma/client";

const createGroupSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  parentId: z.string().optional(),
  sortOrder: z.number().int().optional(),
});

const updateGroupSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  parentId: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

const createResourceSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.nativeEnum(ResourceType).optional(),
  userId: z.string().optional(),
  dailyCapacityHours: z.number().positive().max(24).optional(),
});

const updateResourceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  type: z.nativeEnum(ResourceType).optional(),
  userId: z.string().nullable().optional(),
  dailyCapacityHours: z.number().positive().max(24).optional(),
  isActive: z.boolean().optional(),
});

const dateRangeSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 형식이어야 합니다."),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 형식이어야 합니다."),
});

export async function resourceRoutes(fastify: FastifyInstance) {
  const service: ResourceService = fastify.resourceService;

  // ─── Resource Groups ───────────────────────────────────────────────────────

  // GET /api/v1/resources/groups
  fastify.get("/groups", async (_req, reply) => {
    return reply.send(await service.listResourceGroups());
  });

  // POST /api/v1/resources/groups
  fastify.post("/groups", {
    preHandler: requireRole("ADMIN", "MANAGER"),
  }, async (req, reply) => {
    const dto = createGroupSchema.parse(req.body);
    return reply.status(201).send(await service.createResourceGroup(dto as any));
  });

  // PATCH /api/v1/resources/groups/:groupId
  fastify.patch("/groups/:groupId", {
    preHandler: requireRole("ADMIN", "MANAGER"),
  }, async (req, reply) => {
    const { groupId } = req.params as { groupId: string };
    const dto = updateGroupSchema.parse(req.body);
    return reply.send(await service.updateResourceGroup(groupId, dto as any));
  });

  // DELETE /api/v1/resources/groups/:groupId
  fastify.delete("/groups/:groupId", {
    preHandler: requireRole("ADMIN", "MANAGER"),
  }, async (req, reply) => {
    const { groupId } = req.params as { groupId: string };
    await service.deleteResourceGroup(groupId);
    return reply.status(204).send();
  });

  // PUT /api/v1/resources/groups/:groupId/members  — 멤버 전체 교체
  fastify.put("/groups/:groupId/members", {
    preHandler: requireRole("ADMIN", "MANAGER"),
  }, async (req, reply) => {
    const { groupId } = req.params as { groupId: string };
    const { resourceIds } = z.object({ resourceIds: z.array(z.string()) }).parse(req.body);
    await service.setGroupMembers(groupId, resourceIds);
    return reply.status(204).send();
  });

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  // GET /api/v1/resources
  fastify.get("/", async (req, reply) => {
    const q = req.query as any;
    const filter: any = {};
    if (q.type) filter.type = q.type;
    if (q.isActive !== undefined) filter.isActive = q.isActive === "true";
    return reply.send(await service.listResources(filter));
  });

  // POST /api/v1/resources
  fastify.post("/", {
    preHandler: requireRole("ADMIN", "MANAGER"),
  }, async (req, reply) => {
    const dto = createResourceSchema.parse(req.body);
    return reply.status(201).send(await service.createResource(dto as any));
  });

  // PATCH /api/v1/resources/:resourceId
  fastify.patch("/:resourceId", {
    preHandler: requireRole("ADMIN", "MANAGER"),
  }, async (req, reply) => {
    const { resourceId } = req.params as { resourceId: string };
    const dto = updateResourceSchema.parse(req.body);
    return reply.send(await service.updateResource(resourceId, dto as any));
  });

  // ─── #27 운영 현황 대시보드 ──────────────────────────────────────────────
  // 주의: /dashboard는 /:resourceId보다 먼저 등록

  // GET /api/v1/resources/dashboard?startDate=&endDate=
  fastify.get("/dashboard", async (req, reply) => {
    const q = req.query as any;
    const { startDate, endDate } = dateRangeSchema.parse(q);
    return reply.send(await service.getDashboard(startDate, endDate));
  });

  // ─── #28 히트맵 ───────────────────────────────────────────────────────────

  // GET /api/v1/resources/heatmap?startDate=&endDate=&granularity=week|month
  fastify.get("/heatmap", async (req, reply) => {
    const q = req.query as any;
    const { startDate, endDate } = dateRangeSchema.parse(q);
    const granularity = q.granularity === "month" ? "month" : "week";
    return reply.send(await service.getHeatmap(startDate, endDate, granularity));
  });

  // ─── #26 유틸리제이션 ─────────────────────────────────────────────────────

  // GET /api/v1/resources/:resourceId/utilization?startDate=&endDate=
  fastify.get("/:resourceId/utilization", async (req, reply) => {
    const { resourceId } = req.params as { resourceId: string };
    const q = req.query as any;
    const { startDate, endDate } = dateRangeSchema.parse(q);
    return reply.send(await service.getUtilization(resourceId, startDate, endDate));
  });
}
