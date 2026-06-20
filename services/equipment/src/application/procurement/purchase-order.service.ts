import { PrismaClient } from "@prisma/client";

export class PurchaseOrderService {
  constructor(private prisma: PrismaClient) {}

  async list(params: { status?: string; page?: number; limit?: number } = {}) {
    const { status, page = 1, limit = 50 } = params;
    const where: any = {};
    if (status) where.status = status;

    const [items, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where,
        include: { items: { include: { part: { select: { id: true, name: true, partNumber: true } } } } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async getById(id: string) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: { items: { include: { part: true } } },
    });
    if (!po) throw new Error("발주를 찾을 수 없습니다.");
    return po;
  }

  async generateOrderNumber(): Promise<string> {
    const year = new Date().getFullYear();
    try {
      const result = await this.prisma.$queryRaw<[{ nextval: bigint }]>`
        SELECT nextval('equipment.purchase_order_seq')`;
      const seq = String(result[0].nextval).padStart(4, "0");
      return `PO-${year}-${seq}`;
    } catch {
      const count = await this.prisma.purchaseOrder.count();
      return `PO-${year}-${String(count + 1).padStart(4, "0")}`;
    }
  }

  async create(data: {
    supplier: string;
    orderedAt?: string;
    expectedDelivery?: string;
    totalAmount?: number;
    currency?: string;
    notes?: string;
    items?: { partId: string; quantity: number; unitPrice: number; amount: number }[];
  }) {
    const orderNumber = await this.generateOrderNumber();
    const { items, orderedAt, expectedDelivery, ...rest } = data;

    return this.prisma.purchaseOrder.create({
      data: {
        orderNumber,
        ...rest,
        orderedAt: orderedAt ? new Date(orderedAt) : undefined,
        expectedDelivery: expectedDelivery ? new Date(expectedDelivery) : undefined,
        items: items ? { create: items } : undefined,
      } as any,
      include: { items: { include: { part: { select: { id: true, name: true, partNumber: true } } } } },
    });
  }

  async update(id: string, data: {
    supplier?: string;
    status?: string;
    orderedAt?: string;
    expectedDelivery?: string;
    totalAmount?: number;
    currency?: string;
    notes?: string;
  }) {
    const { orderedAt, expectedDelivery, ...rest } = data;
    return this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        ...rest,
        ...(orderedAt !== undefined ? { orderedAt: orderedAt ? new Date(orderedAt) : null } : {}),
        ...(expectedDelivery !== undefined ? { expectedDelivery: expectedDelivery ? new Date(expectedDelivery) : null } : {}),
      } as any,
    });
  }

  async receive(id: string, items: { itemId: string; receivedQuantity: number }[]) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: { items: { include: { part: true } } },
    });
    if (!po) throw new Error("발주를 찾을 수 없습니다.");

    await this.prisma.$transaction(async (tx) => {
      for (const item of items) {
        const poItem = po.items.find((i) => i.id === item.itemId);
        if (!poItem) continue;

        // 입고 수량 업데이트
        await tx.purchaseOrderItem.update({
          where: { id: item.itemId },
          data: { receivedQuantity: { increment: item.receivedQuantity } },
        });

        // 부품 재고 증가
        await tx.part.update({
          where: { id: poItem.partId },
          data: { stockQuantity: { increment: item.receivedQuantity } },
        });

        // 입고 트랜잭션 기록
        await tx.partTransaction.create({
          data: {
            partId: poItem.partId,
            type: "IN",
            quantity: item.receivedQuantity,
            reason: `발주 입고: ${po.orderNumber}`,
            purchaseOrderId: id,
          } as any,
        });
      }

      // 전체 입고 완료 여부 확인
      const updatedItems = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: id } });
      const allReceived = updatedItems.every((i) => i.receivedQuantity >= i.quantity);
      const someReceived = updatedItems.some((i) => i.receivedQuantity > 0);

      await tx.purchaseOrder.update({
        where: { id },
        data: { status: allReceived ? "RECEIVED" : someReceived ? "PARTIALLY_RECEIVED" : po.status } as any,
      });
    });

    return this.getById(id);
  }
}
