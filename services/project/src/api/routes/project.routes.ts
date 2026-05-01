import { FastifyInstance } from "fastify";
import { z } from "zod";
import { ProjectService } from "../../application/project.service.js";
import { requireRole, requireManager } from "../middleware/auth.middleware.js";
import { ProjectStatus } from "@prisma/client";

const createProjectSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  plannedBudget: z.number().positive().optional(),
  templateId: z.string().optional(),
  templateStartDate: z.string().optional(),
  ownerId: z.string().optional(),
});

const updateProjectSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional().nullable(),
  status: z.nativeEnum(ProjectStatus).optional(),
  plannedBudget: z.number().positive().optional().nullable(),
  actualBudget: z.number().positive().optional().nullable(),
  ownerId: z.string().optional(),
});

const cloneProjectSchema = z.object({
  name: z.string().min(1).max(200),
  dateOffsetDays: z.number().int().default(0),
  includeSegments: z.boolean().default(true),
  includeAssignments: z.boolean().default(true),
  includeDependencies: z.boolean().default(true),
});

export async function projectRoutes(fastify: FastifyInstance) {
  const service: ProjectService = fastify.projectService;

  // GET /api/v1/projects
  fastify.get("/", async (req, reply) => {
    const query = req.query as any;
    const result = await service.listProjects({
      status: query.status,
      groupId: query.groupId,
      ownerId: query.ownerId,
      search: query.search,
      page: query.page ? parseInt(query.page) : 1,
      limit: query.limit ? parseInt(query.limit) : 20,
    });
    return reply.send(result);
  });

  // POST /api/v1/projects
  fastify.post("/", {
    preHandler: requireRole("ADMIN", "MANAGER"),
  }, async (req, reply) => {
    const dto = createProjectSchema.parse(req.body);
    const project = await service.createProject(dto as any, req.userId);
    return reply.status(201).send(project);
  });

  // GET /api/v1/projects/:id
  fastify.get("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = await service.getProject(id);
    return reply.send(project);
  });

  // PATCH /api/v1/projects/:id
  fastify.patch("/:id", {
    preHandler: requireRole("ADMIN", "MANAGER"),
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const dto = updateProjectSchema.parse(req.body);
    const project = await service.updateProject(id, dto as any, req.userId);
    return reply.send(project);
  });

  // DELETE /api/v1/projects/:id
  fastify.delete("/:id", {
    preHandler: requireRole("ADMIN", "MANAGER"),
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await service.deleteProject(id, req.userId);
    return reply.status(204).send();
  });

  // GET /api/v1/projects/:id/gantt
  fastify.get("/:id/gantt", async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send(await service.getGanttData(id));
  });

  // POST /api/v1/projects/:id/clone
  fastify.post("/:id/clone", {
    preHandler: requireRole("ADMIN", "MANAGER"),
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const options = cloneProjectSchema.parse(req.body);
    const project = await service.cloneProject(id, options, req.userId);
    return reply.status(201).send(project);
  });

  // ─── Milestones — milestone.routes.ts로 이동 (재정의된 의미: 시점 이정표) ─

  // GET /api/v1/projects/:projectId/work-logs — 프로젝트 통합 시계열
  fastify.get("/:projectId/work-logs", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const q = req.query as { from?: string; to?: string; authorId?: string; taskId?: string; limit?: string; cursor?: string };
    const params: any = {};
    if (q.from) params.from = q.from;
    if (q.to) params.to = q.to;
    if (q.authorId) params.authorId = q.authorId;
    if (q.taskId) params.taskId = q.taskId;
    if (q.limit) params.limit = parseInt(q.limit, 10);
    if (q.cursor) params.cursor = q.cursor;
    try {
      const result = await fastify.workLogService.listByProject(projectId, params, {
        id: req.userId,
        email: req.userEmail,
        role: req.userRole,
      });
      return reply.send(result);
    } catch (err: any) {
      if (err?.name === "WorkLogError") {
        return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
      }
      throw err;
    }
  });
}
