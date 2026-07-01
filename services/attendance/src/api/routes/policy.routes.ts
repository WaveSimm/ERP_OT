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
    preHandler: requireRole("ADMIN", "MANAGER"),
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

  // GET /api/v1/policy/work-schedule/me — 본인 유효 근무시간(개인 설정 우선, 없으면 회사 기본).
  //   정적 경로라 아래 :userId 파라미터 라우트보다 우선 매칭됨. 본인 조회이므로 role 제한 없음.
  fastify.get("/work-schedule/me", async (req, reply) => {
    const userId = req.userId;
    const personal = userId
      ? await fastify.prisma.userWorkSchedule.findUnique({ where: { userId } })
      : null;
    if (personal) {
      return reply.send({
        workStartTime: personal.workStartTime,
        workEndTime: personal.workEndTime,
        dailyWorkHours: personal.dailyWorkHours,
        source: "personal",
      });
    }
    const policy = (await svc.getPolicy()) as { workStartTime?: string; workEndTime?: string; dailyWorkHours?: number } | null;
    return reply.send({
      workStartTime: policy?.workStartTime ?? "09:30",
      workEndTime: policy?.workEndTime ?? "18:30",
      dailyWorkHours: policy?.dailyWorkHours ?? 8,
      source: "company",
    });
  });

  // GET /api/v1/policy/work-schedule/:userId  (ADMIN)
  fastify.get("/work-schedule/:userId", {
    preHandler: requireRole("ADMIN", "MANAGER"),
  }, async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const schedule = await fastify.prisma.userWorkSchedule.findUnique({ where: { userId } });
    return reply.send(schedule ?? null);
  });

  // PUT /api/v1/policy/work-schedule/:userId  (ADMIN)
  fastify.put("/work-schedule/:userId", {
    preHandler: requireRole("ADMIN", "MANAGER"),
  }, async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const body = z.object({
      workStartTime: z.string().regex(/^\d{2}:\d{2}$/),
      workEndTime:   z.string().regex(/^\d{2}:\d{2}$/),
      dailyWorkHours: z.number().default(8),
    }).parse(req.body);
    const schedule = await fastify.prisma.userWorkSchedule.upsert({
      where:  { userId },
      create: { userId, ...body, updatedBy: req.userId },
      update: { ...body, updatedBy: req.userId },
    });
    return reply.send(schedule);
  });

  // DELETE /api/v1/policy/work-schedule/:userId  (ADMIN) — 개인 설정 제거 → 기본값 복원
  fastify.delete("/work-schedule/:userId", {
    preHandler: requireRole("ADMIN", "MANAGER"),
  }, async (req, reply) => {
    const { userId } = req.params as { userId: string };
    await fastify.prisma.userWorkSchedule.deleteMany({ where: { userId } });
    return reply.status(204).send();
  });

  // GET /api/v1/policy/work-schedules  (ADMIN) — 전체 목록
  fastify.get("/work-schedules", {
    preHandler: requireRole("ADMIN", "MANAGER"),
  }, async (_req, reply) => {
    return reply.send(await fastify.prisma.userWorkSchedule.findMany());
  });

  // GET /api/v1/holidays
  fastify.get("/holidays", async (req, reply) => {
    const q = req.query as { year?: string };
    const year = parseInt(q.year ?? String(new Date().getFullYear()));
    return reply.send(await svc.getHolidays(year));
  });

  // POST /api/v1/holidays
  fastify.post("/holidays", {
    preHandler: requireRole("ADMIN", "MANAGER"),
  }, async (req, reply) => {
    const body = z.object({ date: z.string(), name: z.string().min(1) }).parse(req.body);
    return reply.status(201).send(await svc.createHoliday(body.date, body.name));
  });

  // DELETE /api/v1/holidays/:id
  fastify.delete("/holidays/:id", {
    preHandler: requireRole("ADMIN", "MANAGER"),
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await svc.deleteHoliday(id);
    return reply.status(204).send();
  });
}
