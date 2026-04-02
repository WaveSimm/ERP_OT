import { FastifyInstance } from "fastify";
import { z } from "zod";

export async function attendanceRoutes(fastify: FastifyInstance) {
  const svc = fastify.attendanceService;

  // GET /api/v1/attendance/today
  fastify.get("/today", async (req, reply) => {
    return reply.send(await svc.getToday(req.userId));
  });

  // POST /api/v1/attendance/check-in
  fastify.post("/check-in", async (req, reply) => {
    const body = z.object({
      workType: z.enum(["OFFICE", "REMOTE", "FIELD"]).default("OFFICE"),
      note: z.string().optional(),
    }).parse(req.body);
    return reply.send(await svc.checkIn(req.userId, body.workType, body.note));
  });

  // POST /api/v1/attendance/check-out
  fastify.post("/check-out", async (req, reply) => {
    return reply.send(await svc.checkOut(req.userId));
  });

  // POST /api/v1/attendance/break-out
  fastify.post("/break-out", async (req, reply) => {
    return reply.send(await svc.breakOut(req.userId));
  });

  // POST /api/v1/attendance/break-in
  fastify.post("/break-in", async (req, reply) => {
    return reply.send(await svc.breakIn(req.userId));
  });

  // GET /api/v1/attendance/calendar
  fastify.get("/calendar", async (req, reply) => {
    const q = req.query as { year?: string; month?: string };
    const now = new Date();
    const year = parseInt(q.year ?? String(now.getFullYear()));
    const month = parseInt(q.month ?? String(now.getMonth() + 1));
    return reply.send(await svc.getCalendar(req.userId, year, month));
  });

  // GET /api/v1/attendance/summary
  fastify.get("/summary", async (req, reply) => {
    const q = req.query as { year?: string; month?: string };
    const now = new Date();
    const year = parseInt(q.year ?? String(now.getFullYear()));
    const month = parseInt(q.month ?? String(now.getMonth() + 1));
    const cal = await svc.getCalendar(req.userId, year, month);
    const s = cal.summary;
    return reply.send({
      normalCount: s.presentDays,
      lateCount: s.lateDays,
      absentCount: s.absentDays,
      leaveCount: s.leaveDays,
      totalWorkMinutes: Math.round(s.totalNetWorkHours * 60),
      totalOtHours: s.totalOtHours,
      workDays: s.workDays,
    });
  });
}
