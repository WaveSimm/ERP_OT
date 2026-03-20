import type { FastifyInstance, FastifyRequest } from "fastify";
import { loginSchema, changePasswordSchema } from "../dtos/auth.dto";
import type { AuthService } from "../../application/auth.service";
import type { IUserRepository } from "../../domain/repositories/user.repository";
import { createAuthHook } from "../middleware/auth.middleware";
import { AuthError } from "../../application/auth.service";

export async function authRoutes(app: FastifyInstance, opts: { authService: AuthService; userRepo: IUserRepository }) {
  const { authService, userRepo } = opts;
  const authenticate = createAuthHook(authService);

  // POST /api/v1/auth/login
  app.post("/login", async (req, reply) => {
    const body = loginSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.issues[0]?.message });
    }

    try {
      const result = await authService.login(body.data.email, body.data.password);

      reply.setCookie("refreshToken", result.refreshToken, {
        httpOnly: true,
        path: "/api/auth/refresh",
        sameSite: "strict",
        maxAge: 7 * 86400,
        secure: process.env.NODE_ENV === "production",
      });

      return reply.code(200).send({
        accessToken: result.accessToken,
        user: result.user,
      });
    } catch (e) {
      if (e instanceof AuthError) {
        return reply.code(e.statusCode).send({ error: e.message });
      }
      throw e;
    }
  });

  // POST /api/v1/auth/refresh
  app.post("/refresh", async (req, reply) => {
    const refreshToken = (req.cookies as Record<string, string>)["refreshToken"];
    if (!refreshToken) {
      return reply.code(401).send({ error: "refresh token이 없습니다." });
    }

    try {
      const result = await authService.refresh(refreshToken);

      reply.setCookie("refreshToken", result.refreshToken, {
        httpOnly: true,
        path: "/api/auth/refresh",
        sameSite: "strict",
        maxAge: 7 * 86400,
        secure: process.env.NODE_ENV === "production",
      });

      return reply.code(200).send({ accessToken: result.accessToken });
    } catch (e) {
      if (e instanceof AuthError) {
        return reply.code(e.statusCode).send({ error: e.message });
      }
      throw e;
    }
  });

  // POST /api/v1/auth/logout
  app.post("/logout", { preHandler: [authenticate] }, async (req, reply) => {
    await authService.logout(req.userId);
    reply.clearCookie("refreshToken", { path: "/api/auth/refresh" });
    return reply.code(204).send();
  });

  // GET /api/v1/auth/me
  app.get("/me", { preHandler: [authenticate] }, async (req, reply) => {
    const user = await userRepo.findById(req.userId);
    if (!user) return reply.code(404).send({ error: "사용자를 찾을 수 없습니다." });
    const { passwordHash: _, ...rest } = user;
    return reply.code(200).send(rest);
  });

  // PATCH /api/v1/auth/me/password
  app.patch("/me/password", { preHandler: [authenticate] }, async (req, reply) => {
    const body = changePasswordSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(422).send({ error: body.error.issues[0]?.message });
    }

    try {
      await authService.changePassword(req.userId, body.data.currentPassword, body.data.newPassword);
      return reply.code(204).send();
    } catch (e) {
      if (e instanceof AuthError) {
        return reply.code(e.statusCode).send({ error: e.message });
      }
      throw e;
    }
  });
}
