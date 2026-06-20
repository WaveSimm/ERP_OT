import { PrismaClient, Prisma, QuoteStatus } from "@prisma/client";
import type { IRepairQuoteRepository } from "../../domain/repositories/repair-quote.repository.js";

export class RepairQuoteService {
  // repo: RepairQuote aggregate(+items) CRUD. prisma: 복잡 read(listByRepairOrder/getById include).
  constructor(
    private readonly repo: IRepairQuoteRepository,
    private readonly prisma: PrismaClient,
  ) {}

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
    return this.repo.create({
      ...rest,
      validUntil: validUntil ? new Date(validUntil) : undefined,
      items: items ? { create: items } : undefined,
    } as Prisma.RepairQuoteUncheckedCreateInput);
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
    return this.repo.update(id, {
      ...rest,
      ...(validUntil !== undefined ? { validUntil: validUntil ? new Date(validUntil) : null } : {}),
    } as Prisma.RepairQuoteUncheckedUpdateInput);
  }

  async changeStatus(id: string, status: string, userId?: string) {
    const quote = await this.repo.findById(id);
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

    const updateData: Prisma.RepairQuoteUncheckedUpdateInput = { status: status as QuoteStatus };
    if (status === "APPROVED") {
      updateData.approvedAt = new Date();
      updateData.approvedBy = userId ?? null;
    }

    return this.repo.update(id, updateData);
  }

  async remove(id: string) {
    const quote = await this.repo.findById(id);
    if (!quote) throw new Error("견적을 찾을 수 없습니다.");
    if (quote.status !== "DRAFT") throw new Error("DRAFT 상태의 견적만 삭제할 수 있습니다.");
    await this.repo.deleteItemsByQuote(id);
    await this.repo.delete(id);
  }

  // ─── 견적 항목 ──────────────────────────────────────────────────────────

  async addItem(quoteId: string, data: { description: string; quantity: number; unitPrice: number; amount: number; partId?: string }) {
    return this.repo.addItem(quoteId, data);
  }

  async updateItem(itemId: string, data: { description?: string; quantity?: number; unitPrice?: number; amount?: number }) {
    const item = await this.repo.findItemById(itemId);
    if (!item) throw new Error("견적 항목을 찾을 수 없습니다.");
    return this.repo.updateItem(itemId, data);
  }

  async removeItem(itemId: string) {
    const item = await this.repo.findItemById(itemId);
    if (!item) throw new Error("견적 항목을 찾을 수 없습니다.");
    await this.repo.deleteItem(itemId);
  }
}
