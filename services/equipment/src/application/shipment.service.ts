import { PrismaClient } from "@prisma/client";

export class ShipmentService {
  constructor(private prisma: PrismaClient) {}

  async listByRepairOrder(repairOrderId: string) {
    return this.prisma.shipment.findMany({
      where: { repairOrderId },
      orderBy: { createdAt: "desc" },
    });
  }

  async getById(id: string) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id },
      include: { repairOrder: { select: { orderNumber: true, customer: { select: { name: true } } } } },
    });
    if (!shipment) throw new Error("발송/입고 기록을 찾을 수 없습니다.");
    return shipment;
  }

  async create(data: {
    repairOrderId: string;
    direction: string;
    carrier?: string;
    trackingNumber?: string;
    shippedAt?: string;
    receivedAt?: string;
    shippingCost?: number;
    notes?: string;
  }) {
    const { shippedAt, receivedAt, ...rest } = data;
    return this.prisma.shipment.create({
      data: {
        ...rest,
        shippedAt: shippedAt ? new Date(shippedAt) : undefined,
        receivedAt: receivedAt ? new Date(receivedAt) : undefined,
      } as any,
    });
  }

  async update(id: string, data: {
    carrier?: string;
    trackingNumber?: string;
    shippedAt?: string;
    receivedAt?: string;
    shippingCost?: number;
    notes?: string;
  }) {
    const { shippedAt, receivedAt, ...rest } = data;
    return this.prisma.shipment.update({
      where: { id },
      data: {
        ...rest,
        ...(shippedAt !== undefined ? { shippedAt: shippedAt ? new Date(shippedAt) : null } : {}),
        ...(receivedAt !== undefined ? { receivedAt: receivedAt ? new Date(receivedAt) : null } : {}),
      } as any,
    });
  }

  async changeStatus(id: string, status: string) {
    const shipment = await this.prisma.shipment.findUnique({ where: { id } });
    if (!shipment) throw new Error("발송/입고 기록을 찾을 수 없습니다.");

    const allowed: Record<string, string[]> = {
      PREPARING: ["SHIPPED"],
      SHIPPED: ["IN_TRANSIT", "DELIVERED"],
      IN_TRANSIT: ["DELIVERED"],
      DELIVERED: [],
    };

    if (!(allowed[shipment.status] || []).includes(status)) {
      throw new Error(`상태 전이가 허용되지 않습니다: ${shipment.status} → ${status}`);
    }

    const updateData: any = { status };
    if (status === "SHIPPED") updateData.shippedAt = new Date();
    if (status === "DELIVERED") updateData.receivedAt = new Date();

    return this.prisma.shipment.update({ where: { id }, data: updateData });
  }
}
