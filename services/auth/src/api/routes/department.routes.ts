import { FastifyInstance } from "fastify";
import { z } from "zod";
import { DepartmentService } from "../../application/department.service.js";

export async function departmentRoutes(
  fastify: FastifyInstance,
  opts: { deptService: DepartmentService },
) {
  const svc = opts.deptService;

  // GET /api/v1/departments
  fastify.get("/", async (_req, reply) => {
    return reply.send(await svc.getTree());
  });

  // GET /api/v1/departments/:id
  fastify.get("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const dept = await svc.findById(id);
    if (!dept) return reply.status(404).send({ code: "NOT_FOUND", message: "부서를 찾을 수 없습니다." });
    return reply.send(dept);
  });

  // POST /api/v1/departments
  fastify.post("/", async (req, reply) => {
    const body = z.object({
      name: z.string().min(1),
      code: z.string().min(1).regex(/^[A-Z0-9_-]+$/),
      parentId: z.string().optional(),
      headUserId: z.string().optional(),
      sortOrder: z.number().int().default(0),
    }).parse(req.body);
    const dept = await svc.create({
      name: body.name,
      code: body.code,
      sortOrder: body.sortOrder,
      ...(body.parentId !== undefined ? { parentId: body.parentId } : {}),
      ...(body.headUserId !== undefined ? { headUserId: body.headUserId } : {}),
    });
    return reply.status(201).send(dept);
  });

  // PATCH /api/v1/departments/:id
  fastify.patch("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      name: z.string().min(1).optional(),
      code: z.string().min(1).optional(),
      parentId: z.string().nullable().optional(),
      headUserId: z.string().nullable().optional(),
      soukwalUserId: z.string().nullable().optional(),
      daepyoUserId: z.string().nullable().optional(),
      sortOrder: z.number().int().optional(),
      isActive: z.boolean().optional(),
    }).parse(req.body);
    // exactOptionalPropertyTypes 대응: undefined 제거
    const updateData: Parameters<typeof svc.update>[1] = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.code !== undefined) updateData.code = body.code;
    if (body.parentId !== undefined) updateData.parentId = body.parentId;
    if (body.headUserId !== undefined) updateData.headUserId = body.headUserId;
    if (body.soukwalUserId !== undefined) updateData.soukwalUserId = body.soukwalUserId;
    if (body.daepyoUserId !== undefined) updateData.daepyoUserId = body.daepyoUserId;
    if (body.sortOrder !== undefined) updateData.sortOrder = body.sortOrder;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;
    const dept = await svc.update(id, updateData);
    return reply.send(dept);
  });

  // DELETE /api/v1/departments/:id
  fastify.delete("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await svc.delete(id);
    return reply.status(204).send();
  });

  // POST /api/v1/departments/:id/assign-user
  fastify.post("/:id/assign-user", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ userId: z.string() }).parse(req.body);
    await svc.assignUser(body.userId, id);
    return reply.status(204).send();
  });

  // DELETE /api/v1/departments/:id/members/:userId
  fastify.delete("/:id/members/:userId", async (req, reply) => {
    const { userId } = req.params as { id: string; userId: string };
    await svc.assignUser(userId, null);
    return reply.status(204).send();
  });
}
