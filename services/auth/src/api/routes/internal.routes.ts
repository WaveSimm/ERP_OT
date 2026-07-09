import { FastifyInstance } from "fastify";
import { ApprovalLineService } from "../../application/approval-line.service.js";
import { DepartmentService } from "../../application/department.service.js";
import { CalendarService } from "../../application/calendar.service.js";
import { PrismaClient, Prisma } from "@prisma/client";

// 부하테스트 — 일반 조회용 internal API에서 부하 사용자 자동 제외
// /users/bulk는 명시적 ID 요청이므로 필터 미적용 (load test가 본인 정보 fetch 가능)
const HIDE_LOAD_TEST = process.env.HIDE_LOAD_TEST !== "false";
const LOAD_TEST_DOMAIN = process.env.LOAD_TEST_DOMAIN ?? "@erp-ot.load";

function loadTestUserExclude(): Prisma.UserWhereInput {
  return HIDE_LOAD_TEST
    ? { NOT: { email: { endsWith: LOAD_TEST_DOMAIN } } }
    : {};
}

// 자원-모델-분리 PDCA Phase 3a-1: 일반 조회는 status=ACTIVE만 (default)
//   ?includeRetired=true 또는 ?includeAll=true 시 모두 포함
function activeUserFilter(query: { includeRetired?: string; includeAll?: string }): Prisma.UserWhereInput {
  const include = query.includeRetired === "true" || query.includeAll === "true";
  return include ? {} : { status: "ACTIVE" };
}

