import { FastifyInstance } from "fastify";
import { z } from "zod";
import { EquipmentResourceService } from "../../application/equipment-resource.service.js";
import { AppError } from "@erp-ot/shared";

// 자원-모델-분리 PDCA Phase 3a-2 (2026-05-04)
// /api/v1/equipment-resources

// 공용자산 정리 (2026-05-05): EQUIPMENT 타입 폐기 — 시설/차량만.
// "장비"는 /equipment 페이지의 Equipment 모델로 분리.
const equipmentTypeSchema = z.enum(["VEHICLE", "FACILITY"]);

const createSchema = z.object({
  name: z.string().min(1).max(100),
  type: equipmentTypeSchema.optional(),
  isActive: z.boolean().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  type: equipmentTypeSchema.optional(),
  isActive: z.boolean().optional(),
});

export async function equipmentResourceRoutes(app: FastifyInstance) {
  const svc = new EquipmentResourceService(app.prisma);

  function requireAdmin(role: string) {
    if (role !== "ADMIN") throw new AppError(403, "FORBIDDEN", "관리자 권한이 필요합니다.");
  }

  // GET /api/v1/equipment-resources?type=&isActive=&search=
  app.get("/", async (req, reply) => {
    const q = req.query as { type?: string; isActive?: string; search?: string };
    const filter: Parameters<typeof svc.list>[0] = {};
    if (q.type) filter.type = q.type as any;
    if (q.isActive !== undefined) filter.isActive = q.isActive === "true";
    if (q.search) filter.search = q.search;
    const items = await svc.list(filter);
    return reply.send(items);
  });

  // GET /api/v1/equipment-resources/:id
  app.get("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const item = await svc.get(id);
    return reply.send(item);
  });

  // POST /api/v1/equipment-resources (ADMIN)
  app.post("/", async (req, reply) => {
    requireAdmin(req.userRole);
    const body = createSchema.parse(req.body);
    const created = await svc.create(body);
    return reply.status(201).send(created);
  });

  // PATCH /api/v1/equipment-resources/:id (ADMIN)
  app.patch("/:id", async (req, reply) => {
    requireAdmin(req.userRole);
    const { id } = req.params as { id: string };
    const body = updateSchema.parse(req.body);
    const updated = await svc.update(id, body);
    return reply.send(updated);
  });

  // DELETE /api/v1/equipment-resources/:id (ADMIN)
  app.delete("/:id", async (req, reply) => {
    requireAdmin(req.userRole);
    const { id } = req.params as { id: string };
    await svc.delete(id);
    return reply.status(204).send();
  });
}
