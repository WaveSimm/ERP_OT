import type { Prisma, RepairQuote, QuoteItem } from "@prisma/client";

/**
 * RepairQuote aggregate 영속성 인터페이스 (Clean Architecture — domain 계층).
 * aggregate root(RepairQuote) + 자식(QuoteItem) CRUD. 복잡 read(listByRepairOrder/getById의
 * items+part include)는 service 유지.
 */
export interface IRepairQuoteRepository {
  findById(id: string): Promise<RepairQuote | null>;
  create(data: Prisma.RepairQuoteUncheckedCreateInput): Promise<RepairQuote>;
  update(id: string, data: Prisma.RepairQuoteUncheckedUpdateInput): Promise<RepairQuote>;
  delete(id: string): Promise<void>;
  deleteItemsByQuote(quoteId: string): Promise<void>;
  // 자식: QuoteItem
  findItemById(itemId: string): Promise<QuoteItem | null>;
  addItem(quoteId: string, data: Omit<Prisma.QuoteItemUncheckedCreateInput, "quoteId">): Promise<QuoteItem>;
  updateItem(itemId: string, data: Prisma.QuoteItemUncheckedUpdateInput): Promise<QuoteItem>;
  deleteItem(itemId: string): Promise<void>;
}
