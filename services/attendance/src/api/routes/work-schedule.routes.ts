import { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireRole } from "../middleware/auth.middleware.js";

export async function workScheduleRoutes(fastify: FastifyInstance) {
  const svc = fastify.workScheduleService;

  // GET /api/v1/work-schedule?start=2026-04-07&end=2026-04-13
  fastify.get("/", async (req, reply) => {
    const q = req.query as { start?: string; end?: string };
    if (!q.start || !q.end) {
      return reply.status(400).send({ code: "VALIDATION_ERROR", message: "start, end 파라미터가 필요합니다." });
    }
    return reply.send(await svc.getWeeklyOverview(q.start, q.end));
  });

  // POST /api/v1/work-schedule
  fastify.post("/", {
    preHandler: requireRole("ADMIN", "MANAGER", "OPERATOR"),
  }, async (req, reply) => {
    const body = z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      entryType: z.enum(["WORK", "FIELD", "TRAINING", "BUSINESS_TRIP"]),
      startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      label: z.string().optional(),
      groupId: z.string().optional(),
    }).parse(req.body);
    const entry = await svc.createEntry(req.userId, {
      date: body.date,
      entryType: body.entryType as string,
      ...(body.startTime != null ? { startTime: body.startTime } : {}),
      ...(body.endTime != null ? { endTime: body.endTime } : {}),
      ...(body.label != null ? { label: body.label } : {}),
      ...(body.groupId != null ? { groupId: body.groupId } : {}),
    });
    return reply.status(201).send(entry);
  });

  // PATCH /api/v1/work-schedule/:id
  fastify.patch("/:id", {
    preHandler: requireRole("ADMIN", "MANAGER", "OPERATOR"),
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      entryType: z.enum(["WORK", "FIELD", "TRAINING", "BUSINESS_TRIP"]).optional(),
      startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      label: z.string().optional(),
    }).parse(req.body);
    const updated = await svc.updateEntry(id, req.userId, {
      ...(body.entryType != null ? { entryType: body.entryType as string } : {}),
      ...(body.startTime != null ? { startTime: body.startTime } : {}),
      ...(body.endTime != null ? { endTime: body.endTime } : {}),
      ...(body.label !== undefined ? { label: body.label } : {}),
    });
    return reply.send(updated);
  });

  // DELETE /api/v1/work-schedule/:id
  fastify.delete("/:id", {
    preHandler: requireRole("ADMIN", "MANAGER", "OPERATOR"),
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await svc.deleteEntry(id, req.userId);
    return reply.status(204).send();
  });

  // PATCH /api/v1/work-schedule/group/:groupId
  fastify.patch("/group/:groupId", {
    preHandler: requireRole("ADMIN", "MANAGER", "OPERATOR"),
  }, async (req, reply) => {
    const { groupId } = req.params as { groupId: string };
    const body = z.object({
      entryType: z.enum(["WORK", "FIELD", "TRAINING", "BUSINESS_TRIP"]).optional(),
      startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      label: z.string().optional(),
    }).parse(req.body);
    const result = await svc.updateGroup(groupId, req.userId, {
      ...(body.entryType != null ? { entryType: body.entryType as string } : {}),
      ...(body.startTime != null ? { startTime: body.startTime } : {}),
      ...(body.endTime != null ? { endTime: body.endTime } : {}),
      ...(body.label !== undefined ? { label: body.label } : {}),
    });
    return reply.send(result);
  });

  // DELETE /api/v1/work-schedule/group/:groupId
  fastify.delete("/group/:groupId", {
    preHandler: requireRole("ADMIN", "MANAGER", "OPERATOR"),
  }, async (req, reply) => {
    const { groupId } = req.params as { groupId: string };
    const result = await svc.deleteGroup(groupId, req.userId);
    return reply.send(result);
  });
}
