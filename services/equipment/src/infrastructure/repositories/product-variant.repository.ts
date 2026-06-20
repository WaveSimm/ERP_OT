import { PrismaClient, Prisma, ProductVariant } from "@prisma/client";
import type { IProductVariantRepository, VariantWithMaster } from "../../domain/repositories/product-variant.repository.js";

/** IProductVariantRepository 의 Prisma 구현 (infrastructure 계층). */
export class PrismaProductVariantRepository implements IProductVariantRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string): Promise<ProductVariant | null> {
    return this.prisma.productVariant.findUnique({ where: { id } });
  }

  create(data: Prisma.ProductVariantUncheckedCreateInput): Promise<VariantWithMaster> {
    return this.prisma.productVariant.create({ data, include: { productMaster: true } });
  }

  update(id: string, data: Prisma.ProductVariantUncheckedUpdateInput): Promise<VariantWithMaster> {
    return this.prisma.productVariant.update({ where: { id }, data, include: { productMaster: true } });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.productVariant.delete({ where: { id } });
  }
}
