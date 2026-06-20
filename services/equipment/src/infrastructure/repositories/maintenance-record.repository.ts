import { PrismaClient, Prisma, MaintenanceRecord } from "@prisma/client";
import type { IMaintenanceRecordRepository } from "../../domain/repositories/maintenance-record.repository.js";

/** IMaintenanceRecordRepository 의 Prisma 구현 (infrastructure 계층). */
export class PrismaMaintenanceRecordRepository implements IMaintenanceRecordRepository {
  constructor(private readonly prisma: PrismaClient) {}

  create(data: Prisma.MaintenanceRecordUncheckedCreateInput): Promise<MaintenanceRecord> {
    return this.prisma.maintenanceRecord.create({ data });
  }

  update(id: string, data: Prisma.MaintenanceRecordUncheckedUpdateInput): Promise<MaintenanceRecord> {
    return this.prisma.maintenanceRecord.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.maintenanceRecord.delete({ where: { id } });
  }
}
