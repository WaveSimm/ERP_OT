import { PrismaClient, Prisma, InspectionDecision } from "@prisma/client";
import type { IInspectionReportRepository } from "../../domain/repositories/inspection-report.repository.js";

export class InspectionReportService {
  // repo: InspectionReport aggregate. prisma: decision → RepairOrder sync(cross-aggregate).
  constructor(
    private readonly repo: IInspectionReportRepository,
    private readonly prisma: PrismaClient,
  ) {}

  async getByRepairOrder(repairOrderId: string) {
    return this.repo.findByRepairOrder(repairOrderId);
  }

  async create(data: {
    repairOrderId: string;
    reportNumber?: string;
    equipmentHistory?: Prisma.InputJsonValue;
    customerInfo?: Prisma.InputJsonValue;
    inspectorId?: string;
    inspectorName?: string;
    symptom?: string;
    inspectionSteps?: Prisma.InputJsonValue;
    phaseAttachments?: Prisma.InputJsonValue;     // 2026-05-06 v1.2 — phase별 첨부 ({first,inHouse,mfg,second})
    result?: string;
    decision?: string;
    decisionReason?: string;
    needsMfgRepair?: boolean;
    mfgRepairReason?: string;
  }) {
    const report = await this.repo.create(data as Prisma.InspectionReportUncheckedCreateInput);
    if (data.decision) {
      await this.syncDecisionToOrder(data.repairOrderId, data.decision, data.decisionReason, 1);
    }
    return report;
  }

  async update(id: string, data: {
    reportNumber?: string;
    equipmentHistory?: Prisma.InputJsonValue;
    customerInfo?: Prisma.InputJsonValue;
    inspectorId?: string;
    inspectorName?: string;
    symptom?: string;
    inspectionSteps?: Prisma.InputJsonValue;
    phaseAttachments?: Prisma.InputJsonValue;     // 2026-05-06 v1.2 — phase별 첨부
    result?: string;
    decision?: string;
    decisionReason?: string;
    needsMfgRepair?: boolean;
    mfgRepairReason?: string;
  }) {
    const before = await this.repo.findById(id);
    const report = await this.repo.update(id, data as Prisma.InspectionReportUncheckedUpdateInput);
    if (before && data.decision !== undefined) {
      // 현재 AS 상태에 따라 1차/2차 decision을 구분 저장
      const order = await this.prisma.repairOrder.findUnique({ where: { id: before.repairOrderId } });
      const phase = order && ["INSPECTING_2ND", "RECEIVED_FROM_MFG"].includes(order.status) ? 2 : 1;
      await this.syncDecisionToOrder(before.repairOrderId, data.decision, data.decisionReason ?? null, phase);
    }
    return report;
  }

  private async syncDecisionToOrder(repairOrderId: string, decision: string, reason: string | null | undefined, phase: 1 | 2) {
    const field: Prisma.RepairOrderUncheckedUpdateInput = phase === 2
      ? { decision2nd: decision as InspectionDecision, decision2ndReason: reason ?? null }
      : { decision1st: decision as InspectionDecision, decision1stReason: reason ?? null };
    await this.prisma.repairOrder.update({ where: { id: repairOrderId }, data: field });
  }
}
