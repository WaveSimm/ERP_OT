import type { FastifyInstance } from "fastify";
import { createUserSchema, updateUserSchema, resetPasswordSchema } from "../dtos/user.dto";
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
}
