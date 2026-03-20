import { FastifyInstance } from "fastify";
import { z } from "zod";
import { ImpactService } from "../../application/impact.service.js";

const whatifSchema = z.object({
  taskId: z.string(),
  delayDays: z.number().int().min(1),
});

export async function impactRoutes(fastify: FastifyInstance) {
  const service: ImpactService = fastify.impactService;

  // GET /api/v1/projects/:projectId/impact?taskId=&delayDays=
  fastify.get("/:projectId/impact", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const query = req.query as any;
    const taskId = query.taskId as string;
    const delayDays = parseInt(query.delayDays, 10);

    if (!taskId || isNaN(delayDays)) {
      return reply.status(400).send({
        code: "MISSING_PARAMS",
        message: "taskId와 delayDays 쿼리 파라미터가 필요합니다.",
      });
    }

    const result = await service.analyzeImpact(projectId, taskId, delayDays, false);
    return reply.send(result);
  });

  // POST /api/v1/projects/:projectId/whatif
  fastify.post("/:projectId/whatif", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const { taskId, delayDays } = whatifSchema.parse(req.body);

    const result = await service.analyzeImpact(projectId, taskId, delayDays, true);
    return reply.send(result);
  });
}
