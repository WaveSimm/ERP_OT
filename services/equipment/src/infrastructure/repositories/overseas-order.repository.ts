import { PrismaClient, Prisma, OverseasOrder, OverseasOrderItem } from "@prisma/client";
import type {
  IOverseasOrderRepository,
  OverseasOrderWithItemsContract,
  OverseasOrderItemWithOrderStatus,
} from "../../domain/repositories/overseas-order.repository.js";

/** IOverseasOrderRepository 의 Prisma 구현 (infrastructure 계층). */
export class PrismaOverseasOrderRepository implements IOverseasOrderRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string): Promise<OverseasOrder | null> {
    return this.prisma.overseasOrder.findUnique({ where: { id } });
  }

  create(data: Prisma.OverseasOrderUncheckedCreateInput): Promise<OverseasOrderWithItemsContract> {
    return this.prisma.overseasOrder.create({
      data,
      include: { items: true, contract: { select: { id: true, contractNumber: true, name: true } } },
    });
  }

  update(id: string, data: Prisma.OverseasOrderUncheckedUpdateInput): Promise<OverseasOrder> {
    return this.prisma.overseasOrder.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.overseasOrder.delete({ where: { id } });
  }

  findItemById(itemId: string): Promise<OverseasOrderItemWithOrderStatus | null> {
    return this.prisma.overseasOrderItem.findUnique({
      where: { id: itemId },
      include: { order: { select: { status: true } } },
    });
  }

  createItem(data: Prisma.OverseasOrderItemUncheckedCreateInput): Promise<OverseasOrderItem> {
    return this.prisma.overseasOrderItem.create({ data });
  }

  updateItem(itemId: string, data: Prisma.OverseasOrderItemUncheckedUpdateInput): Promise<OverseasOrderItem> {
    return this.prisma.overseasOrderItem.update({ where: { id: itemId }, data });
  }

  async deleteItem(itemId: string): Promise<void> {
    await this.prisma.overseasOrderItem.delete({ where: { id: itemId } });
  }
}
