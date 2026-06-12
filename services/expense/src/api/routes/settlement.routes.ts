import type { FastifyInstance } from "fastify";
import { promises as fs } from "fs";
import { z } from "zod";
import type { SettlementService } from "../../application/settlement.service";
import type { LocalFsStorage } from "../../infrastructure/storage";
import { buildSettlementWorkbook } from "../../infrastructure/excel/settlement-writer";

const STATUSES = ["DRAFT", "SUBMITTED", "APPROVED", "RECEIVED", "PAID", "REJECTED"] as const;

const createEmptySchema = z.object({
  title: z.string().min(1).max(200),
});

const setTxSettlementSchema = z.object({
  settlementId: z.string().nullable(),
});

const paySchema = z.object({
  paidAt: z.string().datetime().optional(),
  paidAmount: z.number().positive().optional(),
  paidNote: z.string().max(500).optional(),
});

export async function settlementRoutes(app: FastifyInstance, opts: { service: SettlementService; storage: LocalFsStorage }) {
  const { service, storage } = opts;

  app.get("/", async (req) => {
    const q = req.query as { status?: string; page?: string; limit?: string };
    return service.list(req.userId, {
      ...(q.status && { status: q.status as any }),
      ...(q.page && { page: parseInt(q.page, 10) }),
      ...(q.limit && { limit: parseInt(q.limit, 10) }),
    });
  });

  app.get("/:id", async (req) => {
    const { id } = req.params as { id: string };
    return service.get(req.userId, id);
  });

  // 빈 정산 묶음 생성 (수동 정산 워크플로우)
  app.post("/empty", async (req, reply) => {
    const body = createEmptySchema.parse(req.body);
    const created = await service.createEmpty(req.userId, body);
    return reply.code(201).send(created);
  });

  // 거래의 정산 묶음 할당/해제
  app.patch("/transactions/:transactionId", async (req) => {
    const { transactionId } = req.params as { transactionId: string };
    const body = setTxSettlementSchema.parse(req.body);
    return service.setTransactionSettlement(req.userId, transactionId, body.settlementId);
  });

  app.delete("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await service.deleteDraft(req.userId, id);
    return reply.code(204).send();
  });

  // 제목 수정
  app.patch("/:id/title", async (req) => {
    const { id } = req.params as { id: string };
    const body = z.object({ title: z.string().min(1).max(200) }).parse(req.body);
    return service.updateTitle(req.userId, id, body.title);
  });

  // v1.6.4 (2026-05-16): 결재 분리 — settlement에서 직접 상신/취소 라우트 제거.
  // 결재 작성·취소는 /approval/new 또는 결재 상세 페이지에서 수행.
  // expense-service는 internal /settlements/:id/link-approval webhook으로 연결됨.

  // Excel 다운로드
  app.get("/:id/excel", async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = await service.getForExport(req.userId, id);
    const buf = await buildSettlementWorkbook(s, {
      loadReceipt: (key) => fs.readFile(storage.resolveDiskPath(key)),
    });
    const fname = encodeURIComponent(`${s.title.replace(/[\\/:*?"<>|]/g, "_")}.xlsx`);
    reply.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    reply.header("Content-Disposition", `attachment; filename*=UTF-8''${fname}`);
    return reply.send(buf);
  });

  // 내대시보드 카드 요약
  app.get("/me/summary", async (req) => service.meSummary(req.userId));
}

