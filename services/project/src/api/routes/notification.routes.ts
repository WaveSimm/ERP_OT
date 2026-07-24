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

    // 대상 미리보기 해석 (COMMENT·WORKLOG·ISSUE; POST/BOARD_COMMENT는 게시판 단계에서 추가)
    const idsOf = (type: string) => rows.filter((r) => r.sourceType === type).map((r) => r.sourceId);
    const previewMap = new Map<string, string>(); // key: `${type}:${id}`
    const [comments, workLogs, issues] = await Promise.all([
      idsOf("COMMENT").length
        ? fastify.prisma.comment.findMany({ where: { id: { in: idsOf("COMMENT") } }, select: { id: true, content: true } })
        : Promise.resolve([]),
      idsOf("WORKLOG").length
        ? fastify.prisma.workLog.findMany({ where: { id: { in: idsOf("WORKLOG") } }, select: { id: true, content: true } })
        : Promise.resolve([]),
      idsOf("ISSUE").length
        ? fastify.prisma.taskIssue.findMany({ where: { id: { in: idsOf("ISSUE") } }, select: { id: true, content: true } })
        : Promise.resolve([]),
    ]);
    for (const c of comments) previewMap.set(`COMMENT:${c.id}`, c.content);
    for (const w of workLogs) previewMap.set(`WORKLOG:${w.id}`, w.content);
    for (const i of issues) previewMap.set(`ISSUE:${i.id}`, i.content);

    // 딥링크: taskId → projectId 해석 후 /projects/:projectId?taskId=:taskId
    const taskIds = [...new Set(rows.map((r) => r.taskId).filter((t): t is string => !!t))];
    const taskProjectMap = new Map<string, string>();
    if (taskIds.length > 0) {
      const tasks = await fastify.prisma.task.findMany({
        where: { id: { in: taskIds } },
        select: { id: true, projectId: true },
      });
      for (const t of tasks) taskProjectMap.set(t.id, t.projectId);
    }

    const items = rows.map((r) => {
      const projectId = r.taskId ? taskProjectMap.get(r.taskId) ?? null : null;
      return {
        id: r.id,
        sourceType: r.sourceType,
        sourceId: r.sourceId,
        taskId: r.taskId,
        projectId,
        actorId: r.actorId,
        isRead: r.isRead,
        createdAt: r.createdAt,
        preview: previewMap.get(`${r.sourceType}:${r.sourceId}`) ?? null,
        linkUrl: projectId && r.taskId ? `/projects/${projectId}?taskId=${r.taskId}` : null,
      };
    });

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
