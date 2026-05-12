import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { MatchService } from "../../application/match.service";

const createSchema = z.object({
  transactionId: z.string().min(1),
  receiptId: z.string().min(1),
});

export async function matchRoutes(app: FastifyInstance, opts: { service: MatchService }) {
  const { service } = opts;

  app.get("/", async (req) => {
    const q = req.query as { transactionId?: string; receiptId?: string; confirmed?: string };
    return service.listMatches(req.userId, {
      ...(q.transactionId && { transactionId: q.transactionId }),
      ...(q.receiptId && { receiptId: q.receiptId }),
      ...(q.confirmed === "true" && { confirmed: true }),
      ...(q.confirmed === "false" && { confirmed: false }),
    });
  });

  // 영수증/거래 등록 후 자동 매칭 후보 재계산 (수동 트리거용)
  app.post("/suggest/receipt/:id", async (req) => {
    const { id } = req.params as { id: string };
    const created = await service.suggestMatchesForReceipt(id);
    return { suggested: created };
  });

  app.post("/suggest/transaction/:id", async (req) => {
    const { id } = req.params as { id: string };
    const created = await service.suggestMatchesForTransaction(id);
    return { suggested: created };
  });

  // 수동 매칭 생성 (사용자가 직접 한쌍 지정)
  app.post("/", async (req, reply) => {
    const body = createSchema.parse(req.body);
    const created = await service.createManual(req.userId, body.transactionId, body.receiptId);
    return reply.code(201).send(created);
  });

  // AUTO 매칭의 사용자 confirm
  app.patch("/:id/confirm", async (req) => {
    const { id } = req.params as { id: string };
    return service.confirm(req.userId, id);
  });

  // 매칭 해제
  app.delete("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await service.remove(req.userId, id);
    return reply.code(204).send();
  });
}
