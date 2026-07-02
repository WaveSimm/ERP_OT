import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ApprovalStatus, LeaveType } from "@prisma/client";

// ─────────────────────────────────────────────
// 관리부서 전용 — 관리>근태현황 (전 직원 휴가·휴일근무 + ecount 결재 확인)
//   접근: ADMIN 역할 또는 관리부서(회계·경영지원·임원·대표이사) 소속.
//   부서 판정은 auth 내부 API(all-with-departments, redis 5분 캐시) 기준 —
//   프론트 메뉴 게이트(AppLayout MGMT_DEPTS)와 목록을 맞출 것.
// ─────────────────────────────────────────────
const MGMT_DEPTS = new Set(["회계팀", "경영지원팀", "임원", "대표이사"]);

interface ApprovalCheckRow {
  kind: "LEAVE" | "HOLIDAY_WORK";
  id: string;
  userId: string;
  userName: string;
  departmentName: string | null;
  type: LeaveType | "HOLIDAY_WORK";
  startDate: string;
  endDate: string;
  startTime: string | null;
  days: number | null;
  status: ApprovalStatus;
  ecountCheckedAt: Date | null;
  ecountCheckedById: string | null;
  ecountCheckedByName: string | null;
}

export async function adminRoutes(fastify: FastifyInstance) {
  const requireMgmtDept = async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.userRole === "ADMIN") return;
    const users = await fastify.authClient.getAllUsersWithDepartments();
    const me = users.find((u) => u.id === req.userId);
    if (!me?.departmentName || !MGMT_DEPTS.has(me.departmentName)) {
      return reply.code(403).send({ error: "관리부서 전용 기능입니다." });
    }
  };

  // GET /approval-checks?year&month — 해당 월과 겹치는 전 직원 휴가·휴일근무 (ecount 확인 상태 포함)
  fastify.get("/approval-checks", { preHandler: requireMgmtDept }, async (req) => {
    const q = req.query as { year?: string; month?: string };
    const now = new Date();
    const year = parseInt(q.year ?? String(now.getFullYear()));
    const month = parseInt(q.month ?? String(now.getMonth() + 1));
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 0)); // 말일 (@db.Date 컬럼과 동일하게 UTC 자정 기준)

    const [leaves, holidayWorks, users] = await Promise.all([
      fastify.prisma.leaveRequest.findMany({
        where: { startDate: { lte: end }, endDate: { gte: start } },
      }),
      fastify.prisma.holidayWorkRequest.findMany({
        where: { date: { gte: start, lte: end } },
      }),
      fastify.authClient.getAllUsersWithDepartments(),
    ]);
    const userMap = new Map(users.map((u) => [u.id, u]));
    const dstr = (d: Date) => d.toISOString().slice(0, 10);

    const rows: ApprovalCheckRow[] = [
      ...leaves.map((l): ApprovalCheckRow => ({
        kind: "LEAVE",
        id: l.id,
        userId: l.userId,
        userName: userMap.get(l.userId)?.name ?? l.userId,
        departmentName: userMap.get(l.userId)?.departmentName ?? null,
        type: l.type,
        startDate: dstr(l.startDate),
        endDate: dstr(l.endDate),
        startTime: l.startTime,
        days: l.days,
        status: l.status,
        ecountCheckedAt: l.ecountCheckedAt,
        ecountCheckedById: l.ecountCheckedById,
        ecountCheckedByName: l.ecountCheckedById ? userMap.get(l.ecountCheckedById)?.name ?? null : null,
      })),
      ...holidayWorks.map((h): ApprovalCheckRow => ({
        kind: "HOLIDAY_WORK",
        id: h.id,
        userId: h.userId,
        userName: userMap.get(h.userId)?.name ?? h.userId,
        departmentName: userMap.get(h.userId)?.departmentName ?? null,
        type: "HOLIDAY_WORK",
        startDate: dstr(h.date),
        endDate: dstr(h.date),
        startTime: null,
        days: null,
        status: h.status,
        ecountCheckedAt: h.ecountCheckedAt,
        ecountCheckedById: h.ecountCheckedById,
        ecountCheckedByName: h.ecountCheckedById ? userMap.get(h.ecountCheckedById)?.name ?? null : null,
      })),
    ];

    // 부서 정렬순 → 이름 → 시작일
    rows.sort((a, b) => {
      const soA = userMap.get(a.userId)?.departmentSortOrder ?? 9999;
      const soB = userMap.get(b.userId)?.departmentSortOrder ?? 9999;
      if (soA !== soB) return soA - soB;
      if (a.userName !== b.userName) return a.userName.localeCompare(b.userName, "ko");
      return a.startDate.localeCompare(b.startDate);
    });

    return { year, month, total: rows.length, unchecked: rows.filter((r) => !r.ecountCheckedAt).length, rows };
  });

  // PATCH /approval-checks/:kind/:id/ecount { checked } — ecount 결재 확인 토글
  fastify.patch("/approval-checks/:kind/:id/ecount", { preHandler: requireMgmtDept }, async (req, reply) => {
    const { kind, id } = req.params as { kind: string; id: string };
    const { checked } = (req.body ?? {}) as { checked?: boolean };
    if (typeof checked !== "boolean") return reply.code(400).send({ error: "checked(boolean) 필요" });
    const data = {
      ecountCheckedAt: checked ? new Date() : null,
      ecountCheckedById: checked ? req.userId : null,
    };
    try {
      if (kind === "leave") {
        const updated = await fastify.prisma.leaveRequest.update({ where: { id }, data });
        return { id: updated.id, ecountCheckedAt: updated.ecountCheckedAt, ecountCheckedById: updated.ecountCheckedById };
      }
      if (kind === "holiday-work") {
        const updated = await fastify.prisma.holidayWorkRequest.update({ where: { id }, data });
        return { id: updated.id, ecountCheckedAt: updated.ecountCheckedAt, ecountCheckedById: updated.ecountCheckedById };
      }
      return reply.code(400).send({ error: "kind는 leave 또는 holiday-work" });
    } catch {
      return reply.code(404).send({ error: "대상 없음" });
    }
  });
}
