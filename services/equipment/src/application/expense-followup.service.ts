import { PrismaClient, ExpenseFollowUpStatus } from "@prisma/client";
import { InboundRequestService } from "./inbound-request.service.js";

export class ExpenseFollowUpService {
  constructor(
    private prisma: PrismaClient,
    private inboundRequestService: InboundRequestService,
  ) {}

  /** 후속처리 목록 (결재문서 정보 포함) */
  async list(params: { status?: ExpenseFollowUpStatus; sortBy?: string; sortOrder?: "asc" | "desc" }) {
    const sortOrder = params.sortOrder ?? "desc";
    // v1.6 (2026-05-13)
    const SORTABLE: Record<string, any> = {
      status: { status: sortOrder },
      isInventoryTarget: { isInventoryTarget: sortOrder },
      receivedAt: { receivedAt: sortOrder },
      arrivalDate: { arrivalDate: sortOrder },
      paymentCompletedAt: { paymentCompletedAt: sortOrder },
      createdAt: { createdAt: sortOrder },
    };
    const orderBy = params.sortBy && SORTABLE[params.sortBy] ? SORTABLE[params.sortBy] : { createdAt: "desc" };

    const items = await this.prisma.expenseFollowUp.findMany({
      where: params.status ? { status: params.status } : {},
      orderBy,
    });

    // 결재문서 상세 일괄 조회
    const docIds = items.map((i) => i.approvalDocumentId).filter(Boolean);
    const docMap = await this.fetchApprovalDocuments(docIds);

    return items.map((item) => ({
      ...item,
      approvalDocument: docMap[item.approvalDocumentId] || null,
    }));
  }

  /** 후속처리 상세 (결재문서 정보 포함) */
  async getById(id: string) {
    const item = await this.prisma.expenseFollowUp.findUnique({ where: { id } });
    if (!item) throw new Error("후속처리를 찾을 수 없습니다.");

    const docMap = await this.fetchApprovalDocuments([item.approvalDocumentId]);
    return {
      ...item,
      approvalDocument: docMap[item.approvalDocumentId] || null,
    };
  }

  /** 재무 접수 (결재 승인 후 자동 생성) */
  async createFromApproval(data: { approvalDocumentId: string; receivedBy: string }) {
    return this.prisma.expenseFollowUp.create({
      data: {
        approvalDocumentId: data.approvalDocumentId,
        status: "FINANCE_RECEIVED",
        receivedBy: data.receivedBy,
        receivedAt: new Date(),
      },
    });
  }

