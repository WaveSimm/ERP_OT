import { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireRole } from "../middleware/auth.middleware.js";

export async function policyRoutes(fastify: FastifyInstance) {
  const svc = fastify.policyService;

  // GET /api/v1/policy
  fastify.get("/", async (req, reply) => {
    return reply.send(await svc.getPolicy());
  });

  // PUT /api/v1/policy
  fastify.put("/", {
    preHandler: requireRole("ADMIN"),
  }, async (req, reply) => {
    const raw = z.object({
      workStartTime: z.string().optional(),
      workEndTime: z.string().optional(),
      dailyWorkHours: z.number().optional(),
      lateToleranceMinutes: z.number().int().optional(),
      leavePolicy: z.enum(["HIRE_DATE", "FISCAL_YEAR"]).optional(),
      annualLeaveBase: z.number().int().optional(),
      overtimeRates: z.object({}).passthrough().optional(),
    }).parse(req.body);
    const update: Parameters<typeof svc.updatePolicy>[0] = { updatedBy: req.userId };
    if (raw.workStartTime !== undefined) update.workStartTime = raw.workStartTime;
    if (raw.workEndTime !== undefined) update.workEndTime = raw.workEndTime;
    if (raw.dailyWorkHours !== undefined) update.dailyWorkHours = raw.dailyWorkHours;
    if (raw.lateToleranceMinutes !== undefined) update.lateToleranceMinutes = raw.lateToleranceMinutes;
    if (raw.leavePolicy !== undefined) update.leavePolicy = raw.leavePolicy;
    if (raw.annualLeaveBase !== undefined) update.annualLeaveBase = raw.annualLeaveBase;
    if (raw.overtimeRates !== undefined) update.overtimeRates = raw.overtimeRates;
    return reply.send(await svc.updatePolicy(update));
  });

  // GET /api/v1/holidays
  fastify.get("/holidays", async (req, reply) => {
    const q = req.query as { year?: string };
    const year = parseInt(q.year ?? String(new Date().getFullYear()));
    return reply.send(await svc.getHolidays(year));
  });

  // POST /api/v1/holidays
  fastify.post("/holidays", {
    preHandler: requireRole("ADMIN"),
  }, async (req, reply) => {
    const body = z.object({ date: z.string(), name: z.string().min(1) }).parse(req.body);
    return reply.status(201).send(await svc.createHoliday(body.date, body.name));
  });

  // DELETE /api/v1/holidays/:id
  fastify.delete("/holidays/:id", {
    preHandler: requireRole("ADMIN"),
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await svc.deleteHoliday(id);
    return reply.status(204).send();
  });
}
