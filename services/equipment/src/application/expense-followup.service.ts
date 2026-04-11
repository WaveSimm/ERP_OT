import { PrismaClient, ExpenseFollowUpStatus } from "@prisma/client";

export class ExpenseFollowUpService {
  constructor(private prisma: PrismaClient) {}

  /** 후속처리 목록 (결재문서 정보 포함) */
  async list(params: { status?: ExpenseFollowUpStatus }) {
    const items = await this.prisma.expenseFollowUp.findMany({
      where: params.status ? { status: params.status } : {},
      orderBy: { createdAt: "desc" },
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

  /** 재고 판정 (개별 아이템별) */
  async decideInventory(id: string, data: {
    isInventoryTarget: boolean;
    inventoryDecisionBy: string;
    inventoryDecisionNote?: string;
    inventoryItems?: number[]; // 재고 대상 아이템 인덱스 배열
  }) {
    return this.prisma.expenseFollowUp.update({
      where: { id },
      data: {
        status: "INVENTORY_DECIDED",
        isInventoryTarget: data.isInventoryTarget,
        inventoryDecisionBy: data.inventoryDecisionBy,
        inventoryDecisionAt: new Date(),
        inventoryDecisionNote: data.inventoryDecisionNote ?? null,
        // inventoryItems 인덱스를 notes에 JSON으로 저장
        ...(data.inventoryItems && {
          notes: JSON.stringify({ inventoryItemIndices: data.inventoryItems }),
        }),
      },
    });
  }

  /** 입고 확인 + 재고 자동 생성 */
  async confirmArrival(id: string, data: {
    arrivalDate: string;
    arrivalLocation?: string;
    confirmedBy: string;
  }) {
    const followUp = await this.prisma.expenseFollowUp.findUnique({ where: { id } });
    if (!followUp) throw new Error("후속처리를 찾을 수 없습니다.");

    return this.prisma.$transaction(async (tx) => {
      const updateData: any = {
        status: followUp.isInventoryTarget ? "ARRIVED" as const : "COMPLETED" as const,
        arrivalDate: new Date(data.arrivalDate),
        arrivalLocation: data.arrivalLocation ?? null,
        confirmedBy: data.confirmedBy,
      };

      // 재고 대상이면 자동으로 재고 생성
      if (followUp.isInventoryTarget) {
        const last = await tx.inventoryItem.findFirst({ orderBy: { createdAt: "desc" } });
        let seq = 1;
        if (last) {
          const m = last.inventoryNo.match(/^E(\d+)/);
          if (m && m[1]) seq = parseInt(m[1], 10) + 1;
        }
        const inventoryNo = `E${String(seq).padStart(5, "0")}`;

        const invItem = await tx.inventoryItem.create({
          data: {
            inventoryNo,
            category: "PRODUCT",
            currentLocation: data.arrivalLocation || "본사 창고",
            currentStatus: "IN_STOCK",
            sourceType: "EXPENSE_REQUEST",
            sourceId: followUp.approvalDocumentId,
            totalAdditionalCost: 0,
            totalCostOfOwnership: 0,
            createdBy: data.confirmedBy,
          },
        });

        updateData.inventoryItemId = invItem.id;
        updateData.status = "COMPLETED";
      }

      return tx.expenseFollowUp.update({ where: { id }, data: updateData });
    });
  }

  // ─── Private ─────────────────────────────────────────────────────────

  /** approval-service에서 결재문서 정보 일괄 조회 */
  private async fetchApprovalDocuments(docIds: string[]): Promise<Record<string, any>> {
    if (docIds.length === 0) return {};

    const approvalUrl = process.env.APPROVAL_SERVICE_URL || "http://approval-service:3006";
    const token = process.env.INTERNAL_API_TOKEN || "";
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
