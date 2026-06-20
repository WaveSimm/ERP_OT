import { PrismaClient, Prisma, CustomerAsset } from "@prisma/client";
import type { ICustomerAssetRepository } from "../../domain/repositories/customer-asset.repository.js";

/** ICustomerAssetRepository 의 Prisma 구현 (infrastructure 계층). */
export class PrismaCustomerAssetRepository implements ICustomerAssetRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string): Promise<CustomerAsset | null> {
    return this.prisma.customerAsset.findUnique({ where: { id } });
  }

  create(data: Prisma.CustomerAssetUncheckedCreateInput): Promise<CustomerAsset> {
    return this.prisma.customerAsset.create({ data });
  }

  update(id: string, data: Prisma.CustomerAssetUncheckedUpdateInput): Promise<CustomerAsset> {
    return this.prisma.customerAsset.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.customerAsset.delete({ where: { id } });
  }
}
