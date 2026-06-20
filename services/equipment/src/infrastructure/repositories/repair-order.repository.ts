import { PrismaClient, Prisma, RepairOrder } from "@prisma/client";
import type { IRepairOrderRepository } from "../../domain/repositories/repair-order.repository.js";

/**
 * IRepairOrderRepository 의 Prisma 구현 (infrastructure 계층).
 * domain 인터페이스를 implements → 의존성 역전(application은 domain에만 의존).
 */
export class PrismaRepairOrderRepository implements IRepairOrderRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async nextSequence(): Promise<bigint | null> {
    try {
      const result = await this.prisma.$queryRaw<[{ nextval: bigint }]>`
        SELECT nextval('equipment.repair_order_seq')`;
      return result[0].nextval;
    } catch {
      return null;
    }
  }

  count(where?: Prisma.RepairOrderWhereInput): Promise<number> {
    return this.prisma.repairOrder.count({ ...(where ? { where } : {}) });
  }

  findById(id: string): Promise<RepairOrder | null> {
    return this.prisma.repairOrder.findUnique({ where: { id } });
  }

  create(
    data: Prisma.RepairOrderUncheckedCreateInput,
    include?: Prisma.RepairOrderInclude,
  ): Promise<RepairOrder> {
    return this.prisma.repairOrder.create({ data, ...(include ? { include } : {}) });
  }

  update(id: string, data: Prisma.RepairOrderUncheckedUpdateInput): Promise<RepairOrder> {
    return this.prisma.repairOrder.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.repairOrder.delete({ where: { id } });
  }
}
