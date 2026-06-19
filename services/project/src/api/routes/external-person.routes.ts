import { FastifyInstance } from "fastify";
import { z } from "zod";
import { ExternalPersonService } from "../../application/external-person.service.js";
import { AppError } from "@erp-ot/shared";

// 자원-모델-분리 PDCA Phase 3a-3 (2026-05-04)
// /api/v1/external-persons

const externalStatusSchema = z.enum(["ACTIVE", "ARCHIVED"]);

const createSchema = z.object({
  name: z.string().min(1).max(100),
  company: z.string().max(200).nullish(),
  contactEmail: z.string().email().max(200).nullish(),
  contactPhone: z.string().max(50).nullish(),
  contractStart: z.string().nullish(),  // YYYY-MM-DD
  contractEnd: z.string().nullish(),
  notes: z.string().nullish(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  company: z.string().max(200).nullish().optional(),
  contactEmail: z.string().email().max(200).nullish().optional(),
  contactPhone: z.string().max(50).nullish().optional(),
  status: externalStatusSchema.optional(),
  contractStart: z.string().nullish().optional(),
  contractEnd: z.string().nullish().optional(),
  notes: z.string().nullish().optional(),
});

const archiveBodySchema = z.object({
  contractEnd: z.string().optional(),
});

function parseDate(v: string | null | undefined): Date | null | undefined {
  if (v === null) return null;
  if (v === undefined) return undefined;
  return new Date(v);
}

export async function externalPersonRoutes(app: FastifyInstance) {
  const svc = new ExternalPersonService(app.prisma);

  function requireAdmin(role: string) {
    if (role !== "ADMIN") throw new AppError(403, "FORBIDDEN", "관리자 권한이 필요합니다.");
  }

  // GET /api/v1/external-persons?status=&company=&search=
  app.get("/", async (req, reply) => {
    const q = req.query as { status?: string; company?: string; search?: string };
    const filter: Parameters<typeof svc.list>[0] = {};
    if (q.status) filter.status = q.status as NonNullable<typeof filter.status>;
    if (q.company) filter.company = q.company;
    if (q.search) filter.search = q.search;
    const items = await svc.list(filter);
    return reply.send(items);
  });

  // GET /api/v1/external-persons/:id
  app.get("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const item = await svc.get(id);
    return reply.send(item);
  });

  // POST /api/v1/external-persons (ADMIN)
  app.post("/", async (req, reply) => {
    requireAdmin(req.userRole);
    const body = createSchema.parse(req.body);
    const dto: Parameters<typeof svc.create>[0] = { name: body.name };
    if (body.company !== undefined) dto.company = body.company;
    if (body.contactEmail !== undefined) dto.contactEmail = body.contactEmail;
    if (body.contactPhone !== undefined) dto.contactPhone = body.contactPhone;
    if (body.contractStart !== undefined) dto.contractStart = parseDate(body.contractStart);
    if (body.contractEnd !== undefined) dto.contractEnd = parseDate(body.contractEnd);
    if (body.notes !== undefined) dto.notes = body.notes;
    const created = await svc.create(dto);
    return reply.status(201).send(created);
  });

  // PATCH /api/v1/external-persons/:id (ADMIN)
  app.patch("/:id", async (req, reply) => {
    requireAdmin(req.userRole);
    const { id } = req.params as { id: string };
    const body = updateSchema.parse(req.body);
    const dto: Parameters<typeof svc.update>[1] = {};
    if (body.name !== undefined) dto.name = body.name;
    if (body.company !== undefined) dto.company = body.company;
    if (body.contactEmail !== undefined) dto.contactEmail = body.contactEmail;
    if (body.contactPhone !== undefined) dto.contactPhone = body.contactPhone;
    if (body.status !== undefined) dto.status = body.status;
    if (body.contractStart !== undefined) dto.contractStart = parseDate(body.contractStart);
    if (body.contractEnd !== undefined) dto.contractEnd = parseDate(body.contractEnd);
    if (body.notes !== undefined) dto.notes = body.notes;
    const updated = await svc.update(id, dto);
    return reply.send(updated);
  });

  // POST /api/v1/external-persons/:id/archive (ADMIN)
  app.post("/:id/archive", async (req, reply) => {
    requireAdmin(req.userRole);
    const { id } = req.params as { id: string };
    const body = archiveBodySchema.parse(req.body ?? {});
    const date = body.contractEnd ? new Date(body.contractEnd) : undefined;
    const updated = await svc.archive(id, date);
    return reply.send(updated);
  });

  // POST /api/v1/external-persons/:id/reactivate (ADMIN)
  app.post("/:id/reactivate", async (req, reply) => {
    requireAdmin(req.userRole);
    const { id } = req.params as { id: string };
    const updated = await svc.reactivate(id);
    return reply.send(updated);
  });

  // DELETE /api/v1/external-persons/:id (ADMIN)
  app.delete("/:id", async (req, reply) => {
    requireAdmin(req.userRole);
    const { id } = req.params as { id: string };
    await svc.delete(id);
    return reply.status(204).send();
  });
}
