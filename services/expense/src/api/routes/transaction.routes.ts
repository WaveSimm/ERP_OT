import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { TransactionService } from "../../application/transaction.service";

const STATUSES = ["PENDING", "CATEGORIZED", "EXCLUDED", "CANCELED", "SETTLED"] as const;

const createSchema = z.object({
  sourceId: z.string().min(1),
  transactedAt: z.string().datetime().or(z.string().min(8)),
  merchantName: z.string().min(1).max(200),
  amount: z.number().positive(),
  currency: z.string().max(8).optional(),
  paymentType: z.string().max(50).optional(),
  approvalNo: z.string().max(50).optional(),
  contractId: z.string().nullable().optional(),
  contractNumber: z.string().max(50).nullable().optional(),
  contractName: z.string().max(200).nullable().optional(),
  detail: z.string().max(500).optional(),
  memo: z.string().max(500).optional(),
  isCanceled: z.boolean().optional(),
});

const bulkDeleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(1000),
});

const updateSchema = z.object({
  contractId: z.string().nullable().optional(),
  contractNumber: z.string().max(50).nullable().optional(),
  contractName: z.string().max(200).nullable().optional(),
  detail: z.string().max(500).nullable().optional(),
  memo: z.string().max(500).nullable().optional(),
  status: z.enum(STATUSES).optional(),
  merchantName: z.string().min(1).max(200).optional(),
  amount: z.number().positive().optional(),
});

export async function transactionRoutes(app: FastifyInstance, opts: { service: TransactionService }) {
  const { service } = opts;

  app.get("/", async (req) => {
    const q = req.query as Record<string, string | undefined>;
    return service.list(req.userId, {
      ...(q.status && { status: q.status as any }),
      ...(q.contractId && { contractId: q.contractId }),
      ...(q.sourceId && { sourceId: q.sourceId }),
      ...(q.from && { from: new Date(q.from) }),
      ...(q.to && { to: new Date(q.to) }),
      ...(q.page && { page: parseInt(q.page, 10) }),
      ...(q.limit && { limit: parseInt(q.limit, 10) }),
    });
  });

  app.get("/:id", async (req) => {
    const { id } = req.params as { id: string };
    return service.get(req.userId, id);
  });

  app.post("/", async (req, reply) => {
    const body = createSchema.parse(req.body);
    const created = await service.createManual({
      userId: req.userId,
      sourceId: body.sourceId,
      transactedAt: new Date(body.transactedAt),
      merchantName: body.merchantName,
      amount: body.amount,
      ...(body.currency && { currency: body.currency }),
      ...(body.paymentType && { paymentType: body.paymentType }),
      ...(body.approvalNo && { approvalNo: body.approvalNo }),
      ...(body.contractId !== undefined && { contractId: body.contractId }),
      ...(body.contractNumber !== undefined && { contractNumber: body.contractNumber }),
      ...(body.contractName !== undefined && { contractName: body.contractName }),
      ...(body.detail && { detail: body.detail }),
      ...(body.memo && { memo: body.memo }),
      ...(body.isCanceled !== undefined && { isCanceled: body.isCanceled }),
    });
    return reply.code(201).send(created);
  });

  app.patch("/:id", async (req) => {
    const { id } = req.params as { id: string };
    const body = updateSchema.parse(req.body);
    return service.update(req.userId, id, body);
  });

  // 일괄 삭제 — 전체선택 삭제 시 프런트가 거래마다 DELETE를 동시 발사해 rate-limit을 넘기던 문제 해결.
  //   '/:id' DELETE와 경로가 겹치지 않게 별도 POST 경로 사용.
  app.post("/bulk-delete", async (req, reply) => {
    const { ids } = bulkDeleteSchema.parse(req.body);
    const result = await service.deleteManyManual(req.userId, ids);
    return reply.send(result);
  });

  app.delete("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await service.deleteManual(req.userId, id);
    return reply.code(204).send();
  });
}
