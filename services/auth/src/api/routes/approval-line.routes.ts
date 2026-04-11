import { FastifyInstance } from "fastify";
import { z } from "zod";
import { ApprovalLineService } from "../../application/approval-line.service.js";
import { AuthService } from "../../application/auth.service.js";
import { createAuthHook, requireRole } from "../middleware/auth.middleware.js";
import { publishActivity } from "../../infrastructure/event-publisher";

export async function approvalLineRoutes(
  fastify: FastifyInstance,
  opts: { approvalLineService: ApprovalLineService; authService: AuthService },
) {
  const svc = opts.approvalLineService;
  const authenticate = createAuthHook(opts.authService);
  const adminOnly = requireRole("ADMIN");

  // GET /api/v1/approval-lines/me — 내 결재자 조회 (이름 포함)
  fastify.get("/me", { preHandler: [authenticate] }, async (req, reply) => {
    const info = await svc.getApprover(req.userId);
    if (!info) return reply.status(404).send({ code: "NOT_FOUND", message: "결재라인이 없습니다." });
    return reply.send(info);
  });

  // GET /api/v1/approval-lines
  fastify.get("/", async (_req, reply) => {
    return reply.send(await svc.getAll());
  });

  // GET /api/v1/approval-lines/:userId
  fastify.get("/:userId", async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const line = await svc.getByUser(userId);
    if (!line) return reply.status(404).send({ code: "NOT_FOUND", message: "결재라인이 없습니다." });
    return reply.send(line);
  });

  // POST /api/v1/approval-lines (upsert)
  fastify.post("/", { preHandler: [authenticate, adminOnly] }, async (req, reply) => {
    const body = z.object({
      userId: z.string(),
      approverId: z.string(),
      secondApproverId: z.string().nullable().optional(),
      thirdApproverId: z.string().nullable().optional(),
      delegateId: z.string().nullable().optional(),
      delegateUntil: z.coerce.date().nullable().optional(),
    }).parse(req.body);
    const upsertData: Parameters<typeof svc.upsert>[0] = {
      userId: body.userId,
      approverId: body.approverId,
    };
    if (body.secondApproverId !== undefined) upsertData.secondApproverId = body.secondApproverId;
    if (body.thirdApproverId !== undefined) upsertData.thirdApproverId = body.thirdApproverId;
    if (body.delegateId !== undefined) upsertData.delegateId = body.delegateId;
    if (body.delegateUntil !== undefined) upsertData.delegateUntil = body.delegateUntil;
    const line = await svc.upsert(upsertData);
    publishActivity({
      action: "approval.updated",
      userId: req.userId,
      entityType: "approval_line",
      entityId: body.userId,
      description: `결재라인 설정: ${body.userId}`,
    });
    return reply.status(201).send(line);
  });

  // DELETE /api/v1/approval-lines/:userId
  fastify.delete("/:userId", { preHandler: [authenticate, adminOnly] }, async (req, reply) => {
    const { userId } = req.params as { userId: string };
    await svc.remove(userId);
    publishActivity({
      action: "approval.deleted",
      userId: req.userId,
      entityType: "approval_line",
      entityId: userId,
      description: `결재라인 삭제: ${userId}`,
    });
    return reply.status(204).send();
  });

  // POST /api/v1/approval-lines/bulk-by-department
  fastify.post("/bulk-by-department", { preHandler: [authenticate, adminOnly] }, async (req, reply) => {
    const body = z.object({ departmentId: z.string() }).parse(req.body);
    await svc.bulkSetByDepartment(body.departmentId);
    publishActivity({
      action: "approval.bulk_set",
      userId: req.userId,
      entityType: "approval_line",
      entityId: body.departmentId,
      description: `결재라인 부서별 일괄 설정: ${body.departmentId}`,
    });
    return reply.status(204).send();
  });

  // POST /api/v1/approval-lines/bulk-all (전사 일괄 설정)
  fastify.post("/bulk-all", { preHandler: [authenticate, adminOnly] }, async (req, reply) => {
    await svc.bulkSetAll();
    publishActivity({
      action: "approval.bulk_set",
      userId: req.userId,
      entityType: "approval_line",
      entityId: "all",
      description: "결재라인 전사 일괄 설정",
    });
    return reply.status(204).send();
  });
}
