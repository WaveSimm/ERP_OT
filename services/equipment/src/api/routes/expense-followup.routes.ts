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
      confirmedBy: request.userId,
    });
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
