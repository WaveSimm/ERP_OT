import { FastifyInstance } from "fastify";

export async function notificationRoutes(fastify: FastifyInstance) {
  // GET /api/v1/notifications — 내 멘션/알림 목록
  fastify.get("/", async (req, reply) => {
    const userId = req.userId;
    const query = req.query as { unreadOnly?: string; page?: string; pageSize?: string };
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.min(50, Math.max(1, Number(query.pageSize ?? 20)));
    const unreadOnly = query.unreadOnly === "true";

    const where = {
      userId,
      ...(unreadOnly ? { isRead: false } : {}),
    };

    const [rows, total] = await Promise.all([
      fastify.prisma.mention.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      fastify.prisma.mention.count({ where }),
    ]);

    // 대상 미리보기 해석 (현재 COMMENT; WORKLOG·ISSUE·POST 는 후속 단계에서 추가)
    const commentIds = rows.filter((r) => r.sourceType === "COMMENT").map((r) => r.sourceId);
    const commentMap = new Map<string, string>();
    if (commentIds.length > 0) {
      const comments = await fastify.prisma.comment.findMany({
        where: { id: { in: commentIds } },
        select: { id: true, content: true },
      });
      for (const c of comments) commentMap.set(c.id, c.content);
    }

    const items = rows.map((r) => ({
      id: r.id,
      sourceType: r.sourceType,
      sourceId: r.sourceId,
      taskId: r.taskId,
      actorId: r.actorId,
      isRead: r.isRead,
      createdAt: r.createdAt,
      preview: r.sourceType === "COMMENT" ? commentMap.get(r.sourceId) ?? null : null,
    }));

    return reply.send({ items, total, page, pageSize });
  });

  // GET /api/v1/notifications/unread-count — 미읽음 멘션 수 (알림 벨 배지)
  fastify.get("/unread-count", async (req, reply) => {
    const userId = req.userId;
    const count = await fastify.prisma.mention.count({ where: { userId, isRead: false } });
    return reply.send({ count });
  });

  // PATCH /api/v1/notifications/:id/read — 개별 읽음 처리
  fastify.patch("/:id/read", async (req, reply) => {
    const { id } = req.params as { id: string };
    const userId = req.userId;
    const mention = await fastify.prisma.mention.findFirst({ where: { id, userId } });
    if (!mention) return reply.status(404).send({ code: "NOT_FOUND", message: "알림을 찾을 수 없습니다." });
    await fastify.prisma.mention.update({ where: { id }, data: { isRead: true } });
    return reply.send({ id, isRead: true });
  });

  // PATCH /api/v1/notifications/read-all — 전체 읽음 처리
  fastify.patch("/read-all", async (req, reply) => {
    const userId = req.userId;
    const result = await fastify.prisma.mention.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
    return reply.send({ updatedCount: result.count });
  });
}
