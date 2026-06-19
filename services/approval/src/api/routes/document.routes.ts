import { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { requireRole } from "../middleware/auth.middleware";

// 결재선 항목 (클라이언트 입력)
interface ApprovalLineItem {
  stepOrder?: number;
  role?: string;
  userId: string;
  userName: string;
}

// 문서 생성 요청 본문
interface CreateDocumentBody {
  templateId: string;
  title: string;
  approvalLine?: ApprovalLineItem[];
  department?: string;
  drafterName?: string;
  fields?: Prisma.InputJsonValue;
  content?: Prisma.InputJsonValue;
  body?: string;
  richBody?: string;
  items?: Prisma.InputJsonValue;
  totalAmount?: number;
  referenceType?: string;
  referenceId?: string;
  ccUsers?: string[];
  agreementUsers?: string[];
  notes?: string;
}

// auth-service /internal 응답
interface ApproverLineResponse {
  approverId?: string;
  approverName?: string;
  secondApproverId?: string;
  secondApproverName?: string;
  thirdApproverId?: string;
  thirdApproverName?: string;
}

interface UserProfileResponse {
  name?: string;
  departmentName?: string;
  profile?: { name?: string; departmentName?: string };
}

export async function documentRoutes(fastify: FastifyInstance) {
  // ─── CRUD ───────────────────────────────────────────────────────────

  fastify.post<{ Body: CreateDocumentBody }>("/", { preHandler: [requireRole("ADMIN", "MANAGER", "OPERATOR")] }, async (request, reply) => {
    const body = request.body;
    const approvalLine: ApprovalLineItem[] = body.approvalLine || [];

    // 결재선이 비어 있으면 auth-service에서 부서 기본선 로드
    const steps = approvalLine.map((a, i) => ({
      stepOrder: a.stepOrder ?? i + 1,
      roleName: a.role === "AGREEER" ? "합의" : "결재",
      approverId: a.userId,
      approverName: a.userName,
    }));

    if (steps.length === 0) {
      try {
        const authUrl = process.env.AUTH_SERVICE_URL || "http://auth-service:3001";
        // 보안 일괄패치 PDCA Layer 1 (C3): startup-time Zod env 검증으로 보장
        const token = process.env.INTERNAL_API_TOKEN as string;
        const resp = await fetch(`${authUrl}/internal/users/${request.userId}/approver`, {
          headers: { "X-Internal-Token": token },
        });
        if (resp.ok) {
          const line = await resp.json() as ApproverLineResponse;
          if (line.approverId) steps.push({ stepOrder: 1, roleName: "결재", approverId: line.approverId, approverName: line.approverName || "—" });
          if (line.secondApproverId) steps.push({ stepOrder: 2, roleName: "결재", approverId: line.secondApproverId, approverName: line.secondApproverName || "—" });
          if (line.thirdApproverId) steps.push({ stepOrder: 3, roleName: "결재", approverId: line.thirdApproverId, approverName: line.thirdApproverName || "—" });
        }
      } catch { /* fallback: no steps */ }
    }

    // department + requesterName: 사용자 프로필에서 조회
    let department = body.department || "";
    let requesterName = body.drafterName || "";
    if (!department || !requesterName) {
      try {
        const authUrl = process.env.AUTH_SERVICE_URL || "http://auth-service:3001";
        // 보안 일괄패치 PDCA Layer 1 (C3): startup-time Zod env 검증으로 보장
        const token = process.env.INTERNAL_API_TOKEN as string;
        const resp = await fetch(`${authUrl}/internal/users/${request.userId}/profile`, {
          headers: { "X-Internal-Token": token },
        });
        if (resp.ok) {
          const user = await resp.json() as UserProfileResponse;
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

  fastify.get<{ Params: { referenceType: string; referenceId: string } }>("/by-reference/:referenceType/:referenceId", async (request) => {
    const { referenceType, referenceId } = request.params;
    return fastify.documentService.getByReference(referenceType, referenceId);
  });

  fastify.get<{ Params: { id: string } }>("/:id", async (request) => {
    return fastify.documentService.getById(request.params.id);
  });

  fastify.put<{ Params: { id: string }; Body: Prisma.ApprovalDocumentUncheckedUpdateInput }>("/:id", async (request) => {
    const { id } = request.params;
    return fastify.documentService.update(id, request.body);
  });

  fastify.delete<{ Params: { id: string } }>("/:id", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    await fastify.documentService.remove(request.params.id);
    return reply.status(204).send();
  });

  // ─── Actions ────────────────────────────────────────────────────────

  fastify.patch<{ Params: { id: string } }>("/:id/submit", async (request) => {
    return fastify.documentService.submit(request.params.id);
  });

  fastify.patch<{ Params: { id: string } }>("/:id/withdraw", async (request) => {
    return fastify.documentService.withdraw(request.params.id, request.userId);
  });

  fastify.patch<{ Params: { id: string }; Body: { comment?: string } }>("/:id/approve", async (request) => {
    const { id } = request.params;
    const { comment } = request.body || {};
    return fastify.documentService.approve(id, request.userId, comment);
  });

  fastify.patch<{ Params: { id: string }; Body: { comment?: string } }>("/:id/reject", async (request) => {
    const { id } = request.params;
    const { comment } = request.body;
    return fastify.documentService.reject(id, request.userId, comment);
  });

  fastify.patch<{ Params: { id: string } }>("/:id/agree", async (request) => {
    return fastify.documentService.agree(request.params.id, request.userId);
  });

  fastify.patch<{ Params: { id: string }; Body: { comment?: string } }>("/:id/disagree", async (request) => {
    const { comment } = request.body;
    return fastify.documentService.disagree(request.params.id, request.userId, comment);
  });

  // ─── Inbox ──────────────────────────────────────────────────────────

  fastify.get<{ Querystring: { page?: string; limit?: string } }>("/pending", async (request) => {
    const { page, limit } = request.query;
    return fastify.documentService.getPending(request.userId, page ? Number(page) : 1, limit ? Number(limit) : 50);
  });

  fastify.get("/pending/count", async (request) => {
    const count = await fastify.documentService.getPendingCount(request.userId);
    return { count };
  });

  fastify.get<{ Querystring: { page?: string; limit?: string } }>("/sent", async (request) => {
    const { page, limit } = request.query;
    return fastify.documentService.getSent(request.userId, page ? Number(page) : 1, limit ? Number(limit) : 50);
  });

  fastify.get<{ Querystring: { page?: string; limit?: string } }>("/cc", async (request) => {
    const { page, limit } = request.query;
    return fastify.documentService.getCC(request.userId, page ? Number(page) : 1, limit ? Number(limit) : 50);
  });

  fastify.get<{ Querystring: { page?: string; limit?: string } }>("/completed", async (request) => {
    const { page, limit } = request.query;
    return fastify.documentService.getCompleted(request.userId, page ? Number(page) : 1, limit ? Number(limit) : 50);
  });
}
