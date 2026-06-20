import type { Prisma, OverseasOrder, OverseasOrderItem } from "@prisma/client";

/** create 가 기존과 동일하게 items+contract 를 포함해 반환 (런타임 응답 shape 유지). */
export type OverseasOrderWithItemsContract = Prisma.OverseasOrderGetPayload<{
  include: { items: true; contract: { select: { id: true; contractNumber: true; name: true } } };
}>;

/** updateItem/removeItem 가드용 — order.status 포함. */
export type OverseasOrderItemWithOrderStatus = Prisma.OverseasOrderItemGetPayload<{
  include: { order: { select: { status: true } } };
}>;

/**
 * OverseasOrder aggregate 영속성 인터페이스 (Clean Architecture — domain 계층).
 * aggregate root(OverseasOrder) + 자식(OverseasOrderItem) CRUD. 복잡 read(list/getById include·
 * 가공), orderNumber 생성, transition(FSM+customsTax cross), receiveItems($transaction 사가),
 * linkInventory(cross), getDashboardStats(집계)는 service 유지.
 */
export interface IOverseasOrderRepository {
  findById(id: string): Promise<OverseasOrder | null>;
  create(data: Prisma.OverseasOrderUncheckedCreateInput): Promise<OverseasOrderWithItemsContract>;
  update(id: string, data: Prisma.OverseasOrderUncheckedUpdateInput): Promise<OverseasOrder>;
  delete(id: string): Promise<void>;
  // 자식: OverseasOrderItem
  findItemById(itemId: string): Promise<OverseasOrderItemWithOrderStatus | null>;
  createItem(data: Prisma.OverseasOrderItemUncheckedCreateInput): Promise<OverseasOrderItem>;
  updateItem(itemId: string, data: Prisma.OverseasOrderItemUncheckedUpdateInput): Promise<OverseasOrderItem>;
  deleteItem(itemId: string): Promise<void>;
}
