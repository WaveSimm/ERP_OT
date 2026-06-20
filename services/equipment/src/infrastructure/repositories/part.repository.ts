import { PrismaClient, Prisma, Part } from "@prisma/client";
import type { IPartRepository } from "../../domain/repositories/part.repository.js";

/** IPartRepository 의 Prisma 구현 (infrastructure 계층). */
export class PrismaPartRepository implements IPartRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string): Promise<Part | null> {
    return this.prisma.part.findUnique({ where: { id } });
  }

  create(data: Prisma.PartUncheckedCreateInput): Promise<Part> {
    return this.prisma.part.create({ data });
  }

  update(id: string, data: Prisma.PartUncheckedUpdateInput): Promise<Part> {
    return this.prisma.part.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.part.delete({ where: { id } });
  }
}
