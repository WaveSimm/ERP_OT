import { PrismaClient, Prisma, StorageLocation } from "@prisma/client";
import type { IStorageLocationRepository } from "../../domain/repositories/storage-location.repository.js";

/** IStorageLocationRepository 의 Prisma 구현 (infrastructure 계층). */
export class PrismaStorageLocationRepository implements IStorageLocationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string): Promise<StorageLocation | null> {
    return this.prisma.storageLocation.findUnique({ where: { id } });
  }

  create(data: Prisma.StorageLocationUncheckedCreateInput): Promise<StorageLocation> {
    return this.prisma.storageLocation.create({ data });
  }

  update(id: string, data: Prisma.StorageLocationUncheckedUpdateInput): Promise<StorageLocation> {
    return this.prisma.storageLocation.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.storageLocation.delete({ where: { id } });
  }
}
