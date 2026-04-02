import { FastifyInstance } from "fastify";
import { z } from "zod";
import { TemplateService } from "../../application/template.service.js";
import { requireRole } from "../middleware/auth.middleware.js";
import { TemplateScope, AllocationMode } from "@prisma/client";

const createTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  category: z.string().min(1).max(100),
  tags: z.array(z.string()).optional(),
  scope: z.nativeEnum(TemplateScope).optional(),
  isRecommended: z.boolean().optional(),
  tasks: z.array(z.object({
    name: z.string().min(1).max(200),
    description: z.string().optional(),
    milestoneGroup: z.string().optional(),
    sortOrder: z.number().int().optional(),
    segments: z.array(z.object({
      name: z.string().min(1).max(200),
      sortOrder: z.number().int().optional(),
      dayOffsetStart: z.number().int().min(0),
      dayOffsetEnd: z.number().int().min(0),
      assignments: z.array(z.object({
        resourceRole: z.string().optional(),
        resourceId: z.string().optional(),
        allocationMode: z.nativeEnum(AllocationMode).optional(),
        allocationPercent: z.number().min(0).max(200).optional(),
        allocationHoursPerDay: z.number().min(0).optional(),
      })).optional(),
    })).optional(),
    dependencies: z.array(z.object({
      predecessorIndex: z.number().int().min(0),
      type: z.string().optional(),
      lagDays: z.number().int().optional(),
    })).optional(),
  })).optional(),
});

const updateTemplateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional().nullable(),
  category: z.string().min(1).max(100).optional(),
  tags: z.array(z.string()).optional(),
  scope: z.nativeEnum(TemplateScope).optional(),
  isRecommended: z.boolean().optional(),
});

const previewSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  taskIds: z.array(z.string()).optional(),
});

const instantiateSchema = z.object({
  projectName: z.string().min(1).max(200),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  includeAssignments: z.boolean(),
  taskIds: z.array(z.string()).optional(),
  dateAdjustments: z.array(z.object({
    templateSegmentId: z.string(),
    startDate: z.string(),
    endDate: z.string(),
  })).optional(),
});

const saveAsTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  category: z.string().min(1).max(100),
  tags: z.array(z.string()).optional(),
  scope: z.nativeEnum(TemplateScope).optional(),
  includeAssignments: z.boolean(),
});

const copyTaskSchema = z.object({
  targetProjectId: z.string(),
  includeSegments: z.boolean().default(true),
  includeAssignments: z.boolean().default(false),
  dateOffsetDays: z.number().int().default(0),
});

const copyMilestoneSchema = z.object({
  targetProjectId: z.string(),
  includeTasks: z.boolean().default(true),
  includeSegments: z.boolean().default(true),
  dateOffsetDays: z.number().int().default(0),
});

export async function templateRoutes(fastify: FastifyInstance) {
  const service: TemplateService = fastify.templateService;

  // ─── Template CRUD ────────────────────────────────────────────────────────

  // GET /api/v1/templates
  fastify.get("/templates", async (req, reply) => {
    const q = req.query as any;
    const filter: any = {};
    if (q.category) filter.category = q.category;
    if (q.scope) filter.scope = q.scope;
    if (q.search) filter.search = q.search;
    if (q.isRecommended === "true") filter.isRecommended = true;
    else if (q.isRecommended === "false") filter.isRecommended = false;
    return reply.send(await service.listTemplates(filter));
  });

  // GET /api/v1/templates/:templateId
  fastify.get("/templates/:templateId", async (req, reply) => {
    const { templateId } = req.params as { templateId: string };
    return reply.send(await service.getTemplate(templateId));
  });

  // POST /api/v1/templates
  fastify.post("/templates", {
    preHandler: requireRole("ADMIN", "MANAGER"),
  }, async (req, reply) => {
    const dto = createTemplateSchema.parse(req.body);
    const template = await service.createTemplate(dto as any, req.userId);
    return reply.status(201).send(template);
  });

  // PATCH /api/v1/templates/:templateId
  fastify.patch("/templates/:templateId", {
    preHandler: requireRole("ADMIN", "MANAGER"),
  }, async (req, reply) => {
    const { templateId } = req.params as { templateId: string };
    const dto = updateTemplateSchema.parse(req.body);
    return reply.send(await service.updateTemplate(templateId, dto as any));
  });

  // DELETE /api/v1/templates/:templateId
  fastify.delete("/templates/:templateId", {
    preHandler: requireRole("ADMIN", "MANAGER"),
  }, async (req, reply) => {
    const { templateId } = req.params as { templateId: string };
    await service.deleteTemplate(templateId);
    return reply.status(204).send();
  });

  // ─── 미리보기 + 인스턴스화 ────────────────────────────────────────────────

  // POST /api/v1/templates/:templateId/preview
  fastify.post("/templates/:templateId/preview", async (req, reply) => {
    const { templateId } = req.params as { templateId: string };
    const { startDate, taskIds } = previewSchema.parse(req.body);
    return reply.send(await service.preview(templateId, startDate, taskIds));
  });

  // POST /api/v1/templates/:templateId/instantiate
  fastify.post("/templates/:templateId/instantiate", {
    preHandler: requireRole("ADMIN", "MANAGER"),
  }, async (req, reply) => {
    const { templateId } = req.params as { templateId: string };
    const dto = instantiateSchema.parse(req.body);
    const project = await service.instantiate(templateId, dto as any, req.userId);
    return reply.status(201).send(project);
  });

  // ─── save-as-template ─────────────────────────────────────────────────────

  // POST /api/v1/projects/:projectId/save-as-template
  fastify.post("/projects/:projectId/save-as-template", {
    preHandler: requireRole("ADMIN", "MANAGER"),
  }, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const dto = saveAsTemplateSchema.parse(req.body);
    const template = await service.saveAsTemplate(projectId, dto as any, req.userId);
    return reply.status(201).send(template);
  });

  // ─── 복사 ─────────────────────────────────────────────────────────────────

  // POST /api/v1/projects/:projectId/tasks/:taskId/copy
  fastify.post("/projects/:projectId/tasks/:taskId/copy", {
    preHandler: requireRole("ADMIN", "MANAGER"),
  }, async (req, reply) => {
    const { taskId } = req.params as { projectId: string; taskId: string };
    const dto = copyTaskSchema.parse(req.body);
    const task = await service.copyTask(taskId, dto.targetProjectId, dto as any, req.userId);
    return reply.status(201).send(task);
  });

  // POST /api/v1/projects/:projectId/milestones/:milestoneId/copy
  fastify.post("/projects/:projectId/milestones/:milestoneId/copy", {
    preHandler: requireRole("ADMIN", "MANAGER"),
  }, async (req, reply) => {
    const { milestoneId } = req.params as { projectId: string; milestoneId: string };
    const dto = copyMilestoneSchema.parse(req.body);
    const ms = await service.copyMilestone(milestoneId, dto.targetProjectId, dto as any, req.userId);
    return reply.status(201).send(ms);
  });
}
