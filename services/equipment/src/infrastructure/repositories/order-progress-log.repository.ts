import { PrismaClient, Prisma, OrderProgressLog } from "@prisma/client";
import type { IOrderProgressLogRepository } from "../../domain/repositories/order-progress-log.repository.js";

/** IOrderProgressLogRepository 의 Prisma 구현 (infrastructure 계층). */
export class PrismaOrderProgressLogRepository implements IOrderProgressLogRepository {
  constructor(private readonly prisma: PrismaClient) {}

  listByOrder(orderId: string, skip: number, take: number): Promise<OrderProgressLog[]> {
    return this.prisma.orderProgressLog.findMany({
      where: { orderId },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    });
  }

  countByOrder(orderId: string): Promise<number> {
    return this.prisma.orderProgressLog.count({ where: { orderId } });
  }

  findById(id: string): Promise<OrderProgressLog | null> {
    return this.prisma.orderProgressLog.findUnique({ where: { id } });
  }

  create(data: Prisma.OrderProgressLogUncheckedCreateInput): Promise<OrderProgressLog> {
    return this.prisma.orderProgressLog.create({ data });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.orderProgressLog.delete({ where: { id } });
  }
}
