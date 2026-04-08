import { PrismaClient } from "@prisma/client";

export class RepairQuoteService {
  constructor(private prisma: PrismaClient) {}

  async listByRepairOrder(repairOrderId: string) {
    return this.prisma.repairQuote.findMany({
      where: { repairOrderId },
      include: { items: { include: { part: { select: { id: true, name: true, partNumber: true } } } } },
      orderBy: { createdAt: "desc" },
    });
  }

  async getById(id: string) {
    const quote = await this.prisma.repairQuote.findUnique({
      where: { id },
      include: { items: { include: { part: true } }, repairOrder: { select: { orderNumber: true, customer: { select: { name: true } } } } },
    });
    if (!quote) throw new Error("견적을 찾을 수 없습니다.");
    return quote;
  }

  async create(data: {
    repairOrderId: string;
    quoteNumber?: string;
    laborCost?: number;
    partsCost?: number;
    shippingCost?: number;
    totalAmount: number;
    currency?: string;
    exchangeRate?: number;
    validUntil?: string;
    notes?: string;
    items?: { description: string; quantity: number; unitPrice: number; amount: number; partId?: string }[];
  }) {
    const { items, validUntil, ...rest } = data;
    return this.prisma.repairQuote.create({
      data: {
        ...rest,
        validUntil: validUntil ? new Date(validUntil) : undefined,
        items: items ? { create: items } : undefined,
      } as any,
      include: { items: true },
    });
  }

  async update(id: string, data: {
    quoteNumber?: string;
    laborCost?: number;
    partsCost?: number;
    shippingCost?: number;
    totalAmount?: number;
    currency?: string;
    exchangeRate?: number;
    validUntil?: string;
    notes?: string;
  }) {
    const { validUntil, ...rest } = data;
    return this.prisma.repairQuote.update({
      where: { id },
      data: {
        ...rest,
        ...(validUntil !== undefined ? { validUntil: validUntil ? new Date(validUntil) : null } : {}),
      } as any,
    });
  }

  async changeStatus(id: string, status: string, userId?: string) {
    const quote = await this.prisma.repairQuote.findUnique({ where: { id } });
    if (!quote) throw new Error("견적을 찾을 수 없습니다.");

    const allowed: Record<string, string[]> = {
      DRAFT: ["SENT"],
      SENT: ["APPROVED", "REJECTED"],
      APPROVED: [],
      REJECTED: [],
    };
    if (!(allowed[quote.status] || []).includes(status)) {
      throw new Error(`견적 상태 전이가 허용되지 않습니다: ${quote.status} → ${status}`);
    }

    const updateData: any = { status };
    if (status === "APPROVED") {
      updateData.approvedAt = new Date();
      updateData.approvedBy = userId;
    }

    return this.prisma.repairQuote.update({ where: { id }, data: updateData });
  }

  async remove(id: string) {
    const quote = await this.prisma.repairQuote.findUnique({ where: { id } });
    if (!quote) throw new Error("견적을 찾을 수 없습니다.");
    if (quote.status !== "DRAFT") throw new Error("DRAFT 상태의 견적만 삭제할 수 있습니다.");
    await this.prisma.quoteItem.deleteMany({ where: { quoteId: id } });
    return this.prisma.repairQuote.delete({ where: { id } });
  }

  // ─── 견적 항목 ──────────────────────────────────────────────────────────

  async addItem(quoteId: string, data: { description: string; quantity: number; unitPrice: number; amount: number; partId?: string }) {
    return this.prisma.quoteItem.create({ data: { quoteId, ...data } as any });
  }

  async updateItem(itemId: string, data: { description?: string; quantity?: number; unitPrice?: number; amount?: number }) {
    return this.prisma.quoteItem.update({ where: { id: itemId }, data });
  }

  async removeItem(itemId: string) {
    return this.prisma.quoteItem.delete({ where: { id: itemId } });
  }
}
