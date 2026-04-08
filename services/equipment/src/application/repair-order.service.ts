import { PrismaClient, RepairOrderStatus } from "@prisma/client";

const TRANSITIONS: Record<string, string[]> = {
  RECEIVED:          ["INSPECTING_1ST", "CANCELLED"],
  INSPECTING_1ST:    ["QUOTED", "REPAIRING", "SHIPPED_TO_MFG", "COMPLETED", "CANCELLED"],
  QUOTED:            ["APPROVED", "CANCELLED"],
  APPROVED:          ["REPAIRING", "SHIPPED_TO_MFG", "CANCELLED"],
  REPAIRING:         ["COMPLETED", "CANCELLED"],
  SHIPPED_TO_MFG:    ["RECEIVED_FROM_MFG", "CANCELLED"],
  RECEIVED_FROM_MFG: ["INSPECTING_2ND", "COMPLETED", "CANCELLED"],
  INSPECTING_2ND:    ["COMPLETED", "CANCELLED"],
  COMPLETED:         ["CLOSED"],
  CLOSED:            [],
  CANCELLED:         [],
};

export class RepairOrderService {
  constructor(private prisma: PrismaClient) {}

  async generateOrderNumber(): Promise<string> {
    const year = new Date().getFullYear();
    try {
      const result = await this.prisma.$queryRaw<[{ nextval: bigint }]>`
        SELECT nextval('equipment.repair_order_seq')`;
      const seq = String(result[0].nextval).padStart(4, "0");
      return `AS-${year}-${seq}`;
    } catch {
      // Fallback: count-based
      const count = await this.prisma.repairOrder.count();
      return `AS-${year}-${String(count + 1).padStart(4, "0")}`;
    }
  }