// 재무팀 전용 — 큐 / 접수 / 입금
export async function financeRoutes(
  app: FastifyInstance,
  opts: { service: SettlementService; isFinanceTeam: (userId: string) => Promise<boolean> },
) {
  const { service, isFinanceTeam } = opts;

  // 권한: ADMIN 또는 재무팀 (departmentName='재무팀')
  app.addHook("onRequest", async (req, reply) => {
    const ok = await isFinanceTeam(req.userId);
    if (!ok) {
      return reply.code(403).send({ error: { code: "FORBIDDEN", message: "재무팀/관리자 권한 필요" } });
    }
  });

  app.get("/queue", async (req) => {
    const q = req.query as { status?: string; page?: string; limit?: string };
    return service.listFinanceQueue({
      ...(q.status && { status: q.status as any }),
      ...(q.page && { page: parseInt(q.page, 10) }),
      ...(q.limit && { limit: parseInt(q.limit, 10) }),
    });
  });

  app.post("/settlements/:id/receive", async (req) => {
    const { id } = req.params as { id: string };
    return service.receive(req.userId, id);
  });

  app.post("/settlements/:id/pay", async (req) => {
    const { id } = req.params as { id: string };
    const body = paySchema.parse(req.body);
    return service.pay(req.userId, id, {
      ...(body.paidAt && { paidAt: new Date(body.paidAt) }),
      ...(body.paidAmount !== undefined && { paidAmount: body.paidAmount }),
      ...(body.paidNote && { paidNote: body.paidNote }),
    });
  });
}

// approval-service webhook (internal)
export async function settlementInternalRoutes(app: FastifyInstance, opts: { service: SettlementService; internalToken: string }) {
  const { service, internalToken } = opts;

  app.addHook("onRequest", async (req, reply) => {
    const token = req.headers["x-internal-token"];
    if (token !== internalToken) return reply.code(403).send({ error: "Forbidden" });
  });

  // v1.6.4 (2026-05-16): 결재 생성 시 settlement 연결 (approval-service → expense-service)
  app.post("/settlements/:id/link-approval", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { approvalDocumentId: string };
    if (!body?.approvalDocumentId) {
      return reply.code(400).send({ error: "approvalDocumentId required" });
    }
    try {
      const updated = await service.linkApproval(id, body.approvalDocumentId);
      return updated;
    } catch (e: any) {
      return reply.code(400).send({ error: e.message ?? "link failed" });
    }
  });

  // 결재 삭제 시 settlement 연결 해제 (approval-service → expense-service)
  app.post("/settlements/unlink-approval", async (req, reply) => {
    const body = req.body as { approvalDocumentId: string };
    if (!body?.approvalDocumentId) {
      return reply.code(400).send({ error: "approvalDocumentId required" });
    }
    const updated = await service.unlinkApproval(body.approvalDocumentId);
    return updated ?? { ok: true };
  });

  // approval document FINANCE_FORWARD 후속 호출
  app.post("/settlements/from-approval", async (req, reply) => {
    const body = req.body as {
      approvalDocumentId: string;
      settlementId?: string;
      status: "APPROVED" | "REJECTED";
      reason?: string;
    };
    if (!body.approvalDocumentId || !body.status) {
      return reply.code(400).send({ error: "approvalDocumentId, status required" });
    }
    const updated = await service.syncFromApproval(body.approvalDocumentId, {
      status: body.status,
      ...(body.reason && { reason: body.reason }),
    });
    return updated;
  });

  // 재무 후속 모듈 송금 처리 → settlement PAID 동기화 (2026-05-12)
  app.post("/settlements/from-payment", async (req, reply) => {
    const body = req.body as {
      approvalDocumentId: string;
      paidAt?: string;
      paidAmount?: number;
      paidNote?: string;
      paidById?: string;
    };
    if (!body.approvalDocumentId) {
      return reply.code(400).send({ error: "approvalDocumentId required" });
    }
    const updated = await service.syncFromPayment(body.approvalDocumentId, {
      ...(body.paidAt && { paidAt: body.paidAt }),
      ...(body.paidAmount !== undefined && { paidAmount: body.paidAmount }),
      ...(body.paidNote && { paidNote: body.paidNote }),
      ...(body.paidById && { paidById: body.paidById }),
    });
    return updated;
  });

  // 송금 해제 동기화 (PAID → APPROVED)
  app.delete("/settlements/from-payment", async (req, reply) => {
    const body = req.body as { approvalDocumentId: string };
    if (!body.approvalDocumentId) {
      return reply.code(400).send({ error: "approvalDocumentId required" });
    }
    return service.clearPaymentSync(body.approvalDocumentId);
  });
}
