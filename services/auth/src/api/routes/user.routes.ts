import type { FastifyInstance } from "fastify";
import { createUserSchema, updateUserSchema, resetPasswordSchema, upsertProfileSchema } from "../dtos/user.dto";
import type { UserService } from "../../application/user.service";
import type { AuthService } from "../../application/auth.service";
import { createAuthHook, requireRole } from "../middleware/auth.middleware";
import { AuthError } from "../../application/auth.service";
import { publishActivity } from "../../infrastructure/event-publisher";

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

  // GET /api/v1/users/members — 결재자 선택용 (기본: MANAGER 이상, ?all=true: 전직원)
  app.get("/members", { preHandler: [authenticate] }, async (req, reply) => {
    const { all } = req.query as { all?: string };
    const users = await userService.findAll();
    const filtered = all === "true"
      ? users.filter((u) => u.isActive)
      : users.filter((u) => u.isActive && (u.role === "MANAGER" || u.role === "ADMIN"));
    // 보안 일괄패치 PDCA Layer 4 (NEW-9): 사회공학 자료 수집 차단 — departmentName/position 응답 제외
    // (사용자 picker는 id+name만 필요. 부서·직급이 진짜 필요한 화면이 발견되면 별도 라우트로 분리)
    return reply.code(200).send(filtered.map((u) => ({ id: u.id, name: u.name, departmentId: u.profile?.departmentId ?? null })));
  });

  // POST /api/v1/users
  app.post("/", { preHandler: [authenticate, adminOnly] }, async (req, reply) => {
    const body = createUserSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.issues[0]?.message });
    }

    try {
      const user = await userService.create(body.data);
      publishActivity({
        action: "user.created",
        userId: req.userId,
        entityType: "user",
        entityId: user.id,
        description: `사용자 생성: ${body.data.name} (${body.data.email})`,
        metadata: { targetName: body.data.name, targetEmail: body.data.email, role: body.data.role },
      });
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
      const changes: string[] = [];
      if (body.data.role) changes.push(`역할→${body.data.role}`);
      if (body.data.name) changes.push(`이름→${body.data.name}`);
      if (body.data.isActive !== undefined) changes.push(body.data.isActive ? "활성화" : "비활성화");
      publishActivity({
        action: body.data.role ? "user.role_changed" : "user.updated",
        userId: req.userId,
        entityType: "user",
        entityId: id,
        description: `사용자 수정: ${user.name} (${changes.join(", ")})`,
        metadata: { targetId: id, targetName: user.name, ...body.data },
      });
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
      publishActivity({
        action: "user.password_reset",
        userId: req.userId,
        entityType: "user",
        entityId: id,
        description: `비밀번호 초기화: 사용자 ${id}`,
      });
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
      publishActivity({
        action: "user.deleted",
        userId: req.userId,
        entityType: "user",
        entityId: id,
        description: `사용자 삭제: ${id}`,
      });
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
