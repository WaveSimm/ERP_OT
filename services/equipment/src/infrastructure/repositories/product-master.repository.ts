import { PrismaClient, Prisma, ProductMaster } from "@prisma/client";
import type { IProductMasterRepository } from "../../domain/repositories/product-master.repository.js";

/** IProductMasterRepository 의 Prisma 구현 (infrastructure 계층). */
export class PrismaProductMasterRepository implements IProductMasterRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string): Promise<ProductMaster | null> {
    return this.prisma.productMaster.findUnique({ where: { id } });
  }

  create(data: Prisma.ProductMasterUncheckedCreateInput): Promise<ProductMaster> {
    return this.prisma.productMaster.create({ data });
  }

  update(id: string, data: Prisma.ProductMasterUncheckedUpdateInput): Promise<ProductMaster> {
    return this.prisma.productMaster.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.productMaster.delete({ where: { id } });
  }
}
