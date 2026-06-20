import { PrismaClient, Prisma, Shipment } from "@prisma/client";
import type { IShipmentRepository } from "../../domain/repositories/shipment.repository.js";

/** IShipmentRepository 의 Prisma 구현 (infrastructure 계층). */
export class PrismaShipmentRepository implements IShipmentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string): Promise<Shipment | null> {
    return this.prisma.shipment.findUnique({ where: { id } });
  }

  findByRepairOrder(repairOrderId: string): Promise<Shipment[]> {
    return this.prisma.shipment.findMany({
      where: { repairOrderId },
      orderBy: { createdAt: "asc" },
    });
  }

  create(data: Prisma.ShipmentUncheckedCreateInput): Promise<Shipment> {
    return this.prisma.shipment.create({ data });
  }

  update(id: string, data: Prisma.ShipmentUncheckedUpdateInput): Promise<Shipment> {
    return this.prisma.shipment.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.shipment.delete({ where: { id } });
  }
}
