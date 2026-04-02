import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";

export class NotificationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: Redis,
  ) {}

  async create(data: {
    userId: string;
    type: string;
    source?: string;
    title: string;
    body: string;
    priority?: number;
    linkUrl?: string;
    metadata?: object;
  }) {
    const notification = await this.prisma.notification.create({
      data: {
        userId: data.userId,
        type: data.type,
        source: data.source ?? "attendance",
        title: data.title,
        body: data.body,
        priority: data.priority ?? 2,
        linkUrl: data.linkUrl ?? null,
        metadata: data.metadata as any ?? null,
      },
    });

    // Redis Pub/Sub으로 실시간 전달
    await this.redis.publish(
      `notification:${data.userId}`,
      JSON.stringify(notification),
    );

    return notification;
  }

  async getList(userId: string, params: { unreadOnly?: boolean; page?: number; pageSize?: number }) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(50, params.pageSize ?? 20);
    const where = { userId, ...(params.unreadOnly ? { isRead: false } : {}) };

    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async getUnreadCount(userId: string) {
    return this.prisma.notification.count({ where: { userId, isRead: false } });
  }

  async markRead(id: string, userId: string) {
    const n = await this.prisma.notification.findFirst({ where: { id, userId } });
    if (!n) throw new Error("알림을 찾을 수 없습니다.");
    return this.prisma.notification.update({ where: { id }, data: { isRead: true } });
  }

  async markAllRead(userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
    return { updatedCount: result.count };
  }
}
