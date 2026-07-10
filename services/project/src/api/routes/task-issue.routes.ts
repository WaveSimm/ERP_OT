import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { TaskIssueError } from "../../application/task-issue.service.js";
import { createTaskIssueSchema, updateTaskIssueSchema } from "../dtos/task-issue.dto.js";

function handleError(reply: FastifyReply, err: unknown) {
  if (err instanceof TaskIssueError) {
    return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
  }
  if (err instanceof ZodError) {
    return reply.code(400).send({
      error: { code: "INVALID_INPUT", message: err.issues?.[0]?.message ?? "입력 오류" },
    });
  }
  throw err;
}

function buildUser(req: FastifyRequest) {
  return {
    id: req.userId,
    email: req.userEmail,
    role: req.userRole,
    name: req.userName ?? "",
  };
}

export async function taskIssueRoutes(fastify: FastifyInstance) {
  const svc = fastify.taskIssueService;

  // GET /api/v1/tasks/:taskId/issues
  fastify.get("/:taskId/issues", async (req, reply) => {
    try {
      const { taskId } = req.params as { taskId: string };
      const items = await svc.listByTask(taskId, buildUser(req));
      return reply.send(items);
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // POST /api/v1/tasks/:taskId/issues
  fastify.post("/:taskId/issues", async (req, reply) => {
    try {
      const { taskId } = req.params as { taskId: string };
      const dto = createTaskIssueSchema.parse(req.body);
      const created = await svc.create(taskId, dto, buildUser(req));
      return reply.code(201).send(created);
    } catch (err) {
      return handleError(reply, err);
    }
  });
}

export async function taskIssueItemRoutes(fastify: FastifyInstance) {
  const svc = fastify.taskIssueService;

  // PATCH /api/v1/task-issues/:id  (내용 수정 또는 해결/미해결 토글)
  fastify.patch("/:id", async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const dto = updateTaskIssueSchema.parse(req.body);
      const updated = await svc.update(id, dto, buildUser(req));
      return reply.send(updated);
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // DELETE /api/v1/task-issues/:id
  fastify.delete("/:id", async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      await svc.remove(id, buildUser(req));
      return reply.code(204).send();
    } catch (err) {
      return handleError(reply, err);
    }
  });
}
