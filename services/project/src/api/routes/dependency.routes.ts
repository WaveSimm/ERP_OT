import { FastifyInstance } from "fastify";
import { z } from "zod";
import { DependencyService } from "../../application/dependency.service.js";
import { requireRole, requireManager } from "../middleware/auth.middleware.js";

const createSchema = z.object({
  predecessorTaskId: z.string(),
  successorTaskId: z.string(),
  dependencyType: z.enum(["FS", "SS", "FF", "SF"]).optional(),
  lag: z.number().int().optional(),
});

/**
 * Task ↔ Task 의존성 라우트.
 * 마운트: /api/v1/projects/:projectId/dependencies, /api/v1/dependencies/:id
 */
export async function dependencyRoutes(fastify: FastifyInstance) {
  const service: DependencyService = fastify.dependencyService;

  // GET /api/v1/projects/:projectId/dependencies
  fastify.get("/projects/:projectId/dependencies", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const list = await service.findByProject(projectId);
    return reply.send(list);
  });

  // POST /api/v1/projects/:projectId/dependencies
  fastify.post("/projects/:projectId/dependencies", {
    preHandler: requireManager(),
  }, async (req, reply) => {
    const dto = createSchema.parse(req.body);
    const dep = await service.create(dto, req.userId);
    return reply.status(201).send(dep);
  });

  // DELETE /api/v1/dependencies/:id
  fastify.delete("/dependencies/:id", {
    preHandler: requireRole("ADMIN", "MANAGER"),
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await service.delete(id, req.userId);
    return reply.status(204).send();
  });
}
