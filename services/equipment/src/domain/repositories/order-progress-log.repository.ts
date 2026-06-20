import type { Prisma, OrderProgressLog } from "@prisma/client";

/**
 * OrderProgressLog aggregate 영속성 인터페이스 (Clean Architecture — domain 계층).
 * create 시 overseasOrder 진행률 갱신(cross-aggregate)은 service 유지.
 */
export interface IOrderProgressLogRepository {
  listByOrder(orderId: string, skip: number, take: number): Promise<OrderProgressLog[]>;
  countByOrder(orderId: string): Promise<number>;
  findById(id: string): Promise<OrderProgressLog | null>;
  create(data: Prisma.OrderProgressLogUncheckedCreateInput): Promise<OrderProgressLog>;
  delete(id: string): Promise<void>;
}
