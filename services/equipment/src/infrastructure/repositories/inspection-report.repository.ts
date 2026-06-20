import { PrismaClient, Prisma, InspectionReport } from "@prisma/client";
import type { IInspectionReportRepository } from "../../domain/repositories/inspection-report.repository.js";

/** IInspectionReportRepository 의 Prisma 구현 (infrastructure 계층). */
export class PrismaInspectionReportRepository implements IInspectionReportRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findByRepairOrder(repairOrderId: string): Promise<InspectionReport | null> {
    return this.prisma.inspectionReport.findUnique({ where: { repairOrderId } });
  }

  findById(id: string): Promise<InspectionReport | null> {
    return this.prisma.inspectionReport.findUnique({ where: { id } });
  }

  create(data: Prisma.InspectionReportUncheckedCreateInput): Promise<InspectionReport> {
    return this.prisma.inspectionReport.create({ data });
  }

  update(id: string, data: Prisma.InspectionReportUncheckedUpdateInput): Promise<InspectionReport> {
    return this.prisma.inspectionReport.update({ where: { id }, data });
  }
}
