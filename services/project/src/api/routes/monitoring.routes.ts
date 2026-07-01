import { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireRole } from "../middleware/auth.middleware.js";

// 시스템 모니터링/알림 (admin 전용). prefix: /api/v1/monitoring
//   - 모니터 설정(활성/임계치) · 전역 수신자 CRUD · 이벤트 이력 조회 · 테스트 발송
//   실제 발송은 호스트 ops-notifier.sh 가 alert_event 큐를 비우며 전담한다.
export async function monitoringRoutes(fastify: FastifyInstance) {
  // 모든 엔드포인트 ADMIN 전용
  fastify.addHook("preHandler", requireRole("ADMIN"));

  // ─── 모니터 ─────────────────────────────────────────────────────────────
  // GET /monitoring/monitors
  fastify.get("/monitors", async (_req, reply) => {
    const monitors = await fastify.prisma.monitor.findMany({ orderBy: { key: "asc" } });
    return reply.send({ items: monitors });
  });

  // PATCH /monitoring/monitors/:key  — 활성여부/설정(config) 변경
  const patchMonitorSchema = z.object({
    enabled: z.boolean().optional(),
    config: z.record(z.any()).optional(),
  });
  fastify.patch("/monitors/:key", async (req, reply) => {
    const { key } = req.params as { key: string };
    const dto = patchMonitorSchema.parse(req.body);
    const existing = await fastify.prisma.monitor.findUnique({ where: { key } });
    if (!existing) return reply.code(404).send({ error: "NOT_FOUND", message: "모니터를 찾을 수 없습니다." });

    const data: Prisma.MonitorUpdateInput = {};
    if (dto.enabled !== undefined) data.enabled = dto.enabled;
    if (dto.config !== undefined) {
      // 기존 config 위에 얕은 병합(누락 필드 보존)
      const merged = { ...(existing.config as Record<string, unknown>), ...dto.config };
      data.config = merged as Prisma.InputJsonValue;
    }
    const updated = await fastify.prisma.monitor.update({ where: { key }, data });
    return reply.send(updated);
  });

  // ─── 수신자(전역) ───────────────────────────────────────────────────────
  // GET /monitoring/recipients
  fastify.get("/recipients", async (_req, reply) => {
    const items = await fastify.prisma.alertRecipient.findMany({ orderBy: { createdAt: "asc" } });
    return reply.send({ items });
  });

  // POST /monitoring/recipients
  const createRecipientSchema = z.object({
    address: z.string().email(),
    channel: z.string().default("email"),
    enabled: z.boolean().default(true),
  });
  fastify.post("/recipients", async (req, reply) => {
    const dto = createRecipientSchema.parse(req.body);
    try {
      const created = await fastify.prisma.alertRecipient.create({ data: dto });
      return reply.code(201).send(created);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return reply.code(409).send({ error: "DUPLICATE", message: "이미 등록된 수신자입니다." });
      }
      throw e;
    }
  });

  // PATCH /monitoring/recipients/:id — 활성 토글
  fastify.patch("/recipients/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const dto = z.object({ enabled: z.boolean() }).parse(req.body);
    const updated = await fastify.prisma.alertRecipient.update({ where: { id }, data: { enabled: dto.enabled } });
    return reply.send(updated);
  });

  // DELETE /monitoring/recipients/:id
  fastify.delete("/recipients/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await fastify.prisma.alertRecipient.delete({ where: { id } });
    return reply.code(204).send();
  });

  // ─── 이벤트 이력 ────────────────────────────────────────────────────────
  // GET /monitoring/events?page&pageSize&level&monitorKey
  const eventQuerySchema = z.object({
    page: z.string().regex(/^\d+$/).optional(),
    pageSize: z.string().regex(/^\d+$/).optional(),
    level: z.string().optional(),
    monitorKey: z.string().optional(),
  });
  fastify.get("/events", async (req, reply) => {
    const q = eventQuerySchema.parse(req.query);
    const page = q.page ? parseInt(q.page, 10) : 1;
    const pageSize = q.pageSize ? Math.min(parseInt(q.pageSize, 10), 100) : 30;
    const where: Prisma.AlertEventWhereInput = {};
    if (q.level) where.level = q.level;
    if (q.monitorKey) where.monitorKey = q.monitorKey;
    const [items, total] = await Promise.all([
      fastify.prisma.alertEvent.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      fastify.prisma.alertEvent.count({ where }),
    ]);
    return reply.send({ items, total, page, pageSize });
  });

  // ─── 테스트 발송 ────────────────────────────────────────────────────────
  // POST /monitoring/test — TEST 이벤트를 큐에 적재(호스트 notifier 가 ~1분 내 발송)
  fastify.post("/test", async (req, reply) => {
    const dto = z.object({ monitorKey: z.string().default("disk") }).parse(req.body ?? {});
    const ev = await fastify.prisma.alertEvent.create({
      data: {
        monitorKey: dto.monitorKey,
        level: "TEST",
        message: `관리자 UI 테스트 발송 (by ${req.userId ?? "?"})`,
        notify: true,
      },
    });
    return reply.code(202).send({ queued: true, id: ev.id, note: "호스트 notifier 가 약 1분 내 발송합니다." });
  });
}
