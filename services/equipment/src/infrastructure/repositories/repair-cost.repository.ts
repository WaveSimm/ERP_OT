import { PrismaClient, Prisma, RepairCost } from "@prisma/client";
import type { IRepairCostRepository } from "../../domain/repositories/repair-cost.repository.js";

/** IRepairCostRepository 의 Prisma 구현 (infrastructure 계층). */
export class PrismaRepairCostRepository implements IRepairCostRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findByRepairOrder(repairOrderId: string): Promise<RepairCost[]> {
    return this.prisma.repairCost.findMany({
      where: { repairOrderId },
      orderBy: { createdAt: "desc" },
    });
  }

  create(data: Prisma.RepairCostUncheckedCreateInput): Promise<RepairCost> {
    return this.prisma.repairCost.create({ data });
  }

  update(id: string, data: Prisma.RepairCostUncheckedUpdateInput): Promise<RepairCost> {
    return this.prisma.repairCost.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.repairCost.delete({ where: { id } });
  }
}
