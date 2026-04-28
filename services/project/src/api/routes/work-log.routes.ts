import { FastifyInstance } from "fastify";
import { WorkLogError } from "../../application/work-log.service.js";
import {
  createWorkLogSchema,
  updateWorkLogSchema,
  listByTaskQuerySchema,
} from "../dtos/work-log.dto.js";

function handleError(reply: any, err: any) {
  if (err instanceof WorkLogError) {
    return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
  }
  if (err?.name === "ZodError") {
    return reply.code(400).send({
      error: { code: "INVALID_INPUT", message: err.issues?.[0]?.message ?? "입력 오류" },
    });
  }
  throw err;
}

function buildUser(req: any) {
  return {
    id: req.userId,
    email: req.userEmail,
    role: req.userRole,
    name: req.userName ?? "",
  };
}

export async function workLogRoutes(fastify: FastifyInstance) {
  const svc = fastify.workLogService;

  // GET /api/v1/tasks/:taskId/work-logs
  fastify.get("/:taskId/work-logs", async (req, reply) => {
    try {
      const { taskId } = req.params as { taskId: string };
      const q = listByTaskQuerySchema.parse(req.query);
      const items = await svc.listByTask(taskId, q, buildUser(req));
      return reply.send(items);
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // POST /api/v1/tasks/:taskId/work-logs
  fastify.post("/:taskId/work-logs", async (req, reply) => {
    try {
      const { taskId } = req.params as { taskId: string };
      const dto = createWorkLogSchema.parse(req.body);
      const user = buildUser(req);
      const created = await svc.create(taskId, dto, user);
      return reply.code(201).send(created);
    } catch (err) {
      return handleError(reply, err);
    }
  });
}

export async function workLogItemRoutes(fastify: FastifyInstance) {
  const svc = fastify.workLogService;

  // PATCH /api/v1/work-logs/:id
  fastify.patch("/:id", async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const dto = updateWorkLogSchema.parse(req.body);
      const updated = await svc.update(id, dto, buildUser(req));
      return reply.send(updated);
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // DELETE /api/v1/work-logs/:id
  fastify.delete("/:id", async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      await svc.softDelete(id, buildUser(req));
      return reply.code(204).send();
    } catch (err) {
      return handleError(reply, err);
    }
  });
}