  /**
   * 재고 판정 (개별 아이템별).
   * 재고 대상이면 InboundRequest를 PENDING 상태로 자동 생성 (v1.6, 2026-05-13).
   * 도착 처리 단계 폐기 — 자재 담당자가 /procurement/inbound 큐에서 receive하면
   * 그 시점에 InventoryItem + ExpenseFollowUp.status=COMPLETED 자동 동기화.
   */
  async decideInventory(id: string, data: {
    isInventoryTarget: boolean;
    inventoryDecisionBy: string;
    inventoryDecisionNote?: string;
    inventoryItems?: number[]; // 재고 대상 아이템 인덱스 배열
  }) {
    const followUp = await this.prisma.expenseFollowUp.findUnique({ where: { id } });
    if (!followUp) throw new Error("후속처리를 찾을 수 없습니다.");

    return this.prisma.$transaction(async (tx) => {
      // 재고 비대상 → 곧바로 COMPLETED
      // 재고 대상 → INVENTORY_DECIDED (InboundRequest receive 후 COMPLETED 전환)
      const nextStatus: ExpenseFollowUpStatus = data.isInventoryTarget
        ? "INVENTORY_DECIDED"
        : "COMPLETED";

      const updated = await tx.expenseFollowUp.update({
        where: { id },
        data: {
          status: nextStatus,
          isInventoryTarget: data.isInventoryTarget,
          inventoryDecisionBy: data.inventoryDecisionBy,
          inventoryDecisionAt: new Date(),
          inventoryDecisionNote: data.inventoryDecisionNote ?? null,
          ...(data.inventoryItems && {
            notes: JSON.stringify({ inventoryItemIndices: data.inventoryItems }),
          }),
        },
      });

      // 재고 대상일 때만 InboundRequest 생성
      if (data.isInventoryTarget) {
        // 기존 PENDING InboundRequest가 있으면 (재판정 시나리오) skip
        const existing = await tx.inboundRequest.findFirst({
          where: {
            sourceType: "EXPENSE_FOLLOWUP",
            sourceId: id,
            status: "PENDING",
          },
        });
        if (!existing) {
          // 결재문서에서 expense items 매핑
          const doc = (await this.fetchApprovalDocuments([followUp.approvalDocumentId]))[followUp.approvalDocumentId];
          const allItems: any[] = Array.isArray(doc?.itemsData) ? doc.itemsData : [];
          const selectedIndices = data.inventoryItems && data.inventoryItems.length > 0
            ? data.inventoryItems
            : allItems.map((_, i) => i); // 인덱스 미지정 시 전체

          const items: Array<{ description?: string; quantity: number; unitPrice?: number; completenessFlag: "MANUAL_NEEDED" }> =
            selectedIndices
              .map((idx) => allItems[idx])
              .filter((it): it is Record<string, any> => !!it)
              .map((it) => {
                const out: { description?: string; quantity: number; unitPrice?: number; completenessFlag: "MANUAL_NEEDED" } = {
                  quantity: typeof it.quantity === "number" ? it.quantity : 1,
                  completenessFlag: "MANUAL_NEEDED",
                };
                if (it.description) out.description = String(it.description);
                if (it.unitPrice !== undefined && it.unitPrice !== null) out.unitPrice = Number(it.unitPrice);
                return out;
              })
              .filter((it) => it.description || it.quantity);

          // expense items 매핑 실패해도 placeholder 1건 생성 (자재 담당자가 수정)
          const itemsForCreate: Array<{ description?: string; quantity: number; unitPrice?: number; completenessFlag: "MANUAL_NEEDED" }> =
            items.length > 0
              ? items
              : [{
                  description: data.inventoryDecisionNote || "재고 판정",
                  quantity: 1,
                  completenessFlag: "MANUAL_NEEDED",
                }];

          const docNumber = doc?.documentNo || doc?.title;
          await this.inboundRequestService.create({
            sourceType: "EXPENSE_FOLLOWUP",
            sourceId: id,
            requesterId: data.inventoryDecisionBy,
            ...(docNumber && { sourceDocNumber: String(docNumber) }),
            ...(data.inventoryDecisionNote && {
              notes: `재고 판정 메모: ${data.inventoryDecisionNote}`,
            }),
            items: itemsForCreate.map((it) => ({
              ...(it.description && { description: it.description }),
              quantity: it.quantity,
              ...(it.unitPrice !== undefined && { unitPrice: it.unitPrice }),
              completenessFlag: it.completenessFlag,
            })),
          });
        }
      }

      return updated;
    });
  }

  // confirmArrival() 폐기 (v1.6, 2026-05-13):
  //   재고 판정 시점에 InboundRequest 자동 생성 → 자재 담당자가 입고 큐에서 receive 처리.
  //   receive 트랜잭션 안에서 expense_follow_ups.status=COMPLETED + inventoryItemId 동기화됨.

