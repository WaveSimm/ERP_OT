import type { Prisma, InspectionReport } from "@prisma/client";

/**
 * InspectionReport aggregate 영속성 인터페이스 (Clean Architecture — domain 계층).
 * decision → RepairOrder sync(cross-aggregate)는 service 유지.
 */
export interface IInspectionReportRepository {
  findByRepairOrder(repairOrderId: string): Promise<InspectionReport | null>;
  findById(id: string): Promise<InspectionReport | null>;
  create(data: Prisma.InspectionReportUncheckedCreateInput): Promise<InspectionReport>;
  update(id: string, data: Prisma.InspectionReportUncheckedUpdateInput): Promise<InspectionReport>;
}
