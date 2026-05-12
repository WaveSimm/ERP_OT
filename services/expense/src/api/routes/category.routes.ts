import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { CategoryService } from "../../application/category.service";

const personalCreateSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  sheetName: z.string().max(100).optional(),
  displayOrder: z.number().int().optional(),
});

const standardCreateSchema = personalCreateSchema.extend({
  description: z.string().max(500).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  sheetName: z.string().max(100).optional(),
  displayOrder: z.number().int().optional(),
  description: z.string().max(500).optional(),
  active: z.boolean().optional(),
});

export async function categoryRoutes(app: FastifyInstance, opts: { service: CategoryService }) {
  const { service } = opts;

  // 사용자: 표준 + 본인 개인 모두 조회
  app.get("/", async (req) => service.listForUser(req.userId));

  // 사용자: 개인 카테고리 추가
  app.post("/", async (req, reply) => {
    const body = personalCreateSchema.parse(req.body);
    const created = await service.createPersonal(req.userId, body);
    return reply.code(201).send(created);
  });

  // 사용자: 본인 개인 카테고리 수정
  app.patch("/:id", async (req) => {
    const { id } = req.params as { id: string };
    const body = updateSchema.parse(req.body);
    return service.updatePersonal(req.userId, id, body);
  });

  app.delete("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await service.deletePersonal(req.userId, id);
    return reply.code(204).send();
  });
}

// admin 전용 — 표준 카테고리 CRUD
export async function adminCategoryRoutes(app: FastifyInstance, opts: { service: CategoryService }) {
  const { service } = opts;

  app.addHook("onRequest", async (req, reply) => {
    if (req.userRole !== "ADMIN") {
      return reply.code(403).send({ error: { code: "FORBIDDEN", message: "관리자 권한이 필요합니다." } });
    }
  });

  app.get("/", async () => service.listStandard());

  app.post("/", async (req, reply) => {
    const body = standardCreateSchema.parse(req.body);
    const created = await service.createStandard(body);
    return reply.code(201).send(created);
  });

  app.patch("/:id", async (req) => {
    const { id } = req.params as { id: string };
    const body = updateSchema.parse(req.body);
    return service.updateStandard(id, body);
  });
}
