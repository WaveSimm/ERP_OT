import { FastifyInstance } from "fastify";
import { z } from "zod";
import { ImpactService } from "../../application/impact.service.js";
import { requireManager } from "../middleware/auth.middleware.js";

const whatifSchema = z.object({
  taskId: z.string(),
  delayDays: z.number().int().min(1),
});

export async function impactRoutes(fastify: FastifyInstance) {
  const service: ImpactService = fastify.impactService;

  // GET /api/v1/projects/:projectId/impact — 현재 상태 분석 (실제 지연 태스크 자동 탐지)
  fastify.get<{ Params: { projectId: string } }>("/:projectId/impact", async (req, reply) => {
    const { projectId } = req.params;
    const result = await service.analyzeCurrentState(projectId);
    return reply.send(result);
  });

  // POST /api/v1/projects/:projectId/whatif
  fastify.post("/:projectId/whatif", { preHandler: requireManager() }, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const { taskId, delayDays } = whatifSchema.parse(req.body);

    const result = await service.analyzeImpact(projectId, taskId, delayDays, true);
    return reply.send(result);
  });
}
