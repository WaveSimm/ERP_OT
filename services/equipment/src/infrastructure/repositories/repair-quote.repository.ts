import { PrismaClient, Prisma, RepairQuote, QuoteItem } from "@prisma/client";
import type { IRepairQuoteRepository } from "../../domain/repositories/repair-quote.repository.js";

/** IRepairQuoteRepository 의 Prisma 구현 (infrastructure 계층). */
export class PrismaRepairQuoteRepository implements IRepairQuoteRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string): Promise<RepairQuote | null> {
    return this.prisma.repairQuote.findUnique({ where: { id } });
  }

  create(data: Prisma.RepairQuoteUncheckedCreateInput): Promise<RepairQuote> {
    return this.prisma.repairQuote.create({ data, include: { items: true } });
  }

  update(id: string, data: Prisma.RepairQuoteUncheckedUpdateInput): Promise<RepairQuote> {
    return this.prisma.repairQuote.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.repairQuote.delete({ where: { id } });
  }

  async deleteItemsByQuote(quoteId: string): Promise<void> {
    await this.prisma.quoteItem.deleteMany({ where: { quoteId } });
  }

  findItemById(itemId: string): Promise<QuoteItem | null> {
    return this.prisma.quoteItem.findUnique({ where: { id: itemId } });
  }

  addItem(quoteId: string, data: Omit<Prisma.QuoteItemUncheckedCreateInput, "quoteId">): Promise<QuoteItem> {
    return this.prisma.quoteItem.create({ data: { ...data, quoteId } });
  }

  updateItem(itemId: string, data: Prisma.QuoteItemUncheckedUpdateInput): Promise<QuoteItem> {
    return this.prisma.quoteItem.update({ where: { id: itemId }, data });
  }

  async deleteItem(itemId: string): Promise<void> {
    await this.prisma.quoteItem.delete({ where: { id: itemId } });
  }
}
