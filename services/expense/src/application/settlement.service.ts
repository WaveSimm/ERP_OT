// 정산서 도메인 + 6단계 상태머신 (Design §4)
//   DRAFT → SUBMITTED → APPROVED → RECEIVED → PAID
//                    └→ REJECTED

import type { PrismaClient, SettlementStatus } from "@prisma/client";
import type { ApprovalClient } from "../infrastructure/approval-client";
import { publishActivity } from "../infrastructure/event-publisher";

export interface ListSettlementParams {
  status?: SettlementStatus;
  page?: number;
  limit?: number;
}

// FSM 전이 규칙
// 2026-05-12: 결재 후속 통합으로 RECEIVED 단계 사실상 생략. APPROVED → PAID 직접 전이 허용 (재무 접수 모듈에서 송금 처리 시).
const TRANSITIONS: Record<SettlementStatus, SettlementStatus[]> = {
  DRAFT: ["SUBMITTED"],
  SUBMITTED: ["APPROVED", "REJECTED", "DRAFT"], // DRAFT는 작성자 취소
  APPROVED: ["RECEIVED", "PAID"],
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
                source: { select: { id: true, name: true, displayName: true, type: true, ownership: true } },
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

  /** 엑셀 export 전용 — 매칭된 영수증을 확정 여부 무관하게 전부 로드(확정 우선 정렬). */
  async getForExport(userId: string, id: string) {
    const s = await this.prisma.expenseSettlement.findFirst({
      where: { id, userId },
      include: {
        items: {
          include: {
            transaction: {
              include: {
                source: true,
                matches: { include: { receipt: true }, orderBy: { confirmedAt: "desc" } },
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

  /** 정산묶음 제목 수정 (PAID/APPROVED/RECEIVED 제외) */
  async updateTitle(userId: string, id: string, title: string) {
    const s = await this.get(userId, id);
    if (["APPROVED", "RECEIVED", "PAID"].includes(s.status)) {
      throw new Error("결재 완료/입금된 정산의 제목은 변경할 수 없습니다.");
    }
    return this.prisma.expenseSettlement.update({
      where: { id },
      data: { title: title.trim() },
    });
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

    // 2026-06-12: 상태 기준 = 정산분류(정산묶음 배정). 배정→정산분류완료(CATEGORIZED), 해제→미정산분류(PENDING).
    //   CANCELED/SETTLED은 별도 흐름이라 건드리지 않음. (EXCLUDED는 호출측에서 별도 지정)
    if (!["CANCELED", "SETTLED"].includes(tx.status)) {
      await this.prisma.expenseTransaction.update({
        where: { id: transactionId },
        data: { status: settlementId ? "CATEGORIZED" : "PENDING" },
      });
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
   * v1.6.4 (2026-05-16): 결재 분리 — settlement에서 직접 상신하지 않음.
   * approval-service가 결재 문서 생성 후 이 메서드 호출하여 연결.
   * userId 검증 없음 — internal endpoint에서 호출 (approval webhook).
   */
  async linkApproval(settlementId: string, approvalDocumentId: string) {
    const s = await this.prisma.expenseSettlement.findUnique({ where: { id: settlementId } });
    if (!s) throw new Error(`정산 묶음을 찾을 수 없습니다: ${settlementId}`);
    if (s.status !== "DRAFT" && s.status !== "REJECTED") {
      throw new Error(`현재 ${s.status} 상태인 정산 묶음은 결재에 연결할 수 없습니다. 기존 결재를 먼저 해제하세요.`);
    }
    if (s.totalCount === 0) throw new Error("정산할 거래가 없습니다.");

    const items = await this.prisma.expenseSettlementItem.findMany({
      where: { settlementId },
      select: { transactionId: true },
    });

    const [updated] = await this.prisma.$transaction([
      this.prisma.expenseSettlement.update({
        where: { id: settlementId },
        data: {
          status: "SUBMITTED",
          submittedAt: new Date(),
          approvalDocumentId,
          // 반려에서 새 결재로 가는 경우 reject 정보 초기화
          rejectedAt: null,
          rejectReason: null,
        },
      }),
      this.prisma.expenseTransaction.updateMany({
        where: { id: { in: items.map((it) => it.transactionId) } },
        data: { status: "SETTLED" },
      }),
    ]);

    void publishActivity({
      action: "expense.settlement.linked",
      userId: s.userId,
      entityType: "expense_settlement",
      entityId: settlementId,
      description: `경비정산 결재 연결 — ${s.title}`,
      metadata: { approvalDocumentId, totalAmount: Number(s.totalAmount ?? 0) },
    });

    return updated;
  }

  /**
   * v1.6.4 (2026-05-16): 결재 문서 삭제 시 settlement 연결 해제.
   * approval-service의 결재 삭제 webhook에서 호출.
   * 거래 status는 CATEGORIZED로 복귀 (정산 묶음에는 그대로 유지).
   */
  async unlinkApproval(approvalDocumentId: string) {
    const s = await this.prisma.expenseSettlement.findFirst({
      where: { approvalDocumentId },
    });
    if (!s) return null;

    const items = await this.prisma.expenseSettlementItem.findMany({
      where: { settlementId: s.id },
      select: { transactionId: true },
    });

    const [updated] = await this.prisma.$transaction([
      this.prisma.expenseSettlement.update({
        where: { id: s.id },
        data: {
          status: "DRAFT",
          submittedAt: null,
          approvalDocumentId: null,
          rejectedAt: null,
          rejectReason: null,
        },
      }),
      this.prisma.expenseTransaction.updateMany({
        where: { id: { in: items.map((it) => it.transactionId) }, status: "SETTLED" },
        data: { status: "CATEGORIZED" },
      }),
    ]);

    void publishActivity({
      action: "expense.settlement.unlinked",
      userId: s.userId,
      entityType: "expense_settlement",
      entityId: s.id,
      description: `경비정산 결재 해제 — ${s.title}`,
      metadata: { approvalDocumentId },
    });

    return updated;
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

  /**
   * 재무 후속 모듈(equipment-service) 송금 처리 → settlement.PAID 동기화.
   * 2026-05-12 신규: 결재 후속 통합으로 재무팀 큐 대신 followup에서 처리.
   */
  async syncFromPayment(approvalDocumentId: string, data: {
    paidAt?: string;
    paidAmount?: number;
    paidNote?: string;
    paidById?: string;
  }) {
    const s = await this.prisma.expenseSettlement.findFirst({
      where: { approvalDocumentId },
    });
    if (!s) throw new Error(`approval document=${approvalDocumentId} 와 연결된 정산서 없음`);
    if (s.status === "PAID") return s; // idempotent
    // APPROVED 또는 RECEIVED 에서 PAID 직접 전이
    if (!["APPROVED", "RECEIVED"].includes(s.status)) {
      throw new Error(`잘못된 상태에서 송금 처리: ${s.status}`);
    }
    const updated = await this.prisma.expenseSettlement.update({
      where: { id: s.id },
      data: {
        status: "PAID",
        paidAt: data.paidAt ? new Date(data.paidAt) : new Date(),
        paidAmount: data.paidAmount ?? null,
        paidNote: data.paidNote ?? null,
        paidById: data.paidById ?? null,
        // RECEIVED 거치지 않은 경우 receivedAt도 기록 (timeline 완성용)
        ...(s.status === "APPROVED" && {
          receivedAt: new Date(),
          receivedById: data.paidById ?? null,
        }),
      },
    });
    void publishActivity({
      action: "expense.settlement.paid",
      userId: s.userId,
      entityType: "expense_settlement",
      entityId: s.id,
      description: `경비정산 입금 완료 — ${s.title}`,
      metadata: { approvalDocumentId, amount: data.paidAmount },
    });
    return updated;
  }

  /** 송금 처리 해제 — PAID → APPROVED 롤백 */
  async clearPaymentSync(approvalDocumentId: string) {
    const s = await this.prisma.expenseSettlement.findFirst({
      where: { approvalDocumentId },
    });
    if (!s) return null;
    if (s.status !== "PAID") return s;
    return this.prisma.expenseSettlement.update({
      where: { id: s.id },
      data: {
        status: "APPROVED",
        paidAt: null,
        paidAmount: null,
        paidNote: null,
        paidById: null,
        receivedAt: null,
        receivedById: null,
      },
    });
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

  /** 내대시보드 카드용 요약 — 5단계: 미내역분류·미정산분류·미결재·정산됨·입금완료 */
  async meSummary(userId: string) {
    const [unclassified, unsettled, unapproved, settled, paid] = await Promise.all([
      // 1. 미내역분류 = status=PENDING
      this.prisma.expenseTransaction.count({
        where: { userId, status: "PENDING", isCanceled: false },
      }),
      // 2. 미정산분류 = CATEGORIZED + 정산묶음 없음
      this.prisma.expenseTransaction.count({
        where: { userId, status: "CATEGORIZED", isCanceled: false, settlementItems: { none: {} } },
      }),
      // 3. 미결재 = CATEGORIZED + 정산묶음 DRAFT 또는 REJECTED
      this.prisma.expenseTransaction.count({
        where: {
          userId, status: "CATEGORIZED", isCanceled: false,
          settlementItems: { some: { settlement: { status: { in: ["DRAFT", "REJECTED"] } } } },
        },
      }),
      // 4. 정산됨 = SETTLED 전체 (SUBMITTED/APPROVED/RECEIVED/PAID 모두 — 4단계 진행 표시용)
      this.prisma.expenseTransaction.count({
        where: {
          userId, status: "SETTLED", isCanceled: false,
          settlementItems: { some: { settlement: { status: { in: ["SUBMITTED", "APPROVED", "RECEIVED", "PAID"] } } } },
        },
      }),
      // 5. 입금완료 = SETTLED + 정산묶음 PAID (정산됨의 부분집합)
      this.prisma.expenseTransaction.count({
        where: {
          userId, status: "SETTLED", isCanceled: false,
          settlementItems: { some: { settlement: { status: "PAID" } } },
        },
      }),
    ]);
    return { unclassified, unsettled, unapproved, settled, paid };
  }
}
