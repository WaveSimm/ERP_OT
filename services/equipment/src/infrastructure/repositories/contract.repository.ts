import { PrismaClient, Prisma, Contract } from "@prisma/client";
import type { IContractRepository } from "../../domain/repositories/contract.repository.js";

/** IContractRepository 의 Prisma 구현 (infrastructure 계층). */
export class PrismaContractRepository implements IContractRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string): Promise<Contract | null> {
    return this.prisma.contract.findUnique({ where: { id } });
  }

  create(data: Prisma.ContractUncheckedCreateInput): Promise<Contract> {
    return this.prisma.contract.create({ data });
  }

  update(id: string, data: Prisma.ContractUncheckedUpdateInput): Promise<Contract> {
    return this.prisma.contract.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.contract.delete({ where: { id } });
  }
}
