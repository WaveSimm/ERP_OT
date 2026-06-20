import { PrismaClient } from "@prisma/client";
import type { IOrderProgressLogRepository } from "../../domain/repositories/order-progress-log.repository.js";

export class OrderProgressService {
  // repo: OrderProgressLog aggregate CRUD(Clean Arch). prisma: create의 overseasOrder 진행률 갱신(cross).
  constructor(
    private readonly repo: IOrderProgressLogRepository,
    private readonly prisma: PrismaClient,
  ) {}

  async list(orderId: string, params: { page?: number; limit?: number } = {}) {
    const { page = 1, limit = 50 } = params;

    const [items, total] = await Promise.all([
      this.repo.listByOrder(orderId, (page - 1) * limit, limit),
      this.repo.countByOrder(orderId),
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
      this.repo.create({ orderId, progress: data.progress, note: data.note ?? null, updatedBy: data.updatedBy }),
      this.prisma.overseasOrder.update({
        where: { id: orderId },
        data: { productionProgress: data.progress, productionNotes: data.note ?? null },
      }),
    ]);

    return log;
  }

  async remove(logId: string) {
    const log = await this.repo.findById(logId);
    if (!log) throw new Error("진행 이력을 찾을 수 없습니다.");
    await this.repo.delete(logId);
  }
}
