import { PrismaClient, AssetCostType, OrderCurrency } from "@prisma/client";

export class AssetCostService {
  constructor(private prisma: PrismaClient) {}

  /** 비용이력 조회 */
  async listByItem(inventoryItemId: string) {
    return this.prisma.assetCostEvent.findMany({
      where: { inventoryItemId },
      orderBy: { eventDate: "desc" },
    });
  }

  /** 추가비용 등록 + TCO 자동갱신 */
  async create(data: {
    inventoryItemId: string;
    type: AssetCostType;
    title: string;
    description?: string;
    vendor?: string;
    cost: number;
    currency?: OrderCurrency;
    foreignAmount?: number;
    exchangeRate?: number;
    eventDate: string;
    performedBy?: string;
    relatedOrderId?: string;
    notes?: string;
    createdBy: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.inventoryItem.findUnique({ where: { id: data.inventoryItemId } });
      if (!item) throw new Error("재고를 찾을 수 없습니다.");

      const event = await tx.assetCostEvent.create({
        data: {
          inventoryItemId: data.inventoryItemId,
          type: data.type,
          title: data.title,
          description: data.description ?? null,
          vendor: data.vendor ?? null,
          cost: data.cost,
          currency: data.currency ?? null,
          foreignAmount: data.foreignAmount ?? null,
          exchangeRate: data.exchangeRate ?? null,
          eventDate: new Date(data.eventDate),
          performedBy: data.performedBy ?? null,
          relatedOrderId: data.relatedOrderId ?? null,
          notes: data.notes ?? null,
          createdBy: data.createdBy,
        },
      });

      // TCO 갱신
      const newAdditional = Number(item.totalAdditionalCost) + data.cost;
      const baseAmount = Number(item.totalAmount) || 0;
      await tx.inventoryItem.update({
        where: { id: data.inventoryItemId },
        data: {
          totalAdditionalCost: newAdditional,
          totalCostOfOwnership: baseAmount + newAdditional,
        },
      });

      return event;
    });
  }

  /** 비용이벤트 삭제 + TCO 재계산 */
  async remove(id: string) {
    const event = await this.prisma.assetCostEvent.findUnique({ where: { id } });
    if (!event) throw new Error("비용이벤트를 찾을 수 없습니다.");

    return this.prisma.$transaction(async (tx) => {
      await tx.assetCostEvent.delete({ where: { id } });

      // TCO 재계산
      const remaining = await tx.assetCostEvent.aggregate({
        where: { inventoryItemId: event.inventoryItemId },
        _sum: { cost: true },
      });
      const totalAdditional = Number(remaining._sum.cost) || 0;
      const item = await tx.inventoryItem.findUnique({ where: { id: event.inventoryItemId } });
      const baseAmount = Number(item?.totalAmount) || 0;

      await tx.inventoryItem.update({
        where: { id: event.inventoryItemId },
        data: { totalAdditionalCost: totalAdditional, totalCostOfOwnership: baseAmount + totalAdditional },
      });
    });
  }
}
