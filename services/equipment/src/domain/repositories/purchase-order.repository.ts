import type { Prisma, PurchaseOrder } from "@prisma/client";

/** create 가 기존과 동일하게 items+part(select) 를 포함해 반환 (런타임 응답 shape 유지). */
export type PurchaseOrderWithItems = Prisma.PurchaseOrderGetPayload<{
  include: { items: { include: { part: { select: { id: true; name: true; partNumber: true } } } } };
}>;

/**
 * PurchaseOrder aggregate 영속성 인터페이스 (Clean Architecture — domain 계층).
 * 복잡 read(list/getById include), orderNumber 생성($queryRaw seq), receive($transaction:
 * purchaseOrderItem·part·partTransaction 입고)는 service 유지 — aggregate-root CRUD만 repository.
 */
export interface IPurchaseOrderRepository {
  findById(id: string): Promise<PurchaseOrder | null>;
  create(data: Prisma.PurchaseOrderUncheckedCreateInput): Promise<PurchaseOrderWithItems>;
  update(id: string, data: Prisma.PurchaseOrderUncheckedUpdateInput): Promise<PurchaseOrder>;
}
