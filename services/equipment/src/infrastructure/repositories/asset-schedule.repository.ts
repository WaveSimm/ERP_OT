import { PrismaClient, Prisma, AssetSchedule } from "@prisma/client";
import type { IAssetScheduleRepository } from "../../domain/repositories/asset-schedule.repository.js";

/** IAssetScheduleRepository 의 Prisma 구현 (infrastructure 계층). */
export class PrismaAssetScheduleRepository implements IAssetScheduleRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string): Promise<AssetSchedule | null> {
    return this.prisma.assetSchedule.findUnique({ where: { id } });
  }

  create(data: Prisma.AssetScheduleUncheckedCreateInput): Promise<AssetSchedule> {
    return this.prisma.assetSchedule.create({ data });
  }

  update(id: string, data: Prisma.AssetScheduleUncheckedUpdateInput): Promise<AssetSchedule> {
    return this.prisma.assetSchedule.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.assetSchedule.delete({ where: { id } });
  }
}