  async list(params: {
    status?: string;
    statusGroup?: string;
    customerId?: string;
    search?: string;
    page?: number;
    limit?: number;
  } = {}) {
    const { status, statusGroup, customerId, search, page = 1, limit = 50 } = params;
    const where: any = {};

    if (status) {
      where.status = status;
    } else if (statusGroup) {
      const groups: Record<string, string[]> = {
        received: ["RECEIVED"],
        inspecting: ["INSPECTING_1ST", "INSPECTING_2ND"],
        repairing: ["QUOTED", "APPROVED", "REPAIRING"],
        manufacturer: ["SHIPPED_TO_MFG", "RECEIVED_FROM_MFG"],
        completed: ["COMPLETED", "CLOSED"],
      };
      if (groups[statusGroup]) where.status = { in: groups[statusGroup] };
    }

    if (customerId) where.customerId = customerId;

    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: "insensitive" } },
        { symptom: { contains: search, mode: "insensitive" } },
        { customer: { name: { contains: search, mode: "insensitive" } } },
        { customerAsset: { serialNumber: { contains: search, mode: "insensitive" } } },
        { customerAsset: { name: { contains: search, mode: "insensitive" } } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.repairOrder.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true } },
          customerAsset: { select: { id: true, name: true, serialNumber: true, manufacturer: true } },
          equipment: { select: { id: true, name: true, serialNumber: true } },
          sensor: { select: { id: true, name: true, serialNumber: true } },
        },
        orderBy: { receivedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.repairOrder.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async getById(id: string) {
    const order = await this.prisma.repairOrder.findUnique({
      where: { id },
      include: {
        customer: true,
        customerAsset: true,
        equipment: { select: { id: true, name: true, serialNumber: true, status: true } },
        sensor: { select: { id: true, name: true, serialNumber: true, status: true } },
        inspectionReport: true,
        costs: { orderBy: { createdAt: "desc" } },
        quotes: { include: { items: true }, orderBy: { createdAt: "desc" } },
        shipments: { orderBy: { createdAt: "desc" } },
        usedParts: {
          include: { part: { select: { id: true, name: true, partNumber: true } } },
          orderBy: { performedAt: "desc" },
        },
      },
    });
    if (!order) throw new Error("AS 접수를 찾을 수 없습니다.");
    return order;
  }

  async create(data: {
    orderType?: string;
    priority?: string;
    customerId?: string;
    customerAssetId?: string;
    equipmentId?: string;
    sensorId?: string;
    symptom?: string;
    currentLocation?: string;
    otInventoryNo?: string;
    isWarranty?: boolean;
    receivedBy?: string;
    assigneeId?: string;
    assigneeName?: string;
    receivedAt?: string;
    notes?: string;
  }) {
    const orderNumber = await this.generateOrderNumber();
    const { receivedAt, ...rest } = data;

    const order = await this.prisma.repairOrder.create({
      data: {
        orderNumber,
        ...rest,
        receivedAt: receivedAt ? new Date(receivedAt) : new Date(),
      } as any,
      include: {
        customer: { select: { id: true, name: true } },
        customerAsset: { select: { id: true, name: true, serialNumber: true } },
      },
    });

    // 자사 장비 AS 시 상태 변경
    if (data.equipmentId) {
      await this.prisma.equipment.update({
        where: { id: data.equipmentId },
        data: { status: "IN_MAINTENANCE" },
      });
    }
    if (data.sensorId) {
      await this.prisma.sensor.update({
        where: { id: data.sensorId },
        data: { status: "IN_MAINTENANCE" },
      });
    }

    return order;
  }

  async update(id: string, data: {
    orderType?: string;
    priority?: string;
    customerId?: string;
    customerAssetId?: string;
    symptom?: string;
    currentLocation?: string;
    otInventoryNo?: string;
    diagnosis1st?: string;
    inspector1stId?: string;
    inspector1stName?: string;
    needsMfgRepair?: boolean;
    mfgReferenceNo?: string;
    diagnosis2nd?: string;
    inspector2ndId?: string;
    inspector2ndName?: string;
    repairDetails?: string;
    isWarranty?: boolean;
    assigneeId?: string;
    assigneeName?: string;
    estimatedDays?: number;
    notes?: string;
  }) {
    return this.prisma.repairOrder.update({
      where: { id },
      data: data as any,
    });
  }

  async changeStatus(id: string, newStatus: string, userId?: string) {
    const order = await this.prisma.repairOrder.findUnique({ where: { id } });
    if (!order) throw new Error("AS 접수를 찾을 수 없습니다.");

    const allowed = TRANSITIONS[order.status] || [];
    if (!allowed.includes(newStatus)) {
      throw new Error(`상태 전이가 허용되지 않습니다: ${order.status} → ${newStatus}`);
    }

    const updateData: any = { status: newStatus as RepairOrderStatus };

    // 자동 동작: 제조사 발송 시 Shipment(OUTBOUND) 자동 생성
    if (newStatus === "SHIPPED_TO_MFG") {
      await this.prisma.shipment.create({
        data: {
          repairOrderId: id,
          direction: "OUTBOUND",
          status: "PREPARING",
        },
      });
    }

    // 제조사 입고 시 OUTBOUND Shipment 상태 업데이트
    if (newStatus === "RECEIVED_FROM_MFG") {
      const outbound = await this.prisma.shipment.findFirst({
        where: { repairOrderId: id, direction: "OUTBOUND" },
        orderBy: { createdAt: "desc" },
      });
      if (outbound) {
        await this.prisma.shipment.update({
          where: { id: outbound.id },
          data: { status: "DELIVERED", receivedAt: new Date() },
        });
      }
    }

    if (newStatus === "COMPLETED") {
      updateData.completedAt = new Date();
      // MaintenanceRecord 자동 생성
      if (order.equipmentId || order.sensorId) {
        await this.prisma.maintenanceRecord.create({
          data: {
            equipmentId: order.equipmentId,
            sensorId: order.sensorId,
            type: "CORRECTIVE",
            title: `AS 수리: ${order.orderNumber}`,
            description: order.repairDetails,
            performedBy: order.assigneeName,
            performedAt: new Date(),
            completedAt: new Date(),
            createdBy: userId || "system",
          },
        });
      }
    }

    if (newStatus === "CLOSED") {
      updateData.closedAt = new Date();
      // 자사 장비 상태 복원
      if (order.equipmentId) {
        await this.prisma.equipment.update({
          where: { id: order.equipmentId },
          data: { status: "AVAILABLE" },
        });
      }
      if (order.sensorId) {
        await this.prisma.sensor.update({
          where: { id: order.sensorId },
          data: { status: "AVAILABLE" },
        });
      }
    }

    return this.prisma.repairOrder.update({ where: { id }, data: updateData });
  }

  async updateTechStatus(id: string, techStatus: string) {
    return this.prisma.repairOrder.update({ where: { id }, data: { techStatus } });
  }

  async updateSalesStatus(id: string, salesStatus: string) {
    return this.prisma.repairOrder.update({ where: { id }, data: { salesStatus } });
  }

  async remove(id: string) {
    const order = await this.prisma.repairOrder.findUnique({ where: { id } });
    if (!order) throw new Error("AS 접수를 찾을 수 없습니다.");
    if (order.status !== "RECEIVED" && order.status !== "CANCELLED") {
      throw new Error("접수 또는 취소 상태의 건만 삭제할 수 있습니다.");
    }
    return this.prisma.repairOrder.delete({ where: { id } });
  }

  async getStatusTransitions(id: string) {
    const order = await this.prisma.repairOrder.findUnique({ where: { id } });
    if (!order) throw new Error("AS 접수를 찾을 수 없습니다.");
    return { currentStatus: order.status, allowedTransitions: TRANSITIONS[order.status] || [] };
  }
}
