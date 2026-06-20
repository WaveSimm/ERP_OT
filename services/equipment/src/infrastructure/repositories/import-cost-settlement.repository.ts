import { PrismaClient, Prisma, ImportCostSettlement, CostRemittance } from "@prisma/client";
import type {
  IImportCostSettlementRepository,
  SettlementWithChildren,
  SettlementWithContract,
} from "../../domain/repositories/import-cost-settlement.repository.js";

/** IImportCostSettlementRepository 의 Prisma 구현 (infrastructure 계층). */
export class PrismaImportCostSettlementRepository implements IImportCostSettlementRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string): Promise<ImportCostSettlement | null> {
    return this.prisma.importCostSettlement.findUnique({ where: { id } });
  }

  create(data: Prisma.ImportCostSettlementUncheckedCreateInput): Promise<SettlementWithChildren> {
    return this.prisma.importCostSettlement.create({
      data,
      include: { remittances: true, duties: true, items: true },
    });
  }

  updateContract(id: string, contractId: string | null): Promise<SettlementWithContract> {
    return this.prisma.importCostSettlement.update({
      where: { id },
      data: { contractId },
      include: { contract: { select: { contractNumber: true, name: true, client: true } } },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.importCostSettlement.delete({ where: { id } });
  }

  createRemittance(data: Prisma.CostRemittanceUncheckedCreateInput): Promise<CostRemittance> {
    return this.prisma.costRemittance.create({ data });
  }

  async deleteRemittance(remittanceId: string): Promise<void> {
    await this.prisma.costRemittance.delete({ where: { id: remittanceId } });
  }
}
