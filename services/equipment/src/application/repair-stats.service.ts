import { PrismaClient } from "@prisma/client";

export class RepairStatsService {
  constructor(private prisma: PrismaClient) {}

  async summary() {
    const [total, received, inspecting, repairing, manufacturer, completed, closed, cancelled] = await Promise.all([
      this.prisma.repairOrder.count(),
      this.prisma.repairOrder.count({ where: { status: "RECEIVED" } }),
      this.prisma.repairOrder.count({ where: { status: { in: ["INSPECTING_1ST", "INSPECTING_2ND"] } } }),
      this.prisma.repairOrder.count({ where: { status: { in: ["QUOTED", "APPROVED", "REPAIRING"] } } }),
      this.prisma.repairOrder.count({ where: { status: { in: ["SHIPPED_TO_MFG", "RECEIVED_FROM_MFG"] } } }),
      this.prisma.repairOrder.count({ where: { status: "COMPLETED" } }),
      this.prisma.repairOrder.count({ where: { status: "CLOSED" } }),
      this.prisma.repairOrder.count({ where: { status: "CANCELLED" } }),
    ]);

    // 평균 수리 기간 (완료된 건)
    const completedOrders = await this.prisma.repairOrder.findMany({
      where: { completedAt: { not: null } },
      select: { receivedAt: true, completedAt: true },
    });
    const avgDays = completedOrders.length > 0
      ? completedOrders.reduce((sum, o) => {
          const days = (o.completedAt!.getTime() - o.receivedAt.getTime()) / 86_400_000;
          return sum + days;
        }, 0) / completedOrders.length
      : 0;

    return {
      total, received, inspecting, repairing, manufacturer, completed, closed, cancelled,
      inProgress: received + inspecting + repairing + manufacturer,
      avgRepairDays: Math.round(avgDays * 10) / 10,
    };
  }

  async byEquipment() {
    const result = await this.prisma.repairOrder.groupBy({
      by: ["customerAssetId"],
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 20,
    });

    const assetIds = result.filter((r) => r.customerAssetId).map((r) => r.customerAssetId!);
    const assets = await this.prisma.customerAsset.findMany({
      where: { id: { in: assetIds } },
      select: { id: true, name: true, serialNumber: true },
    });
    const assetMap = new Map(assets.map((a) => [a.id, a]));

    return result
      .filter((r) => r.customerAssetId)
      .map((r) => ({
        assetId: r.customerAssetId,
        asset: assetMap.get(r.customerAssetId!) || null,
        count: r._count.id,
      }));
  }

  async monthly(months = 12) {
    const since = new Date();
    since.setMonth(since.getMonth() - months);
    since.setDate(1);
    since.setHours(0, 0, 0, 0);

    const orders = await this.prisma.repairOrder.findMany({
      where: { receivedAt: { gte: since } },
      select: { receivedAt: true, status: true, completedAt: true },
    });

    const result: Record<string, { received: number; completed: number }> = {};
    for (let i = 0; i < months; i++) {
      const d = new Date(since);
      d.setMonth(d.getMonth() + i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      result[key] = { received: 0, completed: 0 };
    }

    for (const o of orders) {
      const rKey = `${o.receivedAt.getFullYear()}-${String(o.receivedAt.getMonth() + 1).padStart(2, "0")}`;
      if (result[rKey]) result[rKey].received++;
      if (o.completedAt) {
        const cKey = `${o.completedAt.getFullYear()}-${String(o.completedAt.getMonth() + 1).padStart(2, "0")}`;
        if (result[cKey]) result[cKey].completed++;
      }
    }

    return Object.entries(result).map(([month, data]) => ({ month, ...data }));
  }

  async costs() {
    const costs = await this.prisma.repairCost.groupBy({
      by: ["costType"],
      _sum: { amount: true },
      _count: { id: true },
    });

    const totalAmount = costs.reduce((sum, c) => sum + Number(c._sum.amount || 0), 0);

    return {
      byType: costs.map((c) => ({
        costType: c.costType,
        totalAmount: Number(c._sum.amount || 0),
        count: c._count.id,
      })),
      totalAmount,
    };
  }

  async partsUsage() {
    const usage = await this.prisma.partTransaction.groupBy({
      by: ["partId"],
      where: { type: "OUT" },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 10,
    });

    const partIds = usage.map((u) => u.partId);
    const parts = await this.prisma.part.findMany({
      where: { id: { in: partIds } },
      select: { id: true, name: true, partNumber: true, stockQuantity: true, minStockLevel: true },
    });
    const partMap = new Map(parts.map((p) => [p.id, p]));

    return usage.map((u) => ({
      part: partMap.get(u.partId) || null,
      usedQuantity: u._sum.quantity || 0,
    }));
  }
}
