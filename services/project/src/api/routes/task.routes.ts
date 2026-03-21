import { FastifyInstance } from "fastify";
import { z } from "zod";
import { TaskService } from "../../application/task.service.js";
import { CpmService } from "../../application/cpm.service.js";
import { requireRole } from "../middleware/auth.middleware.js";
import { TaskStatus, DependencyType, AllocationMode } from "@prisma/client";

const createTaskSchema = z.object({
  milestoneId: z.string().optional(),
  parentId: z.string().optional(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  sortOrder: z.number().int().optional(),
  isMilestone: z.boolean().optional(),
});

const updateTaskSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional().nullable(),
  status: z.nativeEnum(TaskStatus).optional(),
  milestoneId: z.string().optional().nullable(),
  parentId: z.string().optional().nullable(),
  sortOrder: z.number().int().optional(),
  overallProgress: z.number().min(0).max(100).optional(),
  isManualProgress: z.boolean().optional(),
  isMilestone: z.boolean().optional(),
});

const createSegmentSchema = z.object({
  name: z.string().min(1).max(200),
  startDate: z.string(), // YYYY-MM-DD
  endDate: z.string(),
  sortOrder: z.number().int().optional(),
});

const updateSegmentSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  progressPercent: z.number().min(0).max(100).optional(),
  sortOrder: z.number().int().optional(),
  changeReason: z.string().min(1),
});

const upsertAssignmentSchema = z.object({
  resourceId: z.string(),
  allocationMode: z.nativeEnum(AllocationMode),
  allocationPercent: z.number().min(0).max(200).optional(),
  allocationHoursPerDay: z.number().min(0).optional(),
});

const addDependencySchema = z.object({
  predecessorId: z.string(),
  type: z.nativeEnum(DependencyType).default("FS"),
  lagDays: z.number().int().default(0),
});

