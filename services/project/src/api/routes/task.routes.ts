import { FastifyInstance } from "fastify";
import { z } from "zod";
import { TaskService } from "../../application/task.service.js";
import { CpmService } from "../../application/cpm.service.js";
import { resolveResourceNames } from "../../application/shared/resource-name-resolver.js";
import { requireRole, requireOperator, requireSelfOrManager } from "../middleware/auth.middleware.js";
import { TaskStatus, DependencyType, AllocationMode } from "@prisma/client";

const createTaskSchema = z.object({
  parentId: z.string().nullable().optional(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  sortOrder: z.number().int().optional(),
  isMilestone: z.boolean().optional(),
});

const updateTaskSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional().nullable(),
  status: z.nativeEnum(TaskStatus).optional(),
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
  changeReason: z.string().min(1).optional(),
});

const upsertAssignmentSchema = z.object({
  resourceId: z.string(),
  allocationMode: z.nativeEnum(AllocationMode),
  allocationPercent: z.number().min(0).max(200).optional(),
  allocationHoursPerDay: z.number().min(0).optional(),
  contributionWeight: z.number().min(0).max(100).optional(), // 자원-기여도-진척률: 분담율
});

const updateAssignmentProgressSchema = z.object({
  progressPercent: z.number().min(0).max(100),
  changeReason: z.string().min(1).optional(),
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
  // OPERATOR 이상 허용 (OPERATOR는 본인이 포함된 태스크 생성)
  fastify.post("/", {
    preHandler: requireOperator(),
  }, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const dto = createTaskSchema.parse(req.body);
    const task = await taskService.createTask(projectId, dto, req.userId);
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
        predecessorOf: true,
        successorOf: true,
      },
    });
    if (!task) {
      return reply.status(404).send({ code: "TASK_NOT_FOUND", message: "태스크를 찾을 수 없습니다." });
    }
    return reply.send(task);
  });

  // PATCH /api/v1/projects/:projectId/tasks/:taskId
  // OPERATOR 이상: 모든 태스크 수정 가능 (본인/배정 여부 무관, VIEWER만 차단)
  fastify.patch("/:taskId", {
    preHandler: requireOperator(),
  }, async (req, reply) => {
    const { taskId } = req.params as { projectId: string; taskId: string };
    const dto = updateTaskSchema.parse(req.body);
    const task = await taskService.updateTask(taskId, dto, req.userId);
    return reply.send(task);
  });

  // DELETE /api/v1/projects/:projectId/tasks/:taskId
  // 태스크 삭제: OPERATOR 이상 허용 (VIEWER 제외). 복사/세그먼트 등 다른 삭제는 여전히 MANAGER 이상.
  fastify.delete("/:taskId", {
    preHandler: requireOperator(),
  }, async (req, reply) => {
    const { taskId } = req.params as { projectId: string; taskId: string };
    await taskService.deleteTask(taskId, req.userId);
    return reply.status(204).send();
  });

  // ─── Segments ─────────────────────────────────────────────────────────────

  // POST /api/v1/projects/:projectId/tasks/:taskId/segments
  // OPERATOR 이상: 본인이 생성했거나 배정된 태스크에 세그먼트 추가 가능
  fastify.post("/:taskId/segments", {
    preHandler: requireOperator(),
  }, async (req, reply) => {
    const { taskId } = req.params as { projectId: string; taskId: string };

    const dto = createSegmentSchema.parse(req.body);
    const segment = await taskService.createSegment(taskId, dto, req.userId);
    return reply.status(201).send(segment);
  });

  // PATCH /api/v1/projects/:projectId/tasks/:taskId/segments/:segmentId
  // OPERATOR 이상: 본인이 생성했거나 배정된 태스크의 세그먼트 수정 가능
  fastify.patch("/:taskId/segments/:segmentId", {
    preHandler: requireOperator(),
  }, async (req, reply) => {
    const { segmentId } = req.params as { projectId: string; taskId: string; segmentId: string };
    const dto = updateSegmentSchema.parse(req.body);
    const segment = await taskService.updateSegment(segmentId, dto, req.userId);
    return reply.send(segment);
  });

  // DELETE /api/v1/projects/:projectId/tasks/:taskId/segments/:segmentId
  // OPERATOR 이상: 모든 태스크의 세그먼트 삭제 가능 (VIEWER만 차단)
  fastify.delete("/:taskId/segments/:segmentId", {
    preHandler: requireOperator(),
  }, async (req, reply) => {
    const { segmentId } = req.params as { projectId: string; taskId: string; segmentId: string };
    await taskService.deleteSegment(segmentId, req.userId);
    return reply.status(204).send();
  });

  // PATCH /api/v1/projects/:projectId/tasks/:taskId/segments/reorder
  // OPERATOR 이상: 모든 태스크의 세그먼트 순서변경 가능 (VIEWER만 차단)
  fastify.patch("/:taskId/segments/reorder", {
    preHandler: requireOperator(),
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
    const { segmentId } = req.params as { projectId: string; taskId: string; segmentId: string };
    const assignments = await fastify.prisma.segmentAssignment.findMany({
      where: { segmentId },
    });
    // Enrich with resource info — Phase 5 polymorphic resolver
    const resourceIds = assignments.map((a) => a.resourceId);
    const rMap = await resolveResourceNames(fastify.prisma, resourceIds);
    const result = assignments.map((a) => {
      // polymorphic FK 기반 타입 결정
      const type = a.personUserId ? "PERSON" : a.externalPersonId ? "EXTERNAL" : a.equipmentResourceId ? "EQUIPMENT" : "PERSON";
      return {
        ...a,
        resourceName: rMap.get(a.resourceId) ?? a.resourceId,
        resourceType: type,
      };
    });
    return reply.send(result);
  });

  // PUT /api/v1/projects/:projectId/tasks/:taskId/segments/:segmentId/assignments
  fastify.put("/:taskId/segments/:segmentId/assignments", async (req, reply) => {
    const { segmentId } = req.params as { projectId: string; taskId: string; segmentId: string };
    const dto = upsertAssignmentSchema.parse(req.body);

    // OPERATOR 이상: 모든 태스크에 자원 배정 가능 (VIEWER만 차단)
    if (req.userRole === "VIEWER") {
      return reply.status(403).send({ code: "FORBIDDEN", message: "권한이 없습니다." });
    }

    const assignment = await taskService.upsertAssignment(segmentId, dto, req.userId);
    return reply.send(assignment);
  });

  // DELETE /api/v1/.../assignments/:resourceId
  fastify.delete("/:taskId/segments/:segmentId/assignments/:resourceId", async (req, reply) => {
    const { segmentId, resourceId } = req.params as { projectId: string; taskId: string; segmentId: string; resourceId: string };

    // OPERATOR 이상: 모든 태스크의 자원 제거 가능 (VIEWER만 차단)
    if (req.userRole === "VIEWER") {
      return reply.status(403).send({ code: "FORBIDDEN", message: "권한이 없습니다." });
    }

    await taskService.removeAssignment(segmentId, resourceId, req.userId);
    return reply.status(204).send();
  });

  // PATCH /api/v1/.../assignments/:resourceId/progress — 자원 본인 진척률 갱신 (자원-기여도-진척률)
  //   권한: 본인(personUserId == 요청자) 또는 ADMIN/MANAGER. 외부인력/장비는 관리자만.
  fastify.patch("/:taskId/segments/:segmentId/assignments/:resourceId/progress", async (req, reply) => {
    const { taskId, segmentId, resourceId } = req.params as { projectId: string; taskId: string; segmentId: string; resourceId: string };
    const dto = updateAssignmentProgressSchema.parse(req.body);

    // VIEWER는 항상 차단
    if (req.userRole === "VIEWER") {
      return reply.status(403).send({ code: "FORBIDDEN", message: "권한이 없습니다." });
    }

    // ADMIN/MANAGER 또는 본인 배정이면 항상 수정 가능.
    // 그 외(남의 진척률)는, 그 배정 자원 본인이 작업일지를 1건 이상 적었으면 OPERATOR 이상 누구나 수정 가능.
    const isAdminOrManager = ["ADMIN", "MANAGER"].includes(req.userRole);
    if (!isAdminOrManager) {
      const assignment = await fastify.prisma.segmentAssignment.findUnique({
        where: { segmentId_resourceId: { segmentId, resourceId } },
        select: { personUserId: true },
      });
      const isSelf = !!assignment && assignment.personUserId === req.userId;
      if (!isSelf) {
        const hasResourceWorkLog = assignment?.personUserId
          ? await fastify.prisma.workLog.findFirst({
              where: { taskId, authorId: assignment.personUserId, isDeleted: false },
              select: { id: true },
            })
          : null;
        if (!hasResourceWorkLog) {
          return reply.status(403).send({
            code: "FORBIDDEN",
            message: "본인의 진척률만 수정할 수 있습니다. (해당 자원 본인이 작업일지를 적었으면 누구나 수정 가능)",
          });
        }
      }
    }

    const updated = await taskService.updateAssignmentProgress(segmentId, resourceId, dto.progressPercent, req.userId, dto.changeReason);
    return reply.send(updated);
  });

  // ─── Dependencies ─────────────────────────────────────────────────────────

  // GET /api/v1/projects/:projectId/tasks/:taskId/dependencies — Task↔Task 만 (legacy)
  fastify.get("/:taskId/dependencies", async (req, reply) => {
    const { projectId, taskId } = req.params as { projectId: string; taskId: string };
    const [predecessors, successors] = await Promise.all([
      fastify.prisma.dependency.findMany({
        where: { successorTaskId: taskId },
        include: { predecessorTask: { select: { id: true, name: true, status: true } } },
      }),
      fastify.prisma.dependency.findMany({
        where: { predecessorTaskId: taskId },
        include: { successorTask: { select: { id: true, name: true, status: true } } },
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

  // POST /api/v1/projects/:projectId/tasks/:taskId/dependencies (Task↔Task 만)
  fastify.post("/:taskId/dependencies", {
    preHandler: requireRole("ADMIN", "MANAGER", "OPERATOR"),
  }, async (req, reply) => {
    const { projectId, taskId } = req.params as { projectId: string; taskId: string };
    const dto = addDependencySchema.parse(req.body);
    await cpmService.addDependency(dto.predecessorId, taskId, dto.type, dto.lagDays, projectId);
    return reply.status(201).send({ ok: true });
  });

  // DELETE /api/v1/projects/:projectId/tasks/:taskId/dependencies/:predecessorId
  fastify.delete("/:taskId/dependencies/:predecessorId", {
    preHandler: requireRole("ADMIN", "MANAGER", "OPERATOR"),
  }, async (req, reply) => {
    const { taskId, predecessorId } = req.params as { projectId: string; taskId: string; predecessorId: string };
    await fastify.prisma.dependency.deleteMany({
      where: { predecessorTaskId: predecessorId, successorTaskId: taskId },
    });
    return reply.status(204).send();
  });

  // POST /api/v1/projects/:projectId/cpm — CPM 재계산
  fastify.post("/cpm", {
    preHandler: requireRole("ADMIN", "MANAGER", "OPERATOR"),
  }, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const result = await cpmService.runProjectCpm(projectId);
    return reply.send(result);
  });
}
