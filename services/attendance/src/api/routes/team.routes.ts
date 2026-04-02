import { FastifyInstance } from "fastify";
import { requireRole } from "../middleware/auth.middleware.js";

export async function teamRoutes(fastify: FastifyInstance) {
  const attendanceSvc = fastify.attendanceService;

  // GET /api/v1/team/attendance — 팀원 월간 근태 요약 (Manager)
  fastify.get("/attendance", {
    preHandler: requireRole("ADMIN", "MANAGER"),
  }, async (req, reply) => {
    const q = req.query as { year?: string; month?: string };
    const now = new Date();
    const year = parseInt(q.year ?? String(now.getFullYear()));
    const month = parseInt(q.month ?? String(now.getMonth() + 1));

    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0);

    // MANAGER는 자신의 부하직원만, ADMIN은 전체 조회
    let subordinateIds: string[] | null = null;
    if (req.userRole === "MANAGER") {
      subordinateIds = await fastify.authClient.getSubordinates(req.userId);
    }

    // 해당 기간 근태 레코드 집계 (Manager는 부하직원만)
    const records = await fastify.prisma.attendanceRecord.findMany({
      where: {
        date: { gte: start, lte: end },
        ...(subordinateIds ? { userId: { in: subordinateIds } } : {}),
      },
      orderBy: { date: "asc" },
    });

    const userMap = new Map<string, {
      userId: string; presentDays: number; absentDays: number;
      lateDays: number; totalNetWorkHours: number;
    }>();

    for (const r of records) {
      if (!userMap.has(r.userId)) {
        userMap.set(r.userId, { userId: r.userId, presentDays: 0, absentDays: 0, lateDays: 0, totalNetWorkHours: 0 });
      }
      const u = userMap.get(r.userId)!;
      if (r.status === "NORMAL" || r.status === "LATE") u.presentDays++;
      if (r.status === "ABSENT") u.absentDays++;
      if (r.isLate) u.lateDays++;
      u.totalNetWorkHours += r.netWorkMinutes / 60;
    }

    // 해당 기간 휴가 사용일 집계
    const leaveRecords = await fastify.prisma.attendanceRecord.findMany({
      where: {
        date: { gte: start, lte: end },
        status: "LEAVE",
        ...(subordinateIds ? { userId: { in: subordinateIds } } : {}),
      },
    });
    const leaveMap = new Map<string, number>();
    for (const r of leaveRecords) {
      leaveMap.set(r.userId, (leaveMap.get(r.userId) ?? 0) + 1);
    }

    // auth-service에서 실제 이름 조회
    const userIds = Array.from(userMap.keys());
    const userInfoMap = await fastify.authClient.bulkGetUsers(userIds);

    const members = Array.from(userMap.values()).map((u) => ({
      userId: u.userId,
      name: userInfoMap[u.userId]?.name ?? u.userId,
      normalCount: u.presentDays,
      lateCount: u.lateDays,
      absentCount: u.absentDays,
      leaveCount: leaveMap.get(u.userId) ?? 0,
      totalWorkMinutes: Math.round(u.totalNetWorkHours * 60),
      totalOtHours: 0,
    }));

    return reply.send(members);
  });

  // GET /api/v1/team/members/:userId/calendar — 특정 팀원 달력 (Manager)
  fastify.get("/members/:userId/calendar", {
    preHandler: requireRole("ADMIN", "MANAGER"),
  }, async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const q = req.query as { year?: string; month?: string };
    const now = new Date();
    const year = parseInt(q.year ?? String(now.getFullYear()));
    const month = parseInt(q.month ?? String(now.getMonth() + 1));
    return reply.send(await attendanceSvc.getCalendar(userId, year, month));
  });
}
