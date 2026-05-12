// 정산서 도메인 + 6단계 상태머신 (Design §4)
//   DRAFT → SUBMITTED → APPROVED → RECEIVED → PAID
//                    └→ REJECTED

import type { PrismaClient, SettlementStatus } from "@prisma/client";
import { promises as fs } from "fs";
import type { ApprovalClient } from "../infrastructure/approval-client";
import type { LocalFsStorage } from "../infrastructure/storage";
import { publishActivity } from "../infrastructure/event-publisher";

export interface CreateSettlementInput {
  userId: string;
  periodStart: Date;
  periodEnd: Date;
  title?: string;
}

export interface ListSettlementParams {
  status?: SettlementStatus;
  page?: number;
  limit?: number;
}

// FSM 전이 규칙
const TRANSITIONS: Record<SettlementStatus, SettlementStatus[]> = {
  DRAFT: ["SUBMITTED"],
  SUBMITTED: ["APPROVED", "REJECTED", "DRAFT"], // DRAFT는 작성자 취소
  APPROVED: ["RECEIVED"],
  RECEIVED: ["PAID"],
  PAID: [],
  REJECTED: [],
};

function assertTransition(from: SettlementStatus, to: SettlementStatus) {
  if (!TRANSITIONS[from].includes(to)) {
    throw new Error(`잘못된 상태 전이: ${from} → ${to}`);
  }
}

