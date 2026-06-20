import type { Prisma, Shipment } from "@prisma/client";

/**
 * Shipment aggregate 영속성 인터페이스 (Clean Architecture — domain 계층).
 * getById(cross-aggregate include: repairOrder)는 service 유지.
 */
export interface IShipmentRepository {
  findById(id: string): Promise<Shipment | null>;
  findByRepairOrder(repairOrderId: string): Promise<Shipment[]>;
  create(data: Prisma.ShipmentUncheckedCreateInput): Promise<Shipment>;
  update(id: string, data: Prisma.ShipmentUncheckedUpdateInput): Promise<Shipment>;
  delete(id: string): Promise<void>;
}
