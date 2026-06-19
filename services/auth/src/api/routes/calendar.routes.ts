import type { FastifyInstance, FastifyReply } from "fastify";
import { ZodError } from "zod";
import type { CalendarService } from "../../application/calendar.service";
import { CalendarError } from "../../application/calendar.service";
import type { AuthService } from "../../application/auth.service";
import type { HolidaySyncService } from "../../application/holiday-sync.service";
import { KasiClientError } from "../../infrastructure/clients/kasi-client";
import { createAuthHook, requireRole } from "../middleware/auth.middleware";
import {
  createEntrySchema,
  updateEntrySchema,
  listEntryQuerySchema,
  upcomingQuerySchema,
  syncHolidaysQuerySchema,
} from "../dtos/calendar.dto";

function handleError(reply: FastifyReply, err: unknown) {
  if (err instanceof CalendarError) {
    return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
  }
  if (err instanceof KasiClientError) {
    return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
  }
  if (err instanceof ZodError) {
    return reply.code(400).send({
      error: { code: "INVALID_INPUT", message: err.issues[0]?.message ?? "입력 오류" },
    });
  }
  throw err;
}

export async function calendarRoutes(
  app: FastifyInstance,
  opts: {
    calendarService: CalendarService;
    authService: AuthService;
    holidaySyncService: HolidaySyncService | null;
  },
) {
  const { calendarService, authService, holidaySyncService } = opts;
  const authenticate = createAuthHook(authService);
  const adminOnly = requireRole("ADMIN");

  // GET /api/v1/calendar?from&to&type
  app.get("/", { preHandler: [authenticate] }, async (req, reply) => {
    try {
      const q = listEntryQuerySchema.parse(req.query);
      const items = await calendarService.list(q);
      return reply.send(items);
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // GET /api/v1/calendar/upcoming?days=N
  app.get("/upcoming", { preHandler: [authenticate] }, async (req, reply) => {
    try {
      const q = upcomingQuerySchema.parse(req.query);
      const items = await calendarService.upcoming(q.days ?? 14);
      return reply.send(items);
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // GET /api/v1/calendar/:id
  app.get("/:id", { preHandler: [authenticate] }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const item = await calendarService.getById(id);
      return reply.send(item);
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // POST /api/v1/calendar (ADMIN)
  app.post("/", { preHandler: [authenticate, adminOnly] }, async (req, reply) => {
    try {
      const dto = createEntrySchema.parse(req.body);
      const created = await calendarService.create(dto, req.userId);
      return reply.code(201).send(created);
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // PATCH /api/v1/calendar/:id (ADMIN)
  app.patch("/:id", { preHandler: [authenticate, adminOnly] }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const dto = updateEntrySchema.parse(req.body);
      const updated = await calendarService.update(id, dto);
      return reply.send(updated);
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // DELETE /api/v1/calendar/:id (ADMIN)
  app.delete("/:id", { preHandler: [authenticate, adminOnly] }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      await calendarService.remove(id);
      return reply.code(204).send();
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // v1.2 — POST /api/v1/calendar/sync-holidays?year=YYYY (ADMIN, rate-limited)
  app.post(
    "/sync-holidays",
    {
      preHandler: [authenticate, adminOnly],
      config: {
        rateLimit: { max: 6, timeWindow: "1 minute" },
      },
    },
    async (req, reply) => {
      try {
        if (!holidaySyncService) {
          return reply.code(503).send({
            error: {
              code: "KASI_NOT_CONFIGURED",
              message:
                "KASI_API_KEY가 설정되지 않았습니다. 관리자에게 문의하세요.",
            },
          });
        }
        const q = syncHolidaysQuerySchema.parse(req.query);
        const year = q.year ?? new Date().getFullYear();
        const result = await holidaySyncService.syncYear(year);
        return reply.send(result);
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );
}
