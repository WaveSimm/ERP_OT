import { PrismaClient, Prisma, PurchaseOrder } from "@prisma/client";
import type { IPurchaseOrderRepository, PurchaseOrderWithItems } from "../../domain/repositories/purchase-order.repository.js";

/** IPurchaseOrderRepository 의 Prisma 구현 (infrastructure 계층). */
export class PrismaPurchaseOrderRepository implements IPurchaseOrderRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string): Promise<PurchaseOrder | null> {
    return this.prisma.purchaseOrder.findUnique({ where: { id } });
  }

  create(data: Prisma.PurchaseOrderUncheckedCreateInput): Promise<PurchaseOrderWithItems> {
    return this.prisma.purchaseOrder.create({
      data,
      include: { items: { include: { part: { select: { id: true, name: true, partNumber: true } } } } },
    });
  }

  update(id: string, data: Prisma.PurchaseOrderUncheckedUpdateInput): Promise<PurchaseOrder> {
    return this.prisma.purchaseOrder.update({ where: { id }, data });
  }
}
