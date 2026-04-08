import { FastifyInstance } from "fastify";

export async function teamRoutes(fastify: FastifyInstance) {
  const attendanceSvc = fastify.attendanceService;

  // GET /api/v1/team/attendance — 팀원 월간 근태 요약 (조직도 직책 기준)
  fastify.get("/attendance", async (req, reply) => {
    const q = req.query as { year?: string; month?: string };
    const now = new Date();
    const year = parseInt(q.year ?? String(now.getFullYear()));
    const month = parseInt(q.month ?? String(now.getMonth() + 1));

    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0);

    // 조직도 직책(팀장/총괄이사/대표이사) 기준으로 관할 부서 멤버 조회
    const teamMembers = await fastify.authClient.getUsersUnder(req.userId);
    if (teamMembers.length === 0) {
      return reply.send([]);
    }

    const memberIds = teamMembers.map((m) => m.id);

    // 해당 기간 근태 레코드 집계
    const records = await fastify.prisma.attendanceRecord.findMany({
      where: {
        date: { gte: start, lte: end },
        userId: { in: memberIds },
      },
      orderBy: { date: "asc" },
    });

    const statsMap = new Map<string, {
      presentDays: number; absentDays: number;
      lateDays: number; totalNetWorkHours: number; leaveDays: number;
    }>();

    for (const r of records) {
      if (!statsMap.has(r.userId)) {
        statsMap.set(r.userId, { presentDays: 0, absentDays: 0, lateDays: 0, totalNetWorkHours: 0, leaveDays: 0 });
      }
      const u = statsMap.get(r.userId)!;
      if (r.status === "NORMAL" || r.status === "LATE") u.presentDays++;
      if (r.status === "ABSENT") u.absentDays++;
      if (r.status === "LEAVE") u.leaveDays++;
      if (r.isLate) u.lateDays++;
      u.totalNetWorkHours += r.netWorkMinutes / 60;
    }

    // 전체 팀원 기준으로 결과 생성 (기록 없는 팀원도 포함)
    const members = teamMembers.map((m) => {
      const s = statsMap.get(m.id);
      return {
        userId: m.id,
        name: m.name,
        normalCount: s?.presentDays ?? 0,
        lateCount: s?.lateDays ?? 0,
        absentCount: s?.absentDays ?? 0,
        leaveCount: s?.leaveDays ?? 0,
        totalWorkMinutes: Math.round((s?.totalNetWorkHours ?? 0) * 60),
        totalOtHours: 0,
      };
    });

    return reply.send(members);
  });

  // GET /api/v1/team/members/:userId/calendar — 특정 팀원 달력
  fastify.get("/members/:userId/calendar", async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const q = req.query as { year?: string; month?: string };
    const now = new Date();
    const year = parseInt(q.year ?? String(now.getFullYear()));
    const month = parseInt(q.month ?? String(now.getMonth() + 1));
    return reply.send(await attendanceSvc.getCalendar(userId, year, month));
  });
}
