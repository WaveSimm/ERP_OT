import { PrismaClient } from "@prisma/client";

export class RepairCostService {
  constructor(private prisma: PrismaClient) {}

  async listByRepairOrder(repairOrderId: string) {
    return this.prisma.repairCost.findMany({
      where: { repairOrderId },
      orderBy: { createdAt: "desc" },
    });
  }

  async create(data: {
    repairOrderId: string;
    costType: string;
    description?: string;
    amount: number;
    currency?: string;
    exchangeRate?: number;
    notes?: string;
  }) {
    return this.prisma.repairCost.create({ data: data as any });
  }

  async update(id: string, data: {
    costType?: string;
    description?: string;
    amount?: number;
    currency?: string;
    exchangeRate?: number;
    notes?: string;
  }) {
    return this.prisma.repairCost.update({ where: { id }, data: data as any });
  }

  async remove(id: string) {
    return this.prisma.repairCost.delete({ where: { id } });
  }
}
