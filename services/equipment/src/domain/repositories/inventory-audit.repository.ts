import type { Prisma, InventoryAudit, InventoryAuditItem } from "@prisma/client";

/** create 가 기존과 동일하게 _count.items 를 포함해 반환 (런타임 응답 shape 유지). */
export type InventoryAuditWithCount = Prisma.InventoryAuditGetPayload<{
  include: { _count: { select: { items: true } } };
}>;

/**
 * InventoryAudit aggregate 영속성 인터페이스 (Clean Architecture — domain 계층).
 * aggregate root(InventoryAudit) + 자식(InventoryAuditItem). 복잡 read(list/getById include,
 * create 시 전체재고 스냅샷 조회, complete 시 items 집계)는 service 유지.
 */
export interface IInventoryAuditRepository {
  findById(id: string): Promise<InventoryAudit | null>;
  create(data: Prisma.InventoryAuditUncheckedCreateInput): Promise<InventoryAuditWithCount>;
  update(id: string, data: Prisma.InventoryAuditUncheckedUpdateInput): Promise<InventoryAudit>;
  // 자식: InventoryAuditItem
  findItemById(itemId: string): Promise<InventoryAuditItem | null>;
  updateItem(itemId: string, data: Prisma.InventoryAuditItemUncheckedUpdateInput): Promise<InventoryAuditItem>;
}
