import { PrismaClient, OrderStatus, OrderItemReceiptStatus } from "@prisma/client";
import { assertTransition, getAllowedTransitions } from "../../domain/state-machine/order.fsm.js";

export class OverseasOrderService {
  constructor(private prisma: PrismaClient) {}

  async list(params: {
    search?: string; status?: OrderStatus | string; currency?: string;
    orderType?: string; contractId?: string; page?: number; limit?: number;
    sortBy?: string; sortOrder?: "asc" | "desc";
    hasPayment?: boolean;  // v1.6 (2026-05-14): 송금 요청·완료 발주만 (회계정산 리스트)
  } = {}) {
    const { search, status, currency, orderType, contractId, page = 1, limit = 50, sortBy, sortOrder = "desc", hasPayment } = params;
    const where: any = {};

    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: "insensitive" } },
        { manufacturer: { contains: search, mode: "insensitive" } },
        { invoiceNo: { contains: search, mode: "insensitive" } },
      ];
    }
    // v1.6 (2026-05-14): status 콤마 분리 다중값 지원 (예: "PARTIALLY_RECEIVED,ARRIVED")
    if (status) {
      const arr = String(status).split(",").map((s) => s.trim()).filter(Boolean);
      where.status = arr.length > 1 ? { in: arr } : (arr[0] as any);
    }
    if (currency) where.currency = currency;
    if (orderType) where.orderType = orderType;
    if (contractId) where.contractId = contractId;
    // v1.6 (2026-05-14): 송금 요청·완료 내역이 있는 발주만 (회계정산 리스트)
    if (hasPayment) where.payments = { some: {} };

    // v1.6 (2026-05-13)
    const SORTABLE: Record<string, any> = {
      orderNumber: { orderNumber: sortOrder },
      manufacturer: { manufacturer: sortOrder },
      status: { status: sortOrder },
      orderDate: { orderDate: sortOrder },
      estimatedShipDate: { estimatedShipDate: sortOrder },
      actualShipDate: { actualShipDate: sortOrder },
      totalAmount: { totalAmount: sortOrder },
      totalAmountKRW: { totalAmountKRW: sortOrder },
      createdAt: { createdAt: sortOrder },
    };
    const orderBy = sortBy && SORTABLE[sortBy] ? SORTABLE[sortBy] : { createdAt: "desc" };

    const [items, total] = await Promise.all([
      this.prisma.overseasOrder.findMany({
        where,
        include: {
          contract: { select: { id: true, contractNumber: true, name: true } },
          _count: { select: { items: true } },
          // v1.6 (2026-05-14): 송금 현황 표시용 — payment status 집계 (목록에서만)
          payments: { select: { status: true, amount: true } },
          // v1.6 (2026-05-14): 첫 품목명 표시용 — 등록 순서대로 첫 번째 1건만
          items: { select: { name: true }, orderBy: { createdAt: "asc" }, take: 1 },
          // v1.6.1 (2026-05-15): 발주상태 컬럼에 세금납부대기/완료 표시용
          customsTax: { select: { status: true } },
        },
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.overseasOrder.count({ where }),
    ]);

    // 송금 요약 + 첫 품목명 가공
    const itemsWithSummary = items.map((o: any) => {
      const ps = o.payments || [];
      const requested = ps.filter((p: any) => p.status === "REQUESTED").length;
      const completed = ps.filter((p: any) => p.status === "COMPLETED").length;
      const rejected = ps.filter((p: any) => p.status === "REJECTED").length;
      const firstItemName = Array.isArray(o.items) && o.items.length > 0 ? o.items[0].name : null;
      return {
        ...o,
        payments: undefined,  // 원본 배열은 응답에서 제거
        items: undefined,     // 마찬가지로 제거 (이름만 추출)
        firstItemName,
        paymentSummary: { requested, completed, rejected, total: ps.length },
      };
    });

    return { items: itemsWithSummary, total, page, limit };
  }

  async getById(id: string) {
    const order = await this.prisma.overseasOrder.findUnique({
      where: { id },
      include: {
        contract: { select: { id: true, contractNumber: true, name: true, client: true } },
        items: {
          include: {
            productMaster: { select: { id: true, name: true } },
            inventoryItems: { select: { id: true, inventoryNo: true, itemName: true, currentStatus: true }, orderBy: { inventoryNo: "asc" } },
          },
          orderBy: { createdAt: "asc" },
        },
        progressLogs: { orderBy: { createdAt: "desc" }, take: 20 },
        customsTax: true,  // v1.6.1 (2026-05-15): 관부가세 정보 포함
        // v1.6.2 (2026-05-18): 수입원가정산서 작성 시 송금 자동 채움
        payments: { where: { status: "COMPLETED" }, orderBy: { paymentDate: "asc" } },
      },
    });
    if (!order) throw new Error("발주를 찾을 수 없습니다.");
    return { ...order, allowedTransitions: getAllowedTransitions(order.status) };
  }

  /**
   * 발주번호 자동 채번 — v1.6 (2026-05-14)
   *   형식: PO-YYMM-NNNN (예: PO-2605-0001)
   *   시퀀스는 월별 리셋. 기존 PO-YYYY-NNNN 데이터는 그대로 유지.
   */
  private async generateOrderNumber(): Promise<string> {
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const prefix = `PO-${yy}${mm}-`;
    const last = await this.prisma.overseasOrder.findFirst({
      where: { orderNumber: { startsWith: prefix } },
      orderBy: { orderNumber: "desc" },
      select: { orderNumber: true },
    });
    const seq = last ? parseInt(last.orderNumber.replace(prefix, ""), 10) + 1 : 1;
    return `${prefix}${String(seq).padStart(4, "0")}`;
  }

  async create(data: {
    contractId: string;
    manufacturer: string;
    currency: string;
    orderedBy: string;
    orderDate?: string;
    estimatedProductionEnd?: string;
    estimatedShipDate?: string;
    arrivalLocation?: string;
    customsHandler?: string;
    invoiceNo?: string;                          // 견적번호 (Quote No)
    paymentTerms?: string;                       // 결제수단 (T/T, L/C, 무역금융 등)
    customer?: string;
    totalAmount: number;
    totalAmountKRW?: number;
    notes?: string;
    // v1.6 (2026-05-14): 결재라인
    // approverName: 사용자 삭제 후에도 결재 히스토리 보존 (2026-05-15)
    approverId?: string;
    approverName?: string;
    secondApproverId?: string;
    secondApproverName?: string;
    thirdApproverId?: string;
    thirdApproverName?: string;
    items?: Array<{
      productMasterId?: string;
      name: string;
      spec?: string;
      quantity: number;
      unitPrice: number;
      amount: number;
      notes?: string;
    }>;
  }) {
    const { items, orderDate, estimatedProductionEnd, estimatedShipDate, ...rest } = data;
    const orderNumber = await this.generateOrderNumber();

    return this.prisma.overseasOrder.create({
      data: {
        ...rest,
        orderNumber,
        status: "DRAFT",
        orderDate: orderDate ? new Date(orderDate) : undefined,
        estimatedProductionEnd: estimatedProductionEnd ? new Date(estimatedProductionEnd) : undefined,
        estimatedShipDate: estimatedShipDate ? new Date(estimatedShipDate) : undefined,
        items: items?.length ? { create: items } : undefined,
      } as any,
      include: {
        items: true,
        contract: { select: { id: true, contractNumber: true, name: true } },
      },
    });
  }

  async update(id: string, data: {
    contractId?: string;
    manufacturer?: string;
    currency?: string;
    orderDate?: string;
    estimatedProductionEnd?: string;
    estimatedShipDate?: string;
    actualShipDate?: string;
    customsDate?: string;
    arrivalDate?: string;
    arrivalLocation?: string;
    customsHandler?: string;
    invoiceNo?: string;                              // 견적번호 (Quote No)
    paymentTerms?: string | null;                    // 결제수단 (T/T, L/C, 무역금융 등)
    customer?: string | null;
    totalAmount?: number;
    totalAmountKRW?: number;
    notes?: string;
    // v1.6 (2026-05-14): 결재라인
    // approverName: 사용자 삭제 후에도 결재 히스토리 보존 (2026-05-15)
    approverId?: string | null;
    approverName?: string | null;
    secondApproverId?: string | null;
    secondApproverName?: string | null;
    thirdApproverId?: string | null;
    thirdApproverName?: string | null;
  }) {
    const order = await this.prisma.overseasOrder.findUnique({ where: { id } });
    if (!order) throw new Error("발주를 찾을 수 없습니다.");
    // CLOSED 발주도 일정·입고장소·통관담당·결제수단은 수정 허용
    if (order.status === "CLOSED") {
      const LOGISTICS_ONLY = new Set(["estimatedShipDate", "arrivalLocation", "customsHandler", "paymentTerms"]);
      const nonLogistics = Object.keys(data).filter((k) => !LOGISTICS_ONLY.has(k) && (data as any)[k] !== undefined);
      if (nonLogistics.length > 0) {
        throw new Error(`마감된 발주는 일정/입고장소/통관담당/결제수단만 수정할 수 있습니다. 시도된 필드: ${nonLogistics.join(", ")}`);
      }
    }

    const dateFields = [
      "orderDate", "estimatedProductionEnd", "estimatedShipDate",
      "actualShipDate", "customsDate", "arrivalDate", "dueDate",
    ] as const;

    const updateData: any = { ...data };
    for (const f of dateFields) {
      if (f in updateData) {
        updateData[f] = updateData[f] ? new Date(updateData[f]) : null;
      }
    }

    return this.prisma.overseasOrder.update({ where: { id }, data: updateData });
  }

  async transition(id: string, toStatus: OrderStatus, userId: string, transitionDate?: string) {
    const order = await this.prisma.overseasOrder.findUnique({ where: { id } });
    if (!order) throw new Error("발주를 찾을 수 없습니다.");

    assertTransition(order.status, toStatus);

    // v1.6.1 (2026-05-15): CUSTOMS → ARRIVED 전이 시 관부가세 PAID 검증
    if (toStatus === "ARRIVED" && order.status === "CUSTOMS") {
      const tax = await this.prisma.orderCustomsTax.findUnique({ where: { orderId: id } });
      if (!tax || tax.status !== "PAID") {
        throw new Error("관부가세 납부가 완료되지 않아 통관 완료할 수 없습니다. (재무팀 처리 대기 중)");
      }
    }

    // v1.6.1 (2026-05-15): 전이별 날짜 컬럼 매핑. transitionDate 있으면 사용, 없으면 today
    //   PURCHASING(발주완료) → orderDate
    //   SHIPPED(선적완료)    → actualShipDate
    //   CUSTOMS(통관)        → customsDate
    const dateValue = transitionDate ? new Date(transitionDate) : new Date();
    const dateUpdates: Record<string, Date | undefined> = {};
    if (toStatus === "PURCHASING") dateUpdates.orderDate = dateValue;
    if (toStatus === "SHIPPED")    dateUpdates.actualShipDate = dateValue;
    if (toStatus === "CUSTOMS")    dateUpdates.customsDate = dateValue;

    const updated = await this.prisma.overseasOrder.update({
      where: { id },
      data: {
        status: toStatus,
        // APPROVED 전이 시 승인일 자동 기록 (최초 1회만)
        ...(toStatus === "APPROVED" && !order.approvedAt && { approvedAt: new Date() }),
        // ORDERED 전이 시 발주일 자동 기록 (사용자 명시 입력 없으면)
        ...(toStatus === "ORDERED" && !order.orderDate && { orderDate: new Date() }),
        // 전이별 사용자 입력 날짜 (PURCHASING/SHIPPED/CUSTOMS)
        ...dateUpdates,
      },
    });

    // v1.6.1 (2026-05-15): CUSTOMS 진입 시 OrderCustomsTax 자동 생성 (재무팀 큐로)
    if (toStatus === "CUSTOMS") {
      const exists = await this.prisma.orderCustomsTax.findUnique({ where: { orderId: id } });
      if (!exists) {
        await this.prisma.orderCustomsTax.create({
          data: { orderId: id, status: "PENDING", ...(userId && { startedBy: userId }) },
        });
      }
    }

    return updated;
  }

  async remove(id: string) {
    const order = await this.prisma.overseasOrder.findUnique({ where: { id } });
    if (!order) throw new Error("발주를 찾을 수 없습니다.");
    if (order.status !== "DRAFT") throw new Error("초안 상태에서만 삭제할 수 있습니다.");
    return this.prisma.overseasOrder.delete({ where: { id } });
  }

  /**
   * 결재 상신 취소 (v1.6, 2026-05-14):
   *   PENDING_APPROVAL → DRAFT 복원.
   *   approval-service의 결재 문서가 있으면 cancel 시도 (best-effort).
   */
  async cancelSubmission(id: string, _userId: string) {
    const order = await this.prisma.overseasOrder.findUnique({ where: { id } });
    if (!order) throw new Error("발주를 찾을 수 없습니다.");
    if (order.status !== "PENDING_APPROVAL") {
      throw new Error(`상신 취소는 PENDING_APPROVAL 상태에서만 가능합니다. (현재: ${order.status})`);
    }

    // approval-service에 결재 문서 일괄 withdraw 요청 (v1.6 2026-05-14)
    //   referenceType "ORDER"로 발주 결재 문서를 모두 RETURNED 처리
    try {
      const approvalUrl = process.env.APPROVAL_SERVICE_URL || "http://approval-service:3006";
      const token = process.env.INTERNAL_API_TOKEN as string;
      const resp = await fetch(`${approvalUrl}/internal/documents/withdraw-by-reference`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Internal-Token": token },
        body: JSON.stringify({
          referenceType: "ORDER",
          referenceId: id,
        }),
      });
      if (!resp.ok) {
        console.warn(`[overseas-order] approval withdraw responded ${resp.status}`);  
      }
    } catch (err: any) {
      console.warn(`[overseas-order] approval withdraw failed: ${err.message}`);  
    }

    return this.prisma.overseasOrder.update({
      where: { id },
      data: { status: "DRAFT" },
    });
  }

  // ─── Items ──────────────────────────────────────────────────────────────

  async addItem(orderId: string, data: {
    productMasterId?: string; name: string; spec?: string;
    quantity: number; unitPrice: number; amount: number; notes?: string;
  }) {
    await this.ensureOrderEditable(orderId);
    return this.prisma.overseasOrderItem.create({ data: { orderId, ...data } as any });
  }

  async updateItem(itemId: string, data: {
    name?: string; spec?: string; quantity?: number;
    unitPrice?: number; amount?: number; notes?: string;
  }) {
    const item = await this.prisma.overseasOrderItem.findUnique({
      where: { id: itemId },
      include: { order: { select: { status: true } } },
    });
    if (!item) throw new Error("품목을 찾을 수 없습니다.");
    if (item.order.status === "CLOSED") throw new Error("마감된 발주의 품목은 수정할 수 없습니다.");
    return this.prisma.overseasOrderItem.update({ where: { id: itemId }, data: data as any });
  }

  async removeItem(itemId: string) {
    const item = await this.prisma.overseasOrderItem.findUnique({
      where: { id: itemId },
      include: { order: { select: { status: true } } },
    });
    if (!item) throw new Error("품목을 찾을 수 없습니다.");
    if (!["DRAFT", "PENDING_APPROVAL"].includes(item.order.status)) {
      throw new Error("승인 대기 이전 상태에서만 품목을 삭제할 수 있습니다.");
    }
    return this.prisma.overseasOrderItem.delete({ where: { id: itemId } });
  }

  // ─── Partial Receipt ────────────────────────────────────────────────────

  async receiveItems(orderId: string, receipts: Array<{ itemId: string; quantity: number }>, userId: string) {
    const order = await this.prisma.overseasOrder.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) throw new Error("발주를 찾을 수 없습니다.");
    if (!["CUSTOMS", "PARTIALLY_RECEIVED"].includes(order.status)) {
      throw new Error("통관 또는 부분입고 상태에서만 입고할 수 있습니다.");
    }

    return this.prisma.$transaction(async (tx) => {
      for (const { itemId, quantity } of receipts) {
        const item = order.items.find((i) => i.id === itemId);
        if (!item) throw new Error(`품목 ${itemId}을 찾을 수 없습니다.`);

        const newReceived = item.receivedQuantity + quantity;
        if (newReceived > item.quantity) {
          throw new Error(`품목 "${item.name}": 입고 수량(${newReceived})이 발주 수량(${item.quantity})을 초과합니다.`);
        }

        const receiptStatus: OrderItemReceiptStatus =
          newReceived >= item.quantity ? "FULLY_RECEIVED" : "PARTIALLY_RECEIVED";

        await tx.overseasOrderItem.update({
          where: { id: itemId },
          data: { receivedQuantity: newReceived, receiptStatus },
        });
      }

      // Determine order-level status
      const updatedItems = await tx.overseasOrderItem.findMany({ where: { orderId } });
      const allReceived = updatedItems.every((i) => i.receiptStatus === "FULLY_RECEIVED");
      const orderStatus: OrderStatus = allReceived ? "ARRIVED" : "PARTIALLY_RECEIVED";

      const updated = await tx.overseasOrder.update({
        where: { id: orderId },
        data: {
          status: orderStatus,
          ...(allReceived && { arrivalDate: new Date() }),
        },
        include: { items: true },
      });

      // Log progress
      await tx.orderProgressLog.create({
        data: {
          orderId,
          progress: order.productionProgress,
          note: allReceived ? "전체 입고 완료" : `부분 입고: ${receipts.map((r) => `${r.quantity}개`).join(", ")}`,
          updatedBy: userId,
        },
      });

      // v1.6 (2026-05-18): 입고큐(InboundRequest) 자동 생성 — 재무팀 재고번호 부여 단계
      const now = new Date();
      const yy = String(now.getFullYear()).slice(-2);
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const irPrefix = `IR-${yy}${mm}-`;
      const lastIr = await tx.inboundRequest.findFirst({
        where: { code: { startsWith: irPrefix } },
        orderBy: { code: "desc" },
        select: { code: true },
      });
      let irSeq = 1;
      if (lastIr) {
        const m = lastIr.code.match(/^IR-\d{4}-(\d+)$/);
        if (m && m[1]) irSeq = parseInt(m[1], 10) + 1;
      }
      const irCode = `${irPrefix}${String(irSeq).padStart(4, "0")}`;
      await tx.inboundRequest.create({
        data: {
          code: irCode,
          status: "PENDING",
          sourceType: "OVERSEAS_ORDER",
          sourceId: orderId,
          sourceDocNumber: order.orderNumber,
          requesterId: userId,
          notes: `발주 ${order.orderNumber} 입고 자동 등록`,
          items: {
            create: receipts.map(({ itemId, quantity }) => {
              const item = order.items.find((i) => i.id === itemId)!;
              const flag = item.productMasterId && item.variantId
                ? "AUTO_MATCHED"
                : item.productMasterId
                ? "PARTIAL"
                : "MANUAL_NEEDED";
              return {
                productMasterId: item.productMasterId,
                variantId: item.variantId,
                itemNameRaw: item.name,
                quantity,
                unitPrice: item.unitPrice,
                completenessFlag: flag as any,
                orderItemId: item.id,
              };
            }),
          },
        },
      });

      return updated;
    });
  }

  // ─── Dashboard Stats ───────────────────────────────────────────────────

  async getDashboardStats() {
    const [statusCounts, currencyCounts] = await Promise.all([
      this.prisma.overseasOrder.groupBy({ by: ["status"], _count: true }),
      this.prisma.overseasOrder.groupBy({
        by: ["currency", "status"],
        _sum: { totalAmount: true, totalAmountKRW: true },
        _count: true,
      }),
    ]);
    return { statusCounts, currencyCounts };
  }

  // ─── Inventory Link ─────────────────────────────────────────────────

  async linkInventory(itemId: string, inventoryNo: string) {
    const item = await this.prisma.overseasOrderItem.findUnique({ where: { id: itemId } });
    if (!item) throw new Error("품목을 찾을 수 없습니다.");

    const inv = await this.prisma.inventoryItem.findUnique({ where: { inventoryNo } });
    if (!inv) throw new Error(`재고번호 ${inventoryNo}를 찾을 수 없습니다.`);
    if (inv.orderItemId && inv.orderItemId !== itemId) {
      throw new Error(`재고 ${inventoryNo}는 이미 다른 품목에 연결되어 있습니다.`);
    }

    return this.prisma.inventoryItem.update({
      where: { id: inv.id },
      data: { orderItemId: itemId },
      select: { id: true, inventoryNo: true, itemName: true, currentStatus: true },
    });
  }

  async unlinkInventory(inventoryId: string) {
    return this.prisma.inventoryItem.update({
      where: { id: inventoryId },
      data: { orderItemId: null },
    });
  }

  private async ensureOrderEditable(orderId: string) {
    const order = await this.prisma.overseasOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new Error("발주를 찾을 수 없습니다.");
    if (order.status === "CLOSED") throw new Error("마감된 발주는 수정할 수 없습니다.");
    return order;
  }
}
