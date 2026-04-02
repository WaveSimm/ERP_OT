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

  // GET /internal/departments/:id/members
  fastify.get("/departments/:id/members", async (req, reply) => {
    const { id } = req.params as { id: string };
    const members = await deptSvc.getMembers(id);
    return reply.send(members);
  });
}
