import type { FastifyInstance } from "fastify";
import type { CalendarService } from "../../application/calendar.service";
import { CalendarError } from "../../application/calendar.service";
import type { AuthService } from "../../application/auth.service";
import { createAuthHook, requireRole } from "../middleware/auth.middleware";
import {
  createEntrySchema,
  updateEntrySchema,
  listEntryQuerySchema,
  upcomingQuerySchema,
} from "../dtos/calendar.dto";

function handleError(reply: any, err: any) {
  if (err instanceof CalendarError) {
    return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
  }
  if (err?.name === "ZodError") {
    return reply.code(400).send({
      error: { code: "INVALID_INPUT", message: err.issues?.[0]?.message ?? "입력 오류" },
    });
  }
  throw err;
}

export async function calendarRoutes(
  app: FastifyInstance,
  opts: { calendarService: CalendarService; authService: AuthService },
) {
  const { calendarService, authService } = opts;
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
  app.post("/", { preHandler: [authenticate, adminOnly] }, async (req: any, reply) => {
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
}
