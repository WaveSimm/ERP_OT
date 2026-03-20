import { FastifyInstance } from "fastify";
import { z } from "zod";
import { GroupService } from "../../application/group.service.js";
import { requireRole } from "../middleware/auth.middleware.js";
import { GroupType } from "@prisma/client";

const createGroupSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.nativeEnum(GroupType).optional(),
  parentGroupId: z.string().optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  sortOrder: z.number().int().optional(),
  description: z.string().max(500).optional(),
});

const updateGroupSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  sortOrder: z.number().int().optional(),
  description: z.string().max(500).optional().nullable(),
});

const addMembershipSchema = z.object({
  projectId: z.string(),
  displayOrder: z.number().int().optional(),
});

const updateOrderSchema = z.object({
  displayOrder: z.number().int(),
});

export async function groupRoutes(fastify: FastifyInstance) {
  const service: GroupService = fastify.groupService;

  // GET /api/v1/groups
  fastify.get("/", async (req, reply) => {
    const query = req.query as any;
    const type = query.type as GroupType | undefined;
    return reply.send(await service.listGroups(type));
  });

  // GET /api/v1/groups/:groupId
  fastify.get("/:groupId", async (req, reply) => {
    const { groupId } = req.params as { groupId: string };
    return reply.send(await service.getGroup(groupId));
  });

  // POST /api/v1/groups
  fastify.post("/", {
    preHandler: requireRole("ADMIN", "MANAGER"),
  }, async (req, reply) => {
    const dto = createGroupSchema.parse(req.body);
    const group = await service.createGroup(dto as any, req.userId);
    return reply.status(201).send(group);
  });

  // PATCH /api/v1/groups/:groupId
  fastify.patch("/:groupId", {
    preHandler: requireRole("ADMIN", "MANAGER"),
  }, async (req, reply) => {
    const { groupId } = req.params as { groupId: string };
    const dto = updateGroupSchema.parse(req.body);
    return reply.send(await service.updateGroup(groupId, dto as any));
  });

  // DELETE /api/v1/groups/:groupId
  fastify.delete("/:groupId", {
    preHandler: requireRole("ADMIN"),
  }, async (req, reply) => {
    const { groupId } = req.params as { groupId: string };
    await service.deleteGroup(groupId);
    return reply.status(204).send();
  });

  // ─── Membership ───────────────────────────────────────────────────────────

  // POST /api/v1/groups/:groupId/members
  fastify.post("/:groupId/members", {
    preHandler: requireRole("ADMIN", "MANAGER"),
  }, async (req, reply) => {
    const { groupId } = req.params as { groupId: string };
    const dto = addMembershipSchema.parse(req.body);
    const membership = await service.addMembership(groupId, dto as any, req.userId);
    return reply.status(201).send(membership);
  });

  // PATCH /api/v1/groups/:groupId/members/:projectId
  fastify.patch("/:groupId/members/:projectId", {
    preHandler: requireRole("ADMIN", "MANAGER"),
  }, async (req, reply) => {
    const { groupId, projectId } = req.params as { groupId: string; projectId: string };
    const { displayOrder } = updateOrderSchema.parse(req.body);
    return reply.send(await service.updateMembershipOrder(groupId, projectId, displayOrder));
  });

  // DELETE /api/v1/groups/:groupId/members/:projectId
  fastify.delete("/:groupId/members/:projectId", {
    preHandler: requireRole("ADMIN", "MANAGER"),
  }, async (req, reply) => {
    const { groupId, projectId } = req.params as { groupId: string; projectId: string };
    await service.removeMembership(groupId, projectId);
    return reply.status(204).send();
  });

  // GET /api/v1/groups/:groupId/projects
  fastify.get("/:groupId/projects", async (req, reply) => {
    const { groupId } = req.params as { groupId: string };
    const memberships = await fastify.prisma.projectGroupMembership.findMany({
      where: { groupId },
      include: {
        project: {
          select: { id: true, name: true, status: true, description: true, createdAt: true },
        },
      },
      orderBy: { displayOrder: "asc" },
    });
    return reply.send(memberships.map((m) => ({ ...m.project, displayOrder: m.displayOrder })));
  });

  // ─── Rollup ───────────────────────────────────────────────────────────────

  // GET /api/v1/groups/:groupId/rollup
  fastify.get("/:groupId/rollup", async (req, reply) => {
    const { groupId } = req.params as { groupId: string };
    return reply.send(await service.getGroupRollup(groupId));
  });
}
