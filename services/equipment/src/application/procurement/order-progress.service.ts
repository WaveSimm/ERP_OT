import { PrismaClient } from "@prisma/client";

export class OrderProgressService {
  constructor(private prisma: PrismaClient) {}

  async list(orderId: string, params: { page?: number; limit?: number } = {}) {
    const { page = 1, limit = 50 } = params;

    const [items, total] = await Promise.all([
      this.prisma.orderProgressLog.findMany({
        where: { orderId },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.orderProgressLog.count({ where: { orderId } }),
    ]);

    return { items, total, page, limit };
  }

  async create(orderId: string, data: { progress: number; note?: string; updatedBy: string }) {
    const order = await this.prisma.overseasOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new Error("발주를 찾을 수 없습니다.");

    if (data.progress < 0 || data.progress > 100) {
      throw new Error("진행률은 0~100 사이여야 합니다.");
    }

    const [log] = await Promise.all([
      this.prisma.orderProgressLog.create({
        data: { orderId, progress: data.progress, note: data.note ?? null, updatedBy: data.updatedBy },
      }),
      this.prisma.overseasOrder.update({
        where: { id: orderId },
        data: { productionProgress: data.progress, productionNotes: data.note ?? null },
      }),
    ]);

    return log;
  }

  async remove(logId: string) {
    const log = await this.prisma.orderProgressLog.findUnique({ where: { id: logId } });
    if (!log) throw new Error("진행 이력을 찾을 수 없습니다.");
    return this.prisma.orderProgressLog.delete({ where: { id: logId } });
  }
}
