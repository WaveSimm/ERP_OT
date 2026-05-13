import { FastifyInstance } from "fastify";
import { requireRole } from "../middleware/auth.middleware.js";

export async function expenseFollowUpRoutes(fastify: FastifyInstance) {
  // 목록: 전체 허용
  fastify.get("/", async (request) => {
    const q = request.query as any;
    return fastify.expenseFollowUpService.list({ status: q.status });
  });

  // 상세
  fastify.get("/:id", async (request) => {
    return fastify.expenseFollowUpService.getById((request.params as any).id);
  });

  // 재고 판정: ADMIN, MANAGER
  fastify.post("/:id/decide", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request) => {
    const body = request.body as any;
    return fastify.expenseFollowUpService.decideInventory((request.params as any).id, {
      isInventoryTarget: body.isInventoryTarget,
      inventoryDecisionBy: request.userId,
      inventoryDecisionNote: body.note,
      inventoryItems: body.inventoryItems,
    });
  });

  // 입고 확인: ADMIN, MANAGER
  fastify.post("/:id/confirm-arrival", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request) => {
    const body = request.body as any;
    return fastify.expenseFollowUpService.confirmArrival((request.params as any).id, {
      arrivalDate: body.arrivalDate,
      arrivalLocation: body.arrivalLocation,
      arrivalNote: body.arrivalNote,
      confirmedBy: request.userId,
    });
  });

  // 송금 처리 (체크): ADMIN, MANAGER
  fastify.post("/:id/payment", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request) => {
    const body = request.body as any;
    return fastify.expenseFollowUpService.markPayment((request.params as any).id, {
      paidAt: body.paidAt,
      paidAmount: body.paidAmount,
      paidNote: body.paidNote,
      paidBy: request.userId,
    });
  });

  // 송금 처리 해제: ADMIN, MANAGER
  fastify.delete("/:id/payment", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async (request) => {
    return fastify.expenseFollowUpService.clearPayment((request.params as any).id);
  });
}

/** Internal API: 결재 승인 후 자동 생성 */
export async function internalExpenseRoutes(fastify: FastifyInstance) {
  fastify.post("/internal/expenses/follow-up", async (request, reply) => {
    const token = request.headers["x-internal-token"];
    if (token !== process.env.INTERNAL_API_TOKEN) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const body = request.body as any;
    const result = await fastify.expenseFollowUpService.createFromApproval({
      approvalDocumentId: body.approvalDocumentId,
      receivedBy: body.receivedBy || "system",
    });
    return reply.status(201).send(result);
  });
}