export async function internalRoutes(
  fastify: FastifyInstance,
  opts: {
    approvalLineService: ApprovalLineService;
    deptService: DepartmentService;
    calendarService: CalendarService;
    prisma: PrismaClient;
  },
) {
  const { approvalLineService: alSvc, deptService: deptSvc, calendarService: calSvc, prisma } = opts;

  // 내부 API 인증 훅
  fastify.addHook("onRequest", async (req, reply) => {
    const token = req.headers["x-internal-token"];
    if (token !== process.env.INTERNAL_API_TOKEN) {
      return reply.status(401).send({ code: "UNAUTHORIZED", message: "내부 API 인증 실패" });
    }
  });

  // GET /internal/users/bulk?ids=id1,id2,...
  fastify.get("/users/bulk", async (req, reply) => {
    const q = req.query as { ids?: string };
    const ids = (q.ids ?? "").split(",").filter(Boolean);
    if (ids.length === 0) return reply.send({});

    const users = await prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, email: true },
    });
    const result: Record<string, { name: string; email: string }> = {};
    for (const u of users) result[u.id] = { name: u.name, email: u.email };
    return reply.send(result);
  });

  // GET /internal/users/:id/approver
  fastify.get("/users/:id/approver", async (req, reply) => {
    const { id } = req.params as { id: string };
    const approver = await alSvc.getApprover(id);
    if (!approver) return reply.status(404).send({ code: "NOT_FOUND", message: "결재라인이 없습니다." });
    return reply.send(approver);
  });

  // GET /internal/approver/:id/subordinates
  fastify.get("/approver/:id/subordinates", async (req, reply) => {
    const { id } = req.params as { id: string };
    const subs = await alSvc.getSubordinates(id);
    return reply.send(subs);
  });

  // GET /internal/users/:id/profile — 사용자 상세 (프로필+부서)
  fastify.get("/users/:id/profile", async (req, reply) => {
    const { id } = req.params as { id: string };
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true },
    });
    if (!user) return reply.status(404).send({ code: "NOT_FOUND" });
    const profile = await prisma.userProfile.findUnique({
      where: { userId: id },
      include: { department: { select: { id: true, name: true } } },
    });
    return reply.send({
      ...user,
      profile: profile ? {
        departmentId: profile.departmentId,
        departmentName: profile.department?.name ?? null,
        position: profile.position,
      } : null,
    });
  });

  // GET /internal/users/all — 전체 사용자 ID+이름 목록 (부하 사용자 + RETIRED 자동 제외)
  fastify.get("/users/all", async (req, reply) => {
    const q = req.query as { includeRetired?: string; includeAll?: string };
    const users = await prisma.user.findMany({
      where: { ...loadTestUserExclude(), ...activeUserFilter(q) },
      select: { id: true, name: true, email: true, status: true },
    });
    return reply.send(users);
  });

  // GET /internal/users/under/:userId — 해당 사용자가 팀장/총괄/대표인 부서 + 하위 부서 전체 멤버
  fastify.get("/users/under/:userId", async (req, reply) => {
    const { userId } = req.params as { userId: string };

    // 이 사용자가 팀장, 이사, 대표이사인 부서 찾기
    const headDepts = await prisma.department.findMany({
      where: {
        isActive: true,
        OR: [
          { headUserId: userId },
          { soukwalUserId: userId },
          { daepyoUserId: userId },
        ],
      },
      select: { id: true },
    });

    if (headDepts.length === 0) {
      return reply.send([]);
    }

    // 하위 부서 재귀 탐색
    const allDeptIds = new Set(headDepts.map((d) => d.id));
    const queue = [...allDeptIds];
    while (queue.length > 0) {
      const parentId = queue.shift()!;
      const children = await prisma.department.findMany({
        where: { parentId, isActive: true },
        select: { id: true },
      });
      for (const c of children) {
        if (!allDeptIds.has(c.id)) {
          allDeptIds.add(c.id);
          queue.push(c.id);
        }
      }
    }

    // 해당 부서들의 모든 멤버 조회 (부하 사용자 자동 제외)
    const profiles = await prisma.userProfile.findMany({
      where: {
        departmentId: { in: Array.from(allDeptIds) },
        ...(HIDE_LOAD_TEST ? { user: loadTestUserExclude() } : {}),
      },
      select: { userId: true, user: { select: { id: true, name: true, email: true } } },
    });

    const users = profiles.map((p) => ({ id: p.user.id, name: p.user.name, email: p.user.email }));
    return reply.send(users);
  });

  // GET /internal/users/all-with-departments — 전체 사용자 + 부서 정보 (부하 사용자 + RETIRED 자동 제외)
  fastify.get("/users/all-with-departments", async (req, reply) => {
    const q = req.query as { includeRetired?: string; includeAll?: string };
    const userFilter = { ...loadTestUserExclude(), ...activeUserFilter(q) };
    const profiles = await prisma.userProfile.findMany({
      where: { user: userFilter },
      include: {
        user: { select: { id: true, name: true, email: true, status: true } },
        department: { select: { id: true, name: true, sortOrder: true, hiddenFromMenus: true } },
      },
    });
    const result = profiles.map((p) => ({
      id: p.user.id,
      name: p.user.name,
      email: p.user.email,
      status: p.user.status,
      departmentId: p.department?.id ?? null,
      departmentName: p.department?.name ?? null,
      departmentSortOrder: p.department?.sortOrder ?? 999,
      // 메뉴 숨김 부서 여부 — 전사근태 등 일반 메뉴에서 제외 판단용
      departmentHidden: p.department?.hiddenFromMenus ?? false,
    }));
    // UserProfile 없는 사용자도 포함
    const profileUserIds = new Set(profiles.map((p) => p.userId));
    const orphans = await prisma.user.findMany({
      where: {
        id: { notIn: Array.from(profileUserIds) },
        ...userFilter,
      },
      select: { id: true, name: true, email: true, status: true },
    });
    for (const u of orphans) {
      result.push({
        id: u.id, name: u.name, email: u.email, status: u.status,
        departmentId: null, departmentName: null, departmentSortOrder: 999,
        departmentHidden: false,
      });
    }
    return reply.send(result);
  });

  // GET /internal/departments — 활성·비숨김 부서 목록 (project 부서 폴더 구성용)
  fastify.get("/departments", async (_req, reply) => {
    const depts = await prisma.department.findMany({
      where: { isActive: true, hiddenFromMenus: false },
      select: { id: true, name: true, sortOrder: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    return reply.send(depts);
  });

  // GET /internal/departments/:id/members
  fastify.get("/departments/:id/members", async (req, reply) => {
    const { id } = req.params as { id: string };
    const members = await deptSvc.getMembers(id);
    return reply.send(members);
  });

  // GET /internal/calendar/holidays?from&to — 일자별 정규화된 휴일 목록 (attendance/project 소비용)
  fastify.get("/calendar/holidays", async (req, reply) => {
    const q = req.query as { from?: string; to?: string };
    if (!q.from || !q.to) {
      return reply.status(400).send({ code: "BAD_REQUEST", message: "from, to (YYYY-MM-DD) required" });
    }
    const holidays = await calSvc.holidaysByDate(q.from, q.to);
    return reply.send(holidays);
  });
}
