import { PrismaClient, OrderStatus, OrderItemReceiptStatus } from "@prisma/client";
import { assertTransition, getAllowedTransitions } from "../domain/state-machine/order.fsm.js";

export class OverseasOrderService {
  constructor(private prisma: PrismaClient) {}

  async list(params: {
    search?: string; status?: OrderStatus; currency?: string;
    orderType?: string; contractId?: string; page?: number; limit?: number;
  } = {}) {
    const { search, status, currency, orderType, contractId, page = 1, limit = 50 } = params;
    const where: any = {};

    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: "insensitive" } },
        { manufacturer: { contains: search, mode: "insensitive" } },
        { invoiceNo: { contains: search, mode: "insensitive" } },
      ];
    }
    if (status) where.status = status;
    if (currency) where.currency = currency;
    if (orderType) where.orderType = orderType;
    if (contractId) where.contractId = contractId;

    const [items, total] = await Promise.all([
      this.prisma.overseasOrder.findMany({
        where,
        include: {
          contract: { select: { id: true, contractNumber: true, name: true } },
          _count: { select: { items: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.overseasOrder.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async getById(id: string) {
    const order = await this.prisma.overseasOrder.findUnique({
      where: { id },
      include: {
        contract: { select: { id: true, contractNumber: true, name: true, client: true } },
        items: {
          include: {
            productMaster: { select: { id: true, name: true, modelName: true } },
            inventoryItems: { select: { id: true, inventoryNo: true, itemName: true, currentStatus: true }, orderBy: { inventoryNo: "asc" } },
          },
          orderBy: { createdAt: "asc" },
        },
        progressLogs: { orderBy: { createdAt: "desc" }, take: 20 },
      },
    });
    if (!order) throw new Error("발주를 찾을 수 없습니다.");
    return { ...order, allowedTransitions: getAllowedTransitions(order.status) };
  }

  /** PO-YYYY-0001 형식 자동 채번 */
  private async generateOrderNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `PO-${year}-`;
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
    invoiceNo?: string;
    dueDate?: string;
    oaNumber?: string;
    totalAmount: number;
    totalAmountKRW?: number;
    notes?: string;
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
    const { items, orderDate, estimatedProductionEnd, estimatedShipDate, dueDate, ...rest } = data;
    const orderNumber = await this.generateOrderNumber();

    return this.prisma.overseasOrder.create({
      data: {
        ...rest,
        orderNumber,
        status: "DRAFT",
        orderDate: orderDate ? new Date(orderDate) : undefined,
        estimatedProductionEnd: estimatedProductionEnd ? new Date(estimatedProductionEnd) : undefined,
        estimatedShipDate: estimatedShipDate ? new Date(estimatedShipDate) : undefined,
        dueDate: dueDate ? new Date(dueDate) : undefined,
        items: items?.length ? { create: items } : undefined,
      } as any,
      include: {
        items: true,
        contract: { select: { id: true, contractNumber: true, name: true } },
      },
    });
  }

  async update(id: string, data: {
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
    invoiceNo?: string;
    dueDate?: string;
    oaNumber?: string;
    totalAmount?: number;
    totalAmountKRW?: number;
    notes?: string;
  }) {
    const order = await this.prisma.overseasOrder.findUnique({ where: { id } });
    if (!order) throw new Error("발주를 찾을 수 없습니다.");
    if (order.status === "CLOSED") throw new Error("마감된 발주는 수정할 수 없습니다.");

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

  async transition(id: string, toStatus: OrderStatus, userId: string) {
    const order = await this.prisma.overseasOrder.findUnique({ where: { id } });
    if (!order) throw new Error("발주를 찾을 수 없습니다.");

    assertTransition(order.status, toStatus);

    return this.prisma.overseasOrder.update({
      where: { id },
      data: { status: toStatus },
    });
  }

  async remove(id: string) {
    const order = await this.prisma.overseasOrder.findUnique({ where: { id } });
    if (!order) throw new Error("발주를 찾을 수 없습니다.");
    if (order.status !== "DRAFT") throw new Error("초안 상태에서만 삭제할 수 없습니다.");
    return this.prisma.overseasOrder.delete({ where: { id } });
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
