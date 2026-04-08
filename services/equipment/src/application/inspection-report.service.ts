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
    needsMfgRepair?: boolean;
    mfgRepairReason?: string;
  }) {
    return this.prisma.inspectionReport.create({ data: data as any });
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
    needsMfgRepair?: boolean;
    mfgRepairReason?: string;
  }) {
    return this.prisma.inspectionReport.update({ where: { id }, data: data as any });
  }
}
