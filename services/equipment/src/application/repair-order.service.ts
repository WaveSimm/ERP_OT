import { PrismaClient, RepairOrderStatus } from "@prisma/client";

const TRANSITIONS: Record<string, string[]> = {
  RECEIVED:          ["INSPECTING_1ST", "CANCELLED"],
  INSPECTING_1ST:    ["QUOTED", "REPAIRING", "SHIPPED_TO_MFG", "COMPLETED", "NO_FAULT", "NO_REPAIR", "CANCELLED"],
  QUOTED:            ["APPROVED", "CANCELLED"],
  APPROVED:          ["REPAIRING", "SHIPPED_TO_MFG", "CANCELLED"],
  REPAIRING:         ["COMPLETED", "CANCELLED"],
  SHIPPED_TO_MFG:    ["RECEIVED_FROM_MFG", "CANCELLED"],
  RECEIVED_FROM_MFG: ["INSPECTING_2ND", "COMPLETED", "NO_FAULT", "NO_REPAIR", "CANCELLED"],
  INSPECTING_2ND:    ["COMPLETED", "NO_FAULT", "NO_REPAIR", "CANCELLED"],
  COMPLETED:         ["CLOSED"],
  NO_FAULT:          ["CLOSED"],
  NO_REPAIR:         ["CLOSED"],
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
    sortBy?: string;
    sortOrder?: "asc" | "desc";
  } = {}) {
    const { status, statusGroup, customerId, search, page = 1, limit = 50, sortBy, sortOrder } = params;
    const where: any = {};

    if (status) {
      where.status = status;
    } else if (statusGroup) {
      const groups: Record<string, string[]> = {
        received: ["RECEIVED"],
        inspecting: ["INSPECTING_1ST", "INSPECTING_2ND"],
        repairing: ["QUOTED", "APPROVED", "REPAIRING"],
        manufacturer: ["SHIPPED_TO_MFG"],
        received_from_mfg: ["RECEIVED_FROM_MFG"],
        completed: ["COMPLETED", "NO_FAULT", "NO_REPAIR", "CLOSED"],
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

    // 정렬: 컬럼별 매핑. 알 수 없는 sortBy는 기본 receivedAt desc로 fallback.
    const order = sortOrder === "asc" ? "asc" : "desc";
    const sortMap: Record<string, any> = {
      orderNumber:  { orderNumber: order },
      customer:     { customer: { name: order } },
      asset:        { customerAsset: { name: order } },
      serialNumber: { customerAsset: { serialNumber: order } },
      status:       { status: order },
      techStatus:   { techStatus: order },
      salesStatus:  { salesStatus: order },
      priority:     { priority: order },
      assignee:     { assigneeName: order },
      receivedAt:   { receivedAt: order },
    };
    const orderBy = (sortBy && sortMap[sortBy]) ? sortMap[sortBy] : { receivedAt: "desc" };

    const [items, total] = await Promise.all([
      this.prisma.repairOrder.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true } },
          customerAsset: { select: { id: true, name: true, serialNumber: true, manufacturer: true } },
          equipment: { select: { id: true, name: true, serialNumber: true } },
          sensor: { select: { id: true, name: true, serialNumber: true } },
        },
        orderBy,
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
        shipments: { orderBy: { createdAt: "asc" } },
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
    decision1st?: string | null;
    decision1stReason?: string | null;
    needsMfgRepair?: boolean;
    mfgReferenceNo?: string;
    diagnosis2nd?: string;
    inspector2ndId?: string;
    inspector2ndName?: string;
    decision2nd?: string | null;
    decision2ndReason?: string | null;
    // 제조사 견적/발주 + 추가 날짜
    quoteReceivedAt?: string | null;
    quoteApprovedAt?: string | null;
    poIssuedAt?: string | null;
    stockedAt?: string | null;
    handedToTechAt?: string | null;
    deliveryDueAt?: string | null;
    shippingAssigneeName?: string | null;
    mfgQuoteNumber?: string | null;
    mfgQuoteAmount?: number | null;
    mfgQuoteCurrency?: string | null;
    mfgPoNumber?: string | null;
    mfgPoAmount?: number | null;
    mfgPoCurrency?: string | null;
    repairDetails?: string;
    // 제조사 수리 phase (2026-05-06 v1.2)
    mfgInspectionResult?: string | null;
    mfgRepairDetails?: string | null;
    isWarranty?: boolean;
    assigneeId?: string;
    assigneeName?: string;
    estimatedDays?: number;
    notes?: string;
    receivedAt?: string | null;
  }) {
    const d: any = { ...data };
    const dateFields = ["receivedAt", "quoteReceivedAt", "quoteApprovedAt", "poIssuedAt", "stockedAt", "handedToTechAt", "deliveryDueAt"];
    for (const k of dateFields) {
      if (d[k] !== undefined) d[k] = d[k] ? new Date(d[k]) : null;
    }
    return this.prisma.repairOrder.update({
      where: { id },
      data: d,
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

    // 본사 입고 시:
    //  1) 기존 OUTBOUND(최근 PREPARING/IN_TRANSIT)를 DELIVERED로 마감 — 제조사 수령으로 간주
    //  2) 신규 INBOUND(status=DELIVERED, receivedAt=now()) 생성 — 본사 수령 이벤트
    //  INBOUND 중복 생성을 막기 위해 동일 repairOrderId의 INBOUND 존재 여부 먼저 확인(idempotent).
    if (newStatus === "RECEIVED_FROM_MFG") {
      const outbound = await this.prisma.shipment.findFirst({
        where: { repairOrderId: id, direction: "OUTBOUND" },
        orderBy: { createdAt: "desc" },
      });
      if (outbound && outbound.status !== "DELIVERED") {
        await this.prisma.shipment.update({
          where: { id: outbound.id },
          data: { status: "DELIVERED" },
        });
      }

      const existingInbound = await this.prisma.shipment.findFirst({
        where: { repairOrderId: id, direction: "INBOUND" },
        orderBy: { createdAt: "desc" },
      });
      if (!existingInbound) {
        await this.prisma.shipment.create({
          data: {
            repairOrderId: id,
            direction: "INBOUND",
            status: "DELIVERED",
            receivedAt: new Date(),
          },
        });
      }
    }

    if (newStatus === "COMPLETED") {
      updateData.completedAt = new Date();
      // MaintenanceRecord 자동 생성 (실제 수리 발생 전제)
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

    // NO_FAULT(정상) · NO_REPAIR(수리안함) — completedAt만 기록, MaintenanceRecord 생성 안 함
    if (newStatus === "NO_FAULT" || newStatus === "NO_REPAIR") {
      updateData.completedAt = new Date();
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

  // 취소된 수리건을 RECEIVED 단계로 복구
  async restore(id: string) {
    const order = await this.prisma.repairOrder.findUnique({ where: { id } });
    if (!order) throw new Error("AS 접수를 찾을 수 없습니다.");
    if (order.status !== "CANCELLED") {
      throw new Error("취소 상태에서만 복구할 수 있습니다.");
    }
    return this.prisma.repairOrder.update({
      where: { id },
      data: { status: "RECEIVED" },
    });
  }

  async remove(id: string) {
    const order = await this.prisma.repairOrder.findUnique({ where: { id } });
    if (!order) throw new Error("AS 접수를 찾을 수 없습니다.");
    // 삭제 가능: 접수 초기 상태(RECEIVED) + 종결 상태 5종(CANCELLED/COMPLETED/NO_FAULT/NO_REPAIR/CLOSED)
    const deletable = ["RECEIVED", "CANCELLED", "COMPLETED", "NO_FAULT", "NO_REPAIR", "CLOSED"];
    if (!deletable.includes(order.status)) {
      throw new Error("진행 중인 AS 접수는 삭제할 수 없습니다. 먼저 완료·종료·취소 처리하세요.");
    }
    return this.prisma.repairOrder.delete({ where: { id } });
  }

  async getStatusTransitions(id: string) {
    const order = await this.prisma.repairOrder.findUnique({ where: { id } });
    if (!order) throw new Error("AS 접수를 찾을 수 없습니다.");
    return { currentStatus: order.status, allowedTransitions: TRANSITIONS[order.status] || [] };
  }
}
