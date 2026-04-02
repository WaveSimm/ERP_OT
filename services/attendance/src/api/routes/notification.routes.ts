import { FastifyInstance } from "fastify";

export async function notificationRoutes(fastify: FastifyInstance) {
  const svc = fastify.notificationService;

  // GET /api/v1/notifications
  fastify.get("/", async (req, reply) => {
    const q = req.query as { unreadOnly?: string; page?: string; pageSize?: string };
    const params: { unreadOnly?: boolean; page?: number; pageSize?: number } = {
      unreadOnly: q.unreadOnly === "true",
    };
    if (q.page) params.page = parseInt(q.page);
    if (q.pageSize) params.pageSize = parseInt(q.pageSize);
    return reply.send(await svc.getList(req.userId, params));
  });

  // GET /api/v1/notifications/unread-count
  fastify.get("/unread-count", async (req, reply) => {
    const count = await svc.getUnreadCount(req.userId);
    return reply.send({ count });
  });

  // PATCH /api/v1/notifications/:id/read
  fastify.patch("/:id/read", async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send(await svc.markRead(id, req.userId));
  });

  // PATCH /api/v1/notifications/read-all
  fastify.patch("/read-all", async (req, reply) => {
    return reply.send(await svc.markAllRead(req.userId));
  });
}
