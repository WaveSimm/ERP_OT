import type { Prisma, RepairCost } from "@prisma/client";

/** RepairCost aggregate 영속성 인터페이스 (Clean Architecture — domain 계층). */
export interface IRepairCostRepository {
  findByRepairOrder(repairOrderId: string): Promise<RepairCost[]>;
  create(data: Prisma.RepairCostUncheckedCreateInput): Promise<RepairCost>;
  update(id: string, data: Prisma.RepairCostUncheckedUpdateInput): Promise<RepairCost>;
  delete(id: string): Promise<void>;
}