  /** 송금 처리 — 입고와 독립적으로 체크 가능 */
  async markPayment(id: string, data: {
    paidAt: string;
    paidAmount?: number;
    paidNote?: string;
    paidBy: string;
  }) {
    const followUp = await this.prisma.expenseFollowUp.findUnique({ where: { id } });
    if (!followUp) throw new Error("후속처리를 찾을 수 없습니다.");

    const updated = await this.prisma.expenseFollowUp.update({
      where: { id },
      data: {
        paymentCompletedAt: new Date(data.paidAt),
        paymentAmount: data.paidAmount ?? null,
        paymentNote: data.paidNote ?? null,
        paymentBy: data.paidBy,
      },
    });

    // EXPENSE_SETTLEMENT 인 경우 expense-service settlement도 PAID로 동기화 (기안자에게 알림)
    void this.syncSettlementPayment(followUp.approvalDocumentId, "MARK", {
      paidAt: data.paidAt,
      ...(data.paidAmount !== undefined && { paidAmount: data.paidAmount }),
      ...(data.paidNote && { paidNote: data.paidNote }),
      paidById: data.paidBy,
    });

    return updated;
  }

  /** 송금 처리 해제 */
  async clearPayment(id: string) {
    const followUp = await this.prisma.expenseFollowUp.findUnique({ where: { id } });
    const updated = await this.prisma.expenseFollowUp.update({
      where: { id },
      data: {
        paymentCompletedAt: null,
        paymentAmount: null,
        paymentNote: null,
        paymentBy: null,
      },
    });

    if (followUp) {
      void this.syncSettlementPayment(followUp.approvalDocumentId, "CLEAR");
    }
    return updated;
  }

  /**
   * EXPENSE_SETTLEMENT 결재인 경우 expense-service settlement 상태 동기화.
   * 결재 문서의 referenceType을 approval-service에서 조회 후 분기.
   */
  private async syncSettlementPayment(
    approvalDocumentId: string,
    action: "MARK" | "CLEAR",
    payload?: { paidAt?: string; paidAmount?: number; paidNote?: string; paidById?: string },
  ): Promise<void> {
    try {
      const approvalUrl = process.env.APPROVAL_SERVICE_URL || "http://approval-service:3006";
      const expenseUrl = process.env.EXPENSE_SERVICE_URL || "http://expense-service:3008";
      const token = process.env.INTERNAL_API_TOKEN as string;

      // 결재 문서 referenceType 조회
      const docResp = await fetch(`${approvalUrl}/internal/documents/${approvalDocumentId}`, {
        headers: { "X-Internal-Token": token },
      });
      if (!docResp.ok) return;
      const doc = (await docResp.json()) as { referenceType?: string };
      if (doc.referenceType !== "EXPENSE_SETTLEMENT") return;

      // expense-service 동기화 호출
      if (action === "MARK") {
        await fetch(`${expenseUrl}/internal/settlements/from-payment`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Internal-Token": token },
          body: JSON.stringify({ approvalDocumentId, ...payload }),
        });
      } else {
        await fetch(`${expenseUrl}/internal/settlements/from-payment`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json", "X-Internal-Token": token },
          body: JSON.stringify({ approvalDocumentId }),
        });
      }
    } catch (err: any) {
      console.error(`[expense-followup] settlement sync failed: ${err.message}`);  
    }
  }

  // ─── Private ─────────────────────────────────────────────────────────

  /** approval-service에서 결재문서 정보 일괄 조회 */
  private async fetchApprovalDocuments(docIds: string[]): Promise<Record<string, any>> {
    if (docIds.length === 0) return {};

    const approvalUrl = process.env.APPROVAL_SERVICE_URL || "http://approval-service:3006";
    // 보안 일괄패치 PDCA Layer 1 (C3): startup-time Zod env 검증으로 보장
    const token = process.env.INTERNAL_API_TOKEN as string;
    const result: Record<string, any> = {};

    for (const docId of docIds) {
      try {
        const resp = await fetch(`${approvalUrl}/internal/documents/${docId}`, {
          headers: { "X-Internal-Token": token },
        });
        if (resp.ok) {
          result[docId] = await resp.json();
        }
      } catch { /* ignore */ }
    }
    return result;
  }
}
