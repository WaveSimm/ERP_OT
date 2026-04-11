import { FastifyInstance } from "fastify";
import { requireRole } from "../middleware/auth.middleware";

export async function documentRoutes(fastify: FastifyInstance) {
  // ─── CRUD ───────────────────────────────────────────────────────────

  fastify.post("/", { preHandler: [requireRole("ADMIN", "MANAGER", "OPERATOR")] }, async (request, reply) => {
    const body = request.body as any;
    const approvalLine: any[] = body.approvalLine || [];

    // 결재선이 비어 있으면 auth-service에서 부서 기본선 로드
    let steps = approvalLine.map((a: any, i: number) => ({
      stepOrder: a.stepOrder ?? i + 1,
      roleName: a.role === "AGREEER" ? "합의" : "결재",
      approverId: a.userId,
      approverName: a.userName,
    }));

    if (steps.length === 0) {
      try {
        const authUrl = process.env.AUTH_SERVICE_URL || "http://auth-service:3001";
        const token = process.env.INTERNAL_API_TOKEN || "";
        const resp = await fetch(`${authUrl}/internal/users/${request.userId}/approver`, {
          headers: { "X-Internal-Token": token },
        });
        if (resp.ok) {
          const line = await resp.json() as any;
          if (line.approverId) steps.push({ stepOrder: 1, roleName: "결재", approverId: line.approverId, approverName: line.approverName || line.approverId });
          if (line.secondApproverId) steps.push({ stepOrder: 2, roleName: "결재", approverId: line.secondApproverId, approverName: line.secondApproverName || line.secondApproverId });
          if (line.thirdApproverId) steps.push({ stepOrder: 3, roleName: "결재", approverId: line.thirdApproverId, approverName: line.thirdApproverName || line.thirdApproverId });
        }
      } catch { /* fallback: no steps */ }
    }

    // department + requesterName: 사용자 프로필에서 조회
    let department = body.department || "";
    let requesterName = body.drafterName || "";
    if (!department || !requesterName) {
      try {
        const authUrl = process.env.AUTH_SERVICE_URL || "http://auth-service:3001";
        const token = process.env.INTERNAL_API_TOKEN || "";
        const resp = await fetch(`${authUrl}/internal/users/${request.userId}/profile`, {
          headers: { "X-Internal-Token": token },
        });
        if (resp.ok) {
          const user = await resp.json() as any;
          if (!department) department = user.profile?.departmentName || user.departmentName || "미지정";
          if (!requesterName) requesterName = user.name || user.profile?.name || "";
        }
      } catch { if (!department) department = "미지정"; }
    }

    const result = await fastify.documentService.create({
      templateId: body.templateId,
      title: body.title,
      requestedBy: request.userId,
      requesterName,
      department,
      approvalStepCount: steps.length,
      content: body.fields || body.content,
      richBody: body.body || body.richBody,
      itemsData: body.items,
      itemsTotal: body.totalAmount,
      amount: body.totalAmount,
      referenceType: body.referenceType,
      referenceId: body.referenceId,
      ccUsers: body.ccUsers,
      agreementUsers: body.agreementUsers,
      notes: body.notes,
      steps,
    });
    return reply.status(201).send(result);
  });

  fastify.get("/:id", async (request) => {
    return fastify.documentService.getById((request.params as any).id);
  });

  fastify.put("/:id", async (request) => {
    const { id } = request.params as any;
    return fastify.documentService.update(id, request.body as any);
  });

  fastify.delete("/:id", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    await fastify.documentService.remove((request.params as any).id);
    return reply.status(204).send();
  });

  // ─── Actions ────────────────────────────────────────────────────────

  fastify.patch("/:id/submit", async (request) => {
    return fastify.documentService.submit((request.params as any).id);
  });

  fastify.patch("/:id/withdraw", async (request) => {
    return fastify.documentService.withdraw((request.params as any).id, request.userId);
  });

  fastify.patch("/:id/approve", async (request) => {
    const { id } = request.params as any;
    const { comment } = (request.body as any) || {};
    return fastify.documentService.approve(id, request.userId, comment);
  });

  fastify.patch("/:id/reject", async (request) => {
    const { id } = request.params as any;
    const { comment } = request.body as any;
    return fastify.documentService.reject(id, request.userId, comment);
  });

  fastify.patch("/:id/agree", async (request) => {
    return fastify.documentService.agree((request.params as any).id, request.userId);
  });

  fastify.patch("/:id/disagree", async (request) => {
    const { comment } = request.body as any;
    return fastify.documentService.disagree((request.params as any).id, request.userId, comment);
  });

  // ─── Inbox ──────────────────────────────────────────────────────────

  fastify.get("/pending", async (request) => {
    const { page, limit } = request.query as any;
    return fastify.documentService.getPending(request.userId, page ? Number(page) : 1, limit ? Number(limit) : 50);
  });

  fastify.get("/pending/count", async (request) => {
    const count = await fastify.documentService.getPendingCount(request.userId);
    return { count };
  });

  fastify.get("/sent", async (request) => {
    const { page, limit } = request.query as any;
    return fastify.documentService.getSent(request.userId, page ? Number(page) : 1, limit ? Number(limit) : 50);
  });

  fastify.get("/cc", async (request) => {
    const { page, limit } = request.query as any;
    return fastify.documentService.getCC(request.userId, page ? Number(page) : 1, limit ? Number(limit) : 50);
  });

  fastify.get("/completed", async (request) => {
    const { page, limit } = request.query as any;
    return fastify.documentService.getCompleted(request.userId, page ? Number(page) : 1, limit ? Number(limit) : 50);
  });
}
