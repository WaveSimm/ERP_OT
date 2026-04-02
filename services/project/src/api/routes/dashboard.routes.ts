import { FastifyInstance } from "fastify";
import { DashboardService } from "../../application/dashboard/dashboard.service.js";
import { requireManager } from "../middleware/auth.middleware.js";

export async function dashboardRoutes(fastify: FastifyInstance) {
  const service = new DashboardService(fastify.prisma, (fastify as any).redis);

  // ─── GET /api/v1/dashboard ─────────────────────────────────────────────────
  fastify.get("/", async (req, reply) => {
    const q = req.query as { groupBy?: string; date?: string; issueFilter?: string };
    const opts: { groupBy?: string; date?: string; issueFilter?: string } = {};
    if (q.groupBy) opts.groupBy = q.groupBy;
    if (q.date) opts.date = q.date;
    if (q.issueFilter) opts.issueFilter = q.issueFilter;
    const result = await service.getDashboard(req.userId, opts);
    return reply.send(result);
  });

  // ─── GET /api/v1/dashboard/summary ────────────────────────────────────────
  fastify.get("/summary", async (req, reply) => {
    const { date } = req.query as { date?: string };
    const d = date ? new Date(date) : new Date();
    const result = await service.getGlobalSummary(d);
    return reply.send(result);
  });

  // ─── GET /api/v1/dashboard/groups/:groupId/rollup ─────────────────────────
  fastify.get("/groups/:groupId/rollup", async (req, reply) => {
    const { groupId } = req.params as { groupId: string };
    const rollup = await service.getGroupRollup(groupId);
    return reply.send(rollup);
  });

  // ─── GET /api/v1/dashboard/projects/:projectId/issues ─────────────────────
  fastify.get("/projects/:projectId/issues", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const issues = await service.getProjectIssues(projectId);
    return reply.send(issues);
  });

  // ─── GET /api/v1/dashboard/projects/:projectId/timeline ───────────────────
  fastify.get("/projects/:projectId/timeline", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const { date } = req.query as { date?: string };
    const d = date ? new Date(date) : new Date();
    const summary = await service.getProjectSummary(projectId, d);
    return reply.send(summary.weeklyTimeline);
  });

  // ─── GET /api/v1/dashboard/config ─────────────────────────────────────────
  fastify.get("/config", async (req, reply) => {
    const config = await service.getUserConfig(req.userId);
    return reply.send(config);
  });

  // ─── PUT /api/v1/dashboard/config ─────────────────────────────────────────
  fastify.put("/config", async (req, reply) => {
    const data = req.body as {
      pinnedProjectIds?: string[];
      issueFilter?: string;
      compactView?: boolean;
    };
    const config = await service.updateUserConfig(req.userId, data);
    return reply.send(config);
  });

  // ─── GET /api/v1/dashboard/thresholds ─────────────────────────────────────
  fastify.get("/thresholds", async (req, reply) => {
    const thresholds = await (service as any).issueDetector.getThresholds();
    return reply.send(thresholds);
  });

  // ─── PUT /api/v1/dashboard/thresholds (Admin/Manager only) ────────────────
  fastify.put("/thresholds", { preHandler: requireManager() }, async (req, reply) => {
    const data = req.body as Record<string, any>;
    const existing = await fastify.prisma.issueThresholdConfig.findFirst();
    const updated = existing
      ? await fastify.prisma.issueThresholdConfig.update({ where: { id: existing.id }, data: { updatedBy: req.userId, ...data } })
      : await fastify.prisma.issueThresholdConfig.create({ data: { updatedBy: req.userId, ...data } });
    await (fastify as any).redis.del("dashboard:config:thresholds");
    return reply.send(updated);
  });

  // ─── POST /api/v1/dashboard/projects/:projectId/refresh ───────────────────
  fastify.post("/projects/:projectId/refresh", { preHandler: requireManager() }, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    await service.invalidateProject(projectId);
    await service.computeProjectSummary(projectId, new Date());
    return reply.send({ refreshed: true, projectId });
  });

  // ─── POST /api/v1/dashboard/refresh-all (Admin/Manager only) ──────────────
  fastify.post("/refresh-all", { preHandler: requireManager() }, async (req, reply) => {
    service.refreshAll().catch(() => {});
    return reply.send({ started: true });
  });
}
