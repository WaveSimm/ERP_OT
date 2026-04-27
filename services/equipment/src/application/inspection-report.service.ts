import { PrismaClient } from "@prisma/client";

export class InspectionReportService {
  constructor(private prisma: PrismaClient) {}

  async getByRepairOrder(repairOrderId: string) {
    return this.prisma.inspectionReport.findUnique({
      where: { repairOrderId },
    });
  }

  async create(data: {
    repairOrderId: string;
    reportNumber?: string;
    equipmentHistory?: any;
    customerInfo?: any;
    inspectorId?: string;
    inspectorName?: string;
    symptom?: string;
    inspectionSteps?: any;
    result?: string;
    decision?: string;
    decisionReason?: string;
    needsMfgRepair?: boolean;
    mfgRepairReason?: string;
  }) {
    const report = await this.prisma.inspectionReport.create({ data: data as any });
    if (data.decision) {
      await this.syncDecisionToOrder(data.repairOrderId, data.decision, data.decisionReason, 1);
    }
    return report;
  }

  async update(id: string, data: {
    reportNumber?: string;
    equipmentHistory?: any;
    customerInfo?: any;
    inspectorId?: string;
    inspectorName?: string;
    symptom?: string;
    inspectionSteps?: any;
    result?: string;
    decision?: string;
    decisionReason?: string;
    needsMfgRepair?: boolean;
    mfgRepairReason?: string;
  }) {
    const before = await this.prisma.inspectionReport.findUnique({ where: { id } });
    const report = await this.prisma.inspectionReport.update({ where: { id }, data: data as any });
    if (before && data.decision !== undefined) {
      // 현재 AS 상태에 따라 1차/2차 decision을 구분 저장
      const order = await this.prisma.repairOrder.findUnique({ where: { id: before.repairOrderId } });
      const phase = order && ["INSPECTING_2ND", "RECEIVED_FROM_MFG"].includes(order.status) ? 2 : 1;
      await this.syncDecisionToOrder(before.repairOrderId, data.decision, data.decisionReason ?? null, phase);
    }
    return report;
  }

  private async syncDecisionToOrder(repairOrderId: string, decision: string, reason: string | null | undefined, phase: 1 | 2) {
    const field = phase === 2
      ? { decision2nd: decision as any, decision2ndReason: reason ?? null }
      : { decision1st: decision as any, decision1stReason: reason ?? null };
    await this.prisma.repairOrder.update({ where: { id: repairOrderId }, data: field as any });
  }
}
