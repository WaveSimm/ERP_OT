import type { FastifyInstance } from "fastify";
import { createUserSchema, updateUserSchema, resetPasswordSchema, upsertProfileSchema } from "../dtos/user.dto";
import type { UserService } from "../../application/user.service";
import type { AuthService } from "../../application/auth.service";
import { createAuthHook, requireRole } from "../middleware/auth.middleware";
import { AuthError } from "../../application/auth.service";

export async function userRoutes(
  app: FastifyInstance,
  opts: { userService: UserService; authService: AuthService },
) {
  const { userService, authService } = opts;
  const authenticate = createAuthHook(authService);
  const adminOnly = requireRole("ADMIN");

  // GET /api/v1/users
  app.get("/", { preHandler: [authenticate, adminOnly] }, async (_req, reply) => {
    const users = await userService.findAll();
    return reply.code(200).send({ items: users, total: users.length });
  });

  // POST /api/v1/users
  app.post("/", { preHandler: [authenticate, adminOnly] }, async (req, reply) => {
    const body = createUserSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.issues[0]?.message });
    }

    try {
      const user = await userService.create(body.data);
      return reply.code(201).send(user);
    } catch (e) {
      if (e instanceof AuthError) {
        return reply.code(e.statusCode).send({ error: e.message });
      }
      throw e;
    }
  });

  // PATCH /api/v1/users/:id
  app.patch("/:id", { preHandler: [authenticate, adminOnly] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = updateUserSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.issues[0]?.message });
    }

    try {
      const user = await userService.update(id, body.data, req.userId);
      return reply.code(200).send(user);
    } catch (e) {
      if (e instanceof AuthError) {
        return reply.code(e.statusCode).send({ error: e.message });
      }
      throw e;
    }
  });

  // POST /api/v1/users/:id/reset-password
  app.post("/:id/reset-password", { preHandler: [authenticate, adminOnly] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = resetPasswordSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.issues[0]?.message });
    }

    try {
      await userService.resetPassword(id, body.data.newPassword);
      return reply.code(204).send();
    } catch (e) {
      if (e instanceof AuthError) {
        return reply.code(e.statusCode).send({ error: e.message });
      }
      throw e;
    }
  });

  // DELETE /api/v1/users/:id
  app.delete("/:id", { preHandler: [authenticate, adminOnly] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (id === req.userId) {
      return reply.code(400).send({ error: "본인 계정은 삭제할 수 없습니다." });
    }
    try {
      await userService.delete(id);
      return reply.code(204).send();
    } catch (e) {
      if (e instanceof AuthError) {
        return reply.code(e.statusCode).send({ error: e.message });
      }
      throw e;
    }
  });

  // GET /api/v1/users/:id/profile  (본인 또는 관리자)
  app.get("/:id/profile", { preHandler: [authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (req.userId !== id && req.userRole !== "ADMIN") {
      return reply.code(403).send({ error: "권한이 없습니다." });
    }
    try {
      const result = await userService.getProfile(id);
      return reply.code(200).send(result);
    } catch (e) {
      if (e instanceof AuthError) return reply.code(e.statusCode).send({ error: e.message });
      throw e;
    }
  });

  // PATCH /api/v1/users/:id/profile  (본인 또는 관리자)
  app.patch("/:id/profile", { preHandler: [authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (req.userId !== id && req.userRole !== "ADMIN") {
      return reply.code(403).send({ error: "권한이 없습니다." });
    }
    const body = upsertProfileSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.issues[0]?.message });
    }
    try {
      const result = await userService.upsertProfile(id, body.data);
      return reply.code(200).send(result);
    } catch (e) {
      if (e instanceof AuthError) return reply.code(e.statusCode).send({ error: e.message });
      throw e;
    }
  });
}
