import { PrismaClient, Prisma, Category } from "@prisma/client";
import type { ICategoryRepository } from "../../domain/repositories/category.repository.js";

/** ICategoryRepository 의 Prisma 구현 (infrastructure 계층). */
export class PrismaCategoryRepository implements ICategoryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findMany(where?: Prisma.CategoryWhereInput): Promise<Category[]> {
    return this.prisma.category.findMany({
      ...(where ? { where } : {}),
      orderBy: { sortOrder: "asc" },
    });
  }

  create(data: Prisma.CategoryUncheckedCreateInput): Promise<Category> {
    return this.prisma.category.create({ data });
  }

  update(id: string, data: Prisma.CategoryUncheckedUpdateInput): Promise<Category> {
    return this.prisma.category.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.category.delete({ where: { id } });
  }
}
