import type { Prisma, RepairOrder } from "@prisma/client";

/**
 * RepairOrder aggregate 영속성 인터페이스 (Clean Architecture — domain 계층).
 * application(service)은 이 인터페이스에만 의존하고, Prisma 구현은 infrastructure가 제공.
 *
 * 파일럿 범위: aggregate root(RepairOrder)의 CRUD + 시퀀스/카운트.
 *   복잡한 read(list/getById의 다중 include)와 cross-aggregate 부수효과
 *   (shipment·equipment·sensor·maintenanceRecord 생성/갱신)는 현 단계에서 service에 유지.
 */
export interface IRepairOrderRepository {
  /** repair_order_seq nextval (없으면 null → service가 count 폴백) */
  nextSequence(): Promise<bigint | null>;
  count(where?: Prisma.RepairOrderWhereInput): Promise<number>;
  findById(id: string): Promise<RepairOrder | null>;
  create(
    data: Prisma.RepairOrderUncheckedCreateInput,
    include?: Prisma.RepairOrderInclude,
  ): Promise<RepairOrder>;
  update(id: string, data: Prisma.RepairOrderUncheckedUpdateInput): Promise<RepairOrder>;
  delete(id: string): Promise<void>;
}
