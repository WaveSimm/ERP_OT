import { Prisma } from "@prisma/client";
import type { IRepairCostRepository } from "../../domain/repositories/repair-cost.repository.js";

export class RepairCostService {
  constructor(private readonly repo: IRepairCostRepository) {}

  async listByRepairOrder(repairOrderId: string) {
    return this.repo.findByRepairOrder(repairOrderId);
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
    return this.repo.create(data as Prisma.RepairCostUncheckedCreateInput);
  }

  async update(id: string, data: {
    costType?: string;
    description?: string;
    amount?: number;
    currency?: string;
    exchangeRate?: number;
    notes?: string;
  }) {
    return this.repo.update(id, data as Prisma.RepairCostUncheckedUpdateInput);
  }

  async remove(id: string) {
    await this.repo.delete(id);
  }
}
