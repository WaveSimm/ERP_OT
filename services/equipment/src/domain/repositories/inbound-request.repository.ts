import type { Prisma, InboundRequest } from "@prisma/client";

/** create 가 기존과 동일하게 items 를 포함해 반환 (런타임 응답 shape 유지). */
export type InboundRequestWithItems = Prisma.InboundRequestGetPayload<{ include: { items: true } }>;

/**
 * InboundRequest aggregate 영속성 인터페이스 (Clean Architecture — domain 계층).
 * 복잡 read(list/getById include, createFromOverseasOrder의 cross read), receive($transaction:
 * inventoryItem 생성 사가)는 service 유지 — aggregate-root CRUD만 repository.
 */
export interface IInboundRequestRepository {
  findById(id: string): Promise<InboundRequest | null>;
  create(data: Prisma.InboundRequestUncheckedCreateInput): Promise<InboundRequestWithItems>;
  update(id: string, data: Prisma.InboundRequestUncheckedUpdateInput): Promise<InboundRequest>;
}
