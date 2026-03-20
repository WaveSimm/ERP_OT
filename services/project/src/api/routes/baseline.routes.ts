import { FastifyInstance } from "fastify";
import { z } from "zod";
import { BaselineService } from "../../application/baseline.service.js";
import { requireRole } from "../middleware/auth.middleware.js";

const createBaselineSchema = z.object({
  name: z.string().min(1).max(200),
  reason: z.string().min(1).max(500),
});

export async function baselineRoutes(fastify: FastifyInstance) {
  const service: BaselineService = fastify.baselineService;

  // GET /api/v1/projects/:projectId/baselines
  fastify.get("/:projectId/baselines", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    return reply.send(await service.listBaselines(projectId));
  });

  // POST /api/v1/projects/:projectId/baselines
  fastify.post("/:projectId/baselines", {
    preHandler: requireRole("ADMIN", "MANAGER"),
  }, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const dto = createBaselineSchema.parse(req.body);
    const baseline = await service.createBaseline(projectId, dto, req.userId);
    return reply.status(201).send(baseline);
  });

  // GET /api/v1/projects/:projectId/baselines/:baselineId
  fastify.get("/:projectId/baselines/:baselineId", async (req, reply) => {
    const { baselineId } = req.params as { projectId: string; baselineId: string };
    return reply.send(await service.getBaseline(baselineId));
  });

  // DELETE /api/v1/projects/:projectId/baselines/:baselineId
  fastify.delete("/:projectId/baselines/:baselineId", {
    preHandler: requireRole("ADMIN"),
  }, async (req, reply) => {
    const { baselineId } = req.params as { projectId: string; baselineId: string };
    await service.deleteBaseline(baselineId);
    return reply.status(204).send();
  });

  // GET /api/v1/projects/:projectId/baselines/:baselineId/diff
  fastify.get("/:projectId/baselines/:baselineId/diff", async (req, reply) => {
    const { baselineId } = req.params as { projectId: string; baselineId: string };
    return reply.send(await service.diffBaseline(baselineId));
  });

  // GET /api/v1/projects/:projectId/tasks/:taskId/history
  fastify.get("/:projectId/tasks/:taskId/history", async (req, reply) => {
    const { taskId } = req.params as { projectId: string; taskId: string };
    const query = req.query as any;
    const limit = query.limit ? parseInt(query.limit, 10) : 50;
    return reply.send(await service.getTaskHistory(taskId, limit));
  });
}
