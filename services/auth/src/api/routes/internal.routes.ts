import { FastifyInstance } from "fastify";
import { ApprovalLineService } from "../../application/approval-line.service.js";
import { DepartmentService } from "../../application/department.service.js";
import { PrismaClient } from "@prisma/client";

export async function internalRoutes(
  fastify: FastifyInstance,
  opts: {
    approvalLineService: ApprovalLineService;
    deptService: DepartmentService;
    prisma: PrismaClient;
  },
) {
  const { approvalLineService: alSvc, deptService: deptSvc, prisma } = opts;

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

  // GET /internal/users/all — 전체 사용자 ID+이름 목록
  fastify.get("/users/all", async (req, reply) => {
    const users = await prisma.user.findMany({
      select: { id: true, name: true, email: true },
    });
    return reply.send(users);
  });

  // GET /internal/users/under/:userId — 해당 사용자가 팀장/총괄/대표인 부서 + 하위 부서 전체 멤버
  fastify.get("/users/under/:userId", async (req, reply) => {
    const { userId } = req.params as { userId: string };

    // 이 사용자가 팀장, 총괄이사, 대표이사인 부서 찾기
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

    // 해당 부서들의 모든 멤버 조회
    const profiles = await prisma.userProfile.findMany({
      where: { departmentId: { in: Array.from(allDeptIds) } },
      select: { userId: true, user: { select: { id: true, name: true, email: true } } },
    });

    const users = profiles.map((p) => ({ id: p.user.id, name: p.user.name, email: p.user.email }));
    return reply.send(users);
  });

  // GET /internal/departments/:id/members
  fastify.get("/departments/:id/members", async (req, reply) => {
    const { id } = req.params as { id: string };
    const members = await deptSvc.getMembers(id);
    return reply.send(members);
  });
}
