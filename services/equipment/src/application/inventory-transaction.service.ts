import { PrismaClient, InventoryTransactionType } from "@prisma/client";

export class InventoryTransactionService {
  constructor(private prisma: PrismaClient) {}

  /** 입출고 이력 조회 */
  async listByItem(inventoryItemId: string) {
    return this.prisma.inventoryTransaction.findMany({
      where: { inventoryItemId },
      orderBy: { date: "desc" },
    });
  }

  /** 입출고 등록 */
  async create(data: {
    inventoryItemId: string;
    type: InventoryTransactionType;
    date: string;
    quantity?: number;
    fromLocation?: string;
    toLocation?: string;
    deliveryTo?: string;
    projectName?: string;
    assigneeName?: string;
    costNumber?: string;
    notes?: string;
    createdBy: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.inventoryItem.findUnique({ where: { id: data.inventoryItemId } });
      if (!item) throw new Error("재고를 찾을 수 없습니다.");

      const txn = await tx.inventoryTransaction.create({
        data: {
          inventoryItemId: data.inventoryItemId,
          type: data.type,
          date: new Date(data.date),
          quantity: data.quantity || 1,
          fromLocation: data.fromLocation ?? null,
          toLocation: data.toLocation ?? null,
          deliveryTo: data.deliveryTo ?? null,
          projectName: data.projectName ?? null,
          assigneeName: data.assigneeName ?? null,
          costNumber: data.costNumber ?? null,
          notes: data.notes ?? null,
          createdBy: data.createdBy,
        },
      });

      // 재고 상태 자동 업데이트
      const updateData: any = {};
      if (data.type === "RELEASE") {
        updateData.currentStatus = "RELEASED";
        if (data.projectName) updateData.projectName = data.projectName;
        if (data.assigneeName) updateData.assigneeName = data.assigneeName;
        if (data.toLocation) updateData.currentLocation = data.toLocation;
        if (item.trackingMode === "BULK") {
          updateData.quantity = Math.max(0, item.quantity - (data.quantity || 1));
        }
      } else if (data.type === "RETURN") {
        updateData.currentStatus = "IN_STOCK";
        if (data.toLocation) updateData.currentLocation = data.toLocation;
        if (item.trackingMode === "BULK") {
          updateData.quantity = item.quantity + (data.quantity || 1);
        }
      } else if (data.type === "TRANSFER") {
        if (data.toLocation) updateData.currentLocation = data.toLocation;
      } else if (data.type === "PURCHASE") {
        updateData.currentStatus = "IN_STOCK";
        if (data.toLocation) updateData.currentLocation = data.toLocation;
        if (item.trackingMode === "BULK") {
          updateData.quantity = item.quantity + (data.quantity || 1);
        }
      }

      if (Object.keys(updateData).length > 0) {
        await tx.inventoryItem.update({ where: { id: data.inventoryItemId }, data: updateData });
      }

      return txn;
    });
  }

  /** 전체 이력 조회 (최근) */
  async listRecent(params: { type?: InventoryTransactionType; limit?: number }) {
    return this.prisma.inventoryTransaction.findMany({
      where: params.type ? { type: params.type } : {},
      orderBy: { createdAt: "desc" },
      take: params.limit || 50,
      include: { inventoryItem: { select: { inventoryNo: true, productMaster: { select: { name: true } } } } },
    });
  }
}