export class SettlementService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly approvalClient: ApprovalClient,
    private readonly storage: LocalFsStorage,
  ) {}

  async list(userId: string, params: ListSettlementParams = {}) {
    const { status, page = 1, limit = 50 } = params;
    const where: any = { userId };
    if (status) where.status = status;

    const [items, total] = await Promise.all([
      this.prisma.expenseSettlement.findMany({
        where,
        orderBy: [{ periodStart: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.expenseSettlement.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async get(userId: string, id: string) {
    const s = await this.prisma.expenseSettlement.findFirst({
      where: { id, userId },
      include: {
        items: {
          include: {
            transaction: {
              include: {
                category: true,
                source: { select: { id: true, name: true, displayName: true, type: true } },
                matches: { where: { confirmedAt: { not: null } }, include: { receipt: true } },
              },
            },
          },
          orderBy: { sortOrder: "asc" },
        },
      },
    });
    if (!s) throw new Error("정산서를 찾을 수 없습니다.");
    return s;
  }

  /** @deprecated 카테고리별 자동 생성 — 수동 정산 모드로 전환되어 사용 안 함 */
  async createForPeriodByCategory(_input: CreateSettlementInput) {
    throw new Error("자동 정산은 더 이상 지원되지 않습니다. 거래 페이지에서 수동으로 정산분류를 설정해주세요.");
  }

  async deleteDraft(userId: string, id: string) {
    const s = await this.get(userId, id);
    if (s.status !== "DRAFT" && s.status !== "REJECTED") {
      throw new Error("작성중(DRAFT) 또는 반려(REJECTED) 상태에서만 삭제 가능합니다.");
    }
    return this.prisma.expenseSettlement.delete({ where: { id } });
  }

  /**
   * 결재 상신 취소 — SUBMITTED → DRAFT.
   * approval-service의 결재 문서도 withdraw + 거래 status를 CATEGORIZED로 되돌림.
   */
  async cancelSubmission(userId: string, id: string) {
    const s = await this.get(userId, id);
    if (s.status !== "SUBMITTED") throw new Error("결재 진행 중인 정산만 취소할 수 있습니다.");
    if (s.userId !== userId) throw new Error("본인이 작성한 정산만 취소할 수 있습니다.");

    // approval-service에 withdraw 요청 (실패해도 정산은 DRAFT로 되돌림 — 추후 수동 정리 가능)
    if (s.approvalDocumentId) {
      try {
        await this.approvalClient.withdrawDocument(s.approvalDocumentId, userId);
      } catch (err: any) {
        console.error(`[settlement] approval withdraw failed: ${err.message}`);
      }
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.expenseSettlement.update({
        where: { id },
        data: {
          status: "DRAFT",
          submittedAt: null,
          approvalDocumentId: null,
        },
      }),
      // 거래 status 되돌림 SETTLED → CATEGORIZED
      this.prisma.expenseTransaction.updateMany({
        where: { id: { in: s.items.map((it) => it.transactionId) }, status: "SETTLED" },
        data: { status: "CATEGORIZED" },
      }),
    ]);

    void publishActivity({
      action: "expense.settlement.canceled",
      userId,
      entityType: "expense_settlement",
      entityId: id,
      description: `경비정산 결재 취소 — ${s.title}`,
      metadata: { approvalDocumentId: s.approvalDocumentId },
    });

    return updated;
  }

  /**
   * 빈 정산 묶음 생성 (수동 정산 워크플로우).
   * 거래는 별도로 setTransactionSettlement로 추가.
   */
  async createEmpty(userId: string, input: { title: string }) {
    if (!input.title?.trim()) throw new Error("정산 제목을 입력해주세요.");
    return this.prisma.expenseSettlement.create({
      data: {
        userId,
        title: input.title.trim(),
        status: "DRAFT",
        totalCount: 0,
        totalAmount: 0,
      },
    });
  }

  /**
   * 거래를 정산 묶음에 할당/해제.
   * settlementId === null이면 모든 정산에서 제거.
   * 묶음의 totalCount/totalAmount/periodStart/periodEnd를 자동 재계산.
   */
  async setTransactionSettlement(userId: string, transactionId: string, settlementId: string | null) {
    // 거래 소유권 확인
    const tx = await this.prisma.expenseTransaction.findFirst({
      where: { id: transactionId, userId },
    });
    if (!tx) throw new Error("거래를 찾을 수 없습니다.");

    // 기존 settlement_items 조회 (DRAFT인 정산만 변경 가능)
    const existingItems = await this.prisma.expenseSettlementItem.findMany({
      where: { transactionId },
      include: { settlement: true },
    });
    const affectedSettlementIds = new Set<string>();

    for (const item of existingItems) {
      if (item.settlement.status !== "DRAFT") {
        throw new Error(`이미 ${item.settlement.status === "SUBMITTED" ? "결재 진행 중" : "정산이 완료된"} 거래는 변경할 수 없습니다.`);
      }
      affectedSettlementIds.add(item.settlementId);
    }

    // 기존 items 모두 삭제
    if (existingItems.length > 0) {
      await this.prisma.expenseSettlementItem.deleteMany({
        where: { transactionId },
      });
    }

    // 새 정산에 추가
    if (settlementId) {
      const settlement = await this.prisma.expenseSettlement.findFirst({
        where: { id: settlementId, userId },
      });
      if (!settlement) throw new Error("정산 묶음을 찾을 수 없습니다.");
      if (settlement.status !== "DRAFT") throw new Error("DRAFT 상태의 정산에만 추가할 수 있습니다.");
      await this.prisma.expenseSettlementItem.create({
        data: { settlementId, transactionId, sortOrder: 0 },
      });
      affectedSettlementIds.add(settlementId);
    }

    // 영향받은 정산 묶음들의 totalCount/totalAmount/period 재계산
    for (const sId of affectedSettlementIds) {
      await this.recomputeSettlement(sId);
    }

    return { success: true };
  }

  /**
   * 정산 묶음의 totalCount/totalAmount/periodStart/periodEnd 재계산.
   */
  private async recomputeSettlement(settlementId: string) {
    const items = await this.prisma.expenseSettlementItem.findMany({
      where: { settlementId },
      include: { transaction: true },
    });

    if (items.length === 0) {
      await this.prisma.expenseSettlement.update({
        where: { id: settlementId },
        data: { totalCount: 0, totalAmount: 0, periodStart: null, periodEnd: null },
      });
      return;
    }

    const amounts = items.map((it) => Number(it.transaction.amount));
    const dates = items.map((it) => it.transaction.transactedAt.getTime());
    await this.prisma.expenseSettlement.update({
      where: { id: settlementId },
      data: {
        totalCount: items.length,
        totalAmount: amounts.reduce((s, n) => s + n, 0),
        periodStart: new Date(Math.min(...dates)),
        periodEnd: new Date(Math.max(...dates)),
      },
    });
  }

  /**
   * 결재 상신 — DRAFT → SUBMITTED.
   * approval-service의 EXPENSE_CLAIM 양식으로 문서 생성 + approvalDocumentId 저장.
   */
  async submit(userId: string, id: string) {
    const s = await this.get(userId, id);
    assertTransition(s.status, "SUBMITTED");
    if (s.totalCount === 0) throw new Error("정산할 거래가 없습니다.");

    // approval-service 호출 — period가 null이면 거래 transactedAt에서 추정
    const txDates = s.items.map((it) => it.transaction.transactedAt.getTime());
    const periodStart = s.periodStart ?? (txDates.length > 0 ? new Date(Math.min(...txDates)) : new Date());
    const periodEnd = s.periodEnd ?? (txDates.length > 0 ? new Date(Math.max(...txDates)) : new Date());
    const docId = await this.approvalClient.createExpenseClaimDocument({
      userId,
      settlementId: s.id,
      title: s.title,
      periodStart,
      periodEnd,
      totalAmount: Number(s.totalAmount ?? 0),
      categoryStats: (s.categoryStats as any) ?? {},
      items: s.items.map((it) => {
        const confirmed = it.transaction.matches?.find((m: any) => m.confirmedAt);
        return {
          transactedAt: it.transaction.transactedAt,
          merchantName: it.transaction.merchantName,
          categoryName: it.transaction.category?.name ?? "기타",
          amount: Number(it.transaction.amount),
          memo: it.memoOverride ?? it.transaction.memo ?? "",
          receiptFileName: confirmed?.receipt?.originalFileName ?? null,
        };
      }),
    });

    const [updated] = await this.prisma.$transaction([
      this.prisma.expenseSettlement.update({
        where: { id },
        data: {
          status: "SUBMITTED",
          submittedAt: new Date(),
          approvalDocumentId: docId,
        },
      }),
      this.prisma.expenseTransaction.updateMany({
        where: { id: { in: s.items.map((it) => it.transactionId) } },
        data: { status: "SETTLED" },
      }),
    ]);

    // 영수증 파일을 결재 문서 첨부로 업로드 (matched + confirmed 만)
    void this.attachReceiptsToDocument(s, docId, userId);

    void publishActivity({
      action: "expense.settlement.submitted",
      userId,
      entityType: "expense_settlement",
      entityId: id,
      description: `경비정산 결재 상신 — ${s.title}`,
      metadata: { approvalDocumentId: docId, totalAmount: Number(s.totalAmount ?? 0) },
    });

    return updated;
  }

  /**
   * 결재 상신 후 비동기로 영수증 파일을 결재 첨부로 복사 업로드.
   * fire-and-forget — 첨부 실패해도 상신은 성공 (로그만 남김).
   */
  private async attachReceiptsToDocument(
    s: Awaited<ReturnType<SettlementService["get"]>>,
    documentId: string,
    userId: string,
  ) {
    for (const it of s.items) {
      const confirmed = it.transaction.matches?.find((m: any) => m.confirmedAt);
      if (!confirmed?.receipt) continue;
      try {
        const diskPath = this.storage.resolveDiskPath(confirmed.receipt.storageKey);
        const buf = await fs.readFile(diskPath);
        await this.approvalClient.attachReceipt({
          documentId,
          uploadedBy: userId,
          fileName: confirmed.receipt.originalFileName,
          fileBuffer: buf,
          mimeType: confirmed.receipt.fileType,
        });
      } catch (err: any) {
        console.error(`[settlement] attach receipt ${confirmed.receipt.id} failed: ${err.message}`);
      }
    }
  }

  /**
   * 결재 결과 sync — approval webhook으로부터 호출 (Internal API).
   * SUBMITTED → APPROVED 또는 REJECTED.
   */
  async syncFromApproval(approvalDocumentId: string, result: { status: "APPROVED" | "REJECTED"; reason?: string }) {
    const s = await this.prisma.expenseSettlement.findFirst({
      where: { approvalDocumentId },
    });
    if (!s) throw new Error(`approval document=${approvalDocumentId} 와 연결된 정산서 없음`);
    if (s.status !== "SUBMITTED") {
      // idempotent — 이미 처리됨
      return s;
    }

    if (result.status === "APPROVED") {
      assertTransition(s.status, "APPROVED");
      const updated = await this.prisma.expenseSettlement.update({
        where: { id: s.id },
        data: { status: "APPROVED", approvedAt: new Date() },
      });
      void publishActivity({
        action: "expense.settlement.approved",
        userId: s.userId,
        entityType: "expense_settlement",
        entityId: s.id,
        description: `경비정산 결재 완료 — ${s.title}`,
        metadata: { approvalDocumentId },
      });
      return updated;
    } else {
      assertTransition(s.status, "REJECTED");
      await this.prisma.expenseTransaction.updateMany({
        where: { settlementItems: { some: { settlementId: s.id } }, status: "SETTLED" },
        data: { status: "CATEGORIZED" },
      });
      const updated = await this.prisma.expenseSettlement.update({
        where: { id: s.id },
        data: {
          status: "REJECTED",
          rejectedAt: new Date(),
          rejectReason: result.reason ?? null,
        },
      });
      void publishActivity({
        action: "expense.settlement.rejected",
        userId: s.userId,
        entityType: "expense_settlement",
        entityId: s.id,
        description: `경비정산 반려 — ${s.title}`,
        metadata: { approvalDocumentId, reason: result.reason },
      });
      return updated;
    }
  }

  /** 재무팀 접수 — APPROVED → RECEIVED */
  async receive(receiverUserId: string, id: string) {
    const s = await this.prisma.expenseSettlement.findUnique({ where: { id } });
    if (!s) throw new Error("정산서를 찾을 수 없습니다.");
    assertTransition(s.status, "RECEIVED");
    const updated = await this.prisma.expenseSettlement.update({
      where: { id },
      data: { status: "RECEIVED", receivedAt: new Date(), receivedById: receiverUserId },
    });
    void publishActivity({
      action: "expense.settlement.received",
      userId: s.userId,
      entityType: "expense_settlement",
      entityId: id,
      description: `재무팀 접수 — ${s.title}`,
      metadata: { receivedBy: receiverUserId },
    });
    return updated;
  }

  /** 재무팀 입금 완료 — RECEIVED → PAID */
  async pay(payerUserId: string, id: string, data: { paidAt?: Date; paidAmount?: number; paidNote?: string }) {
    const s = await this.prisma.expenseSettlement.findUnique({ where: { id } });
    if (!s) throw new Error("정산서를 찾을 수 없습니다.");
    assertTransition(s.status, "PAID");
    const paidAmount = data.paidAmount ?? Number(s.totalAmount ?? 0);
    const updated = await this.prisma.expenseSettlement.update({
      where: { id },
      data: {
        status: "PAID",
        paidAt: data.paidAt ?? new Date(),
        paidById: payerUserId,
        paidAmount,
        paidNote: data.paidNote ?? null,
      },
    });
    void publishActivity({
      action: "expense.settlement.paid",
      userId: s.userId,
      entityType: "expense_settlement",
      entityId: id,
      description: `입금 완료 — ${s.title} (${paidAmount.toLocaleString()}원)`,
      metadata: { paidBy: payerUserId, paidAmount },
    });
    return updated;
  }

  /** 재무팀 큐: APPROVED + RECEIVED 정산 목록 (전사) */
  async listFinanceQueue(params: { status?: SettlementStatus; page?: number; limit?: number } = {}) {
    const { status, page = 1, limit = 50 } = params;
    const where: any = {};
    if (status) where.status = status;
    else where.status = { in: ["APPROVED", "RECEIVED"] };

    const [items, total] = await Promise.all([
      this.prisma.expenseSettlement.findMany({
        where,
        orderBy: { approvedAt: "asc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.expenseSettlement.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  /** 내대시보드 카드용 요약 */
  async meSummary(userId: string) {
    const [unmatched, pendingApproval, awaitingPayment] = await Promise.all([
      this.prisma.expenseTransaction.count({
        where: { userId, status: "PENDING", isCanceled: false },
      }),
      this.prisma.expenseSettlement.count({ where: { userId, status: "SUBMITTED" } }),
      this.prisma.expenseSettlement.count({
        where: { userId, status: { in: ["APPROVED", "RECEIVED"] } },
      }),
    ]);
    return { unmatched, pendingApproval, awaitingPayment };
  }
}