export async function taskRoutes(fastify: FastifyInstance) {
  const taskService: TaskService = fastify.taskService;
  const cpmService: CpmService = fastify.cpmService;

  // GET /api/v1/projects/:projectId/tasks
  fastify.get("/", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const tasks = await taskService.getProjectTasks(projectId);
    return reply.send(tasks);
  });

  // POST /api/v1/projects/:projectId/tasks
  fastify.post("/", {
    preHandler: requireRole("ADMIN", "MANAGER", "OPERATOR"),
  }, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const dto = createTaskSchema.parse(req.body);
    const task = await taskService.createTask(projectId, dto as any, req.userId);
    return reply.status(201).send(task);
  });

  // GET /api/v1/projects/:projectId/tasks/:taskId
  fastify.get("/:taskId", async (req, reply) => {
    const { taskId } = req.params as { projectId: string; taskId: string };
    const task = await fastify.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        segments: {
          include: { assignments: true },
          orderBy: { sortOrder: "asc" },
        },
        predecessorDeps: true,
        successorDeps: true,
      },
    });
    if (!task) {
      return reply.status(404).send({ code: "TASK_NOT_FOUND", message: "태스크를 찾을 수 없습니다." });
    }
    return reply.send(task);
  });

  // PATCH /api/v1/projects/:projectId/tasks/:taskId
  fastify.patch("/:taskId", {
    preHandler: requireRole("ADMIN", "MANAGER", "OPERATOR"),
  }, async (req, reply) => {
    const { taskId } = req.params as { projectId: string; taskId: string };
    const dto = updateTaskSchema.parse(req.body);
    const task = await taskService.updateTask(taskId, dto as any, req.userId);
    return reply.send(task);
  });

  // DELETE /api/v1/projects/:projectId/tasks/:taskId
  fastify.delete("/:taskId", {
    preHandler: requireRole("ADMIN", "MANAGER"),
  }, async (req, reply) => {
    const { taskId } = req.params as { projectId: string; taskId: string };
    await taskService.deleteTask(taskId, req.userId);
    return reply.status(204).send();
  });

  // ─── Segments ─────────────────────────────────────────────────────────────

  // POST /api/v1/projects/:projectId/tasks/:taskId/segments
  fastify.post("/:taskId/segments", {
    preHandler: requireRole("ADMIN", "MANAGER", "OPERATOR"),
  }, async (req, reply) => {
    const { taskId } = req.params as { projectId: string; taskId: string };
    const dto = createSegmentSchema.parse(req.body);
    const segment = await taskService.createSegment(taskId, dto as any, req.userId);
    return reply.status(201).send(segment);
  });

  // PATCH /api/v1/projects/:projectId/tasks/:taskId/segments/:segmentId
  fastify.patch("/:taskId/segments/:segmentId", {
    preHandler: requireRole("ADMIN", "MANAGER", "OPERATOR"),
  }, async (req, reply) => {
    const { segmentId } = req.params as { projectId: string; taskId: string; segmentId: string };
    const dto = updateSegmentSchema.parse(req.body);
    const segment = await taskService.updateSegment(segmentId, dto as any, req.userId);
    return reply.send(segment);
  });

  // DELETE /api/v1/projects/:projectId/tasks/:taskId/segments/:segmentId
  fastify.delete("/:taskId/segments/:segmentId", {
    preHandler: requireRole("ADMIN", "MANAGER"),
  }, async (req, reply) => {
    const { segmentId } = req.params as any;
    await taskService.deleteSegment(segmentId, req.userId);
    return reply.status(204).send();
  });

  // PATCH /api/v1/projects/:projectId/tasks/:taskId/segments/reorder
  fastify.patch("/:taskId/segments/reorder", {
    preHandler: requireRole("ADMIN", "MANAGER", "OPERATOR"),
  }, async (req, reply) => {
    const { taskId } = req.params as { projectId: string; taskId: string };
    const body = req.body as { orderedIds: string[] };
    const orderedIds = z.array(z.string()).min(1).parse(body.orderedIds);

    // 트랜잭션으로 세그먼트 sortOrder 일괄 업데이트
    await fastify.prisma.$transaction(
      orderedIds.map((id, index) =>
        fastify.prisma.taskSegment.update({
          where: { id },
          data: { sortOrder: index },
        })
      )
    );

    const segments = await fastify.prisma.taskSegment.findMany({
      where: { taskId },
      orderBy: { sortOrder: "asc" },
    });
    return reply.send(segments);
  });

  // ─── Assignments ──────────────────────────────────────────────────────────

  // GET /api/v1/projects/:projectId/tasks/:taskId/segments/:segmentId/assignments
  fastify.get("/:taskId/segments/:segmentId/assignments", async (req, reply) => {
    const { segmentId } = req.params as any;
    const assignments = await fastify.prisma.segmentAssignment.findMany({
      where: { segmentId },
    });
    // Enrich with resource info
    const resourceIds = assignments.map((a) => a.resourceId);
    const resources = await fastify.prisma.resource.findMany({
      where: { id: { in: resourceIds } },
    });
    const rMap = new Map(resources.map((r) => [r.id, r]));
    const result = assignments.map((a) => ({
      ...a,
      resourceName: rMap.get(a.resourceId)?.name ?? a.resourceId,
      resourceType: rMap.get(a.resourceId)?.type ?? "PERSON",
    }));
    return reply.send(result);
  });

  // PUT /api/v1/projects/:projectId/tasks/:taskId/segments/:segmentId/assignments
  fastify.put("/:taskId/segments/:segmentId/assignments", async (req, reply) => {
    const { segmentId } = req.params as any;
    const dto = upsertAssignmentSchema.parse(req.body);

    // OPERATOR는 본인 resource의 배당율만 수정 가능
    if (!["ADMIN", "MANAGER"].includes(req.userRole)) {
      const ownResource = await fastify.prisma.resource.findFirst({
        where: { userId: req.userEmail },
      });
      if (!ownResource || ownResource.id !== dto.resourceId) {
        return reply.status(403).send({ code: "FORBIDDEN", message: "본인 배당율만 수정할 수 있습니다." });
      }
    }

    const assignment = await taskService.upsertAssignment(segmentId, dto as any, req.userId);
    return reply.send(assignment);
  });

  // DELETE /api/v1/.../assignments/:resourceId
  fastify.delete("/:taskId/segments/:segmentId/assignments/:resourceId", {
    preHandler: requireRole("ADMIN", "MANAGER"),
  }, async (req, reply) => {
    const { segmentId, resourceId } = req.params as any;
    await taskService.removeAssignment(segmentId, resourceId, req.userId);
    return reply.status(204).send();
  });

  // ─── Dependencies ─────────────────────────────────────────────────────────

  // GET /api/v1/projects/:projectId/tasks/:taskId/dependencies
  fastify.get("/:taskId/dependencies", async (req, reply) => {
    const { projectId, taskId } = req.params as { projectId: string; taskId: string };
    const [predecessors, successors] = await Promise.all([
      fastify.prisma.taskDependency.findMany({
        where: { successorId: taskId },
        include: { predecessor: { select: { id: true, name: true, status: true } } },
      }),
      fastify.prisma.taskDependency.findMany({
        where: { predecessorId: taskId },
        include: { successor: { select: { id: true, name: true, status: true } } },
      }),
    ]);
    // All other tasks in the project for the picker
    const allTasks = await fastify.prisma.task.findMany({
      where: { projectId, id: { not: taskId } },
      select: { id: true, name: true, status: true },
      orderBy: { sortOrder: "asc" },
    });
    return reply.send({ predecessors, successors, allTasks });
  });

  // POST /api/v1/projects/:projectId/tasks/:taskId/dependencies
  fastify.post("/:taskId/dependencies", {
    preHandler: requireRole("ADMIN", "MANAGER"),
  }, async (req, reply) => {
    const { projectId, taskId } = req.params as { projectId: string; taskId: string };
    const dto = addDependencySchema.parse(req.body);
    await cpmService.addDependency(dto.predecessorId, taskId, dto.type, dto.lagDays, projectId);
    return reply.status(201).send({ ok: true });
  });

  // DELETE /api/v1/projects/:projectId/tasks/:taskId/dependencies/:predecessorId
  fastify.delete("/:taskId/dependencies/:predecessorId", {
    preHandler: requireRole("ADMIN", "MANAGER"),
  }, async (req, reply) => {
    const { taskId, predecessorId } = req.params as any;
    await fastify.prisma.taskDependency.delete({
      where: { predecessorId_successorId: { predecessorId, successorId: taskId } },
    });
    return reply.status(204).send();
  });

  // POST /api/v1/projects/:projectId/cpm — CPM 재계산
  // GET /api/v1/projects/:projectId/tasks/:taskId/history
  fastify.get("/:taskId/history", async (req, reply) => {
    const { taskId } = req.params as { taskId: string };
    const history = await taskService.getHistory(taskId);
    return reply.send(history);
  });

  fastify.post("/cpm", {
    preHandler: requireRole("ADMIN", "MANAGER"),
    url: "/cpm", // 이 경로는 prefix 외부에서 별도 등록 필요
  } as any, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const result = await cpmService.runProjectCpm(projectId);
    return reply.send(result);
  });
}
