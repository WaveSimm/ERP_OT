// 보안 일괄패치 PDCA Layer 3
//   C1: accessToken을 httpOnly cookie로 전환 (응답 본문 미포함)
//   C8: 쿠키 path "/api/auth/refresh" → "/" 통일
//   NEW-7: deviceId cookie + logoutOtherDevices, listSessions 신규 라우트
//   H2: login 실패 시 userId=null + metadata에 attemptedEmail/ip/ua

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { loginSchema, changePasswordSchema } from "../dtos/auth.dto";
import type { AuthService } from "../../application/auth.service";
import type { IUserRepository } from "../../domain/repositories/user.repository";
import { createAuthHook } from "../middleware/auth.middleware";
import { AuthError } from "../../application/auth.service";
import { publishActivity } from "../../infrastructure/event-publisher";

// 쿠키 표준 옵션 (Layer 3: path 통일, sameSite strict, httpOnly)
const COOKIE_BASE = {
  httpOnly: true,
  path: "/",
  sameSite: "strict" as const,
  secure: process.env.NODE_ENV === "production",
};
const ACCESS_COOKIE_MAX_AGE = 60 * 60; // 1h
const REFRESH_COOKIE_MAX_AGE = 7 * 86400; // 7d
const DEVICE_COOKIE_MAX_AGE = 365 * 86400; // 1y (디바이스 식별 영구)
const CSRF_COOKIE_MAX_AGE = 60 * 60; // 1h (Access와 동일 회전)

// 클라이언트 IP 추출 (C6 forward 후 활용)
function getClientIp(req: FastifyRequest): string | undefined {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    return xff.split(",")[0]?.trim();
  }
  if (typeof req.headers["x-real-ip"] === "string") return req.headers["x-real-ip"] as string;
  return req.ip;
}

function getUserAgent(req: FastifyRequest): string | undefined {
  const ua = req.headers["user-agent"];
  return typeof ua === "string" ? ua : undefined;
}

function generateCsrfToken(): string {
  // node:crypto.randomBytes 동기 → 가벼움
  // 32 hex chars
  // (web 프록시의 CSRF 미들웨어가 cookie 값과 X-CSRF-Token 헤더 일치 검증)
  const buf = new Uint8Array(16);
  globalThis.crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

function setAuthCookies(reply: FastifyReply, opts: {
  accessToken: string;
  refreshToken: string;
  deviceId: string;
  csrfToken: string;
}) {
  reply
    .setCookie("accessToken", opts.accessToken, { ...COOKIE_BASE, maxAge: ACCESS_COOKIE_MAX_AGE })
    .setCookie("refreshToken", opts.refreshToken, { ...COOKIE_BASE, maxAge: REFRESH_COOKIE_MAX_AGE })
    .setCookie("deviceId", opts.deviceId, { ...COOKIE_BASE, maxAge: DEVICE_COOKIE_MAX_AGE })
    // csrfToken은 httpOnly NOT — JS가 읽어서 X-CSRF-Token 헤더에 넣어야 함
    .setCookie("csrfToken", opts.csrfToken, {
      httpOnly: false,
      path: "/",
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      maxAge: CSRF_COOKIE_MAX_AGE,
    });
}

function clearAuthCookies(reply: FastifyReply) {
  reply
    .clearCookie("accessToken", { path: "/" })
    .clearCookie("refreshToken", { path: "/" })
    .clearCookie("csrfToken", { path: "/" });
  // deviceId는 의도적으로 유지 (다음 로그인에서 동일 디바이스 식별)
}

export async function authRoutes(app: FastifyInstance, opts: { authService: AuthService; userRepo: IUserRepository }) {
  const { authService, userRepo } = opts;
  const authenticate = createAuthHook(authService);

  // POST /api/v1/auth/login
  app.post("/login", async (req, reply) => {
    const body = loginSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.issues[0]?.message });
    }

    const ipAddress = getClientIp(req);
    const userAgent = getUserAgent(req);

    try {
      const result = await authService.login(body.data.email, body.data.password, {
        ipAddress,
        userAgent,
        deviceId: (req.cookies as Record<string, string>)["deviceId"],
      });

      const csrfToken = generateCsrfToken();
      setAuthCookies(reply, {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        deviceId: result.deviceId,
        csrfToken,
      });

      publishActivity({
        action: "auth.login",
        userId: result.user.id,
        entityType: "user",
        entityId: result.user.id,
        description: `${result.user.name} 로그인`,
        metadata: { ipAddress, userAgent: userAgent?.slice(0, 200) },
      });

      // C1: accessToken은 본문에 미포함 — httpOnly cookie로만 전달
      // user 정보는 본문 (UI 즉시 사용)
      return reply.code(200).send({ user: result.user });
    } catch (e) {
      if (e instanceof AuthError) {
        // H2: 로그인 실패 시 userId=null, metadata에 시도 정보
        publishActivity({
          action: "auth.login_failed",
          userId: null,
          entityType: "user",
          entityId: body.data.email,
          description: `로그인 실패`,
          metadata: { attemptedEmail: body.data.email, ipAddress, userAgent: userAgent?.slice(0, 200), errorCode: e.code },
        });
        return reply.code(e.statusCode).send({ error: e.message });
      }
      throw e;
    }
  });

  // POST /api/v1/auth/refresh — cookie 기반 (NEW-4 algorithms 명시 + reuse detection)
  app.post("/refresh", async (req, reply) => {
    const refreshToken = (req.cookies as Record<string, string>)["refreshToken"];
    if (!refreshToken) {
      return reply.code(401).send({ error: "refresh token이 없습니다." });
    }

    const ipAddress = getClientIp(req);
    const userAgent = getUserAgent(req);

    try {
      const result = await authService.refresh(refreshToken, { ipAddress, userAgent });
      const csrfToken = generateCsrfToken();

      setAuthCookies(reply, {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        deviceId: result.deviceId ?? (req.cookies as Record<string, string>)["deviceId"] ?? "",
        csrfToken,
      });

      // C1: accessToken은 cookie로만 전달, 본문 미포함
      return reply.code(200).send({ ok: true });
    } catch (e) {
      if (e instanceof AuthError) {
        // Reuse detection 시 모든 cookie 삭제 (보안 강화)
        if (e.code === "REFRESH_REUSE_DETECTED") {
          clearAuthCookies(reply);
        }
        return reply.code(e.statusCode).send({ error: e.message, code: e.code });
      }
      throw e;
    }
  });

  // POST /api/v1/auth/logout — 현재 디바이스 세션만 종료
  app.post("/logout", { preHandler: [authenticate] }, async (req, reply) => {
    const deviceId = (req.cookies as Record<string, string>)["deviceId"];
    await authService.logout(req.userId, deviceId);
    clearAuthCookies(reply);
    publishActivity({
      action: "auth.logout",
      userId: req.userId,
      entityType: "user",
      entityId: req.userId,
      description: "로그아웃",
      metadata: { deviceId, ipAddress: getClientIp(req) },
    });
    return reply.code(204).send();
  });

  // POST /api/v1/auth/logout-all (NEW-7 — 다른 기기 모두 로그아웃)
  app.post("/logout-all", { preHandler: [authenticate] }, async (req, reply) => {
    const deviceId = (req.cookies as Record<string, string>)["deviceId"];
    if (!deviceId) {
      return reply.code(400).send({ error: "디바이스 식별 불가" });
    }
    await authService.logoutOtherDevices(req.userId, deviceId);
    publishActivity({
      action: "auth.logout_others",
      userId: req.userId,
      entityType: "user",
      entityId: req.userId,
      description: "다른 기기 모두 로그아웃",
      metadata: { keptDeviceId: deviceId },
    });
    return reply.code(204).send();
  });

  // GET /api/v1/auth/sessions (NEW-7 — 활성 세션 목록)
  app.get("/sessions", { preHandler: [authenticate] }, async (req, reply) => {
    const deviceId = (req.cookies as Record<string, string>)["deviceId"];
    const sessions = await authService.listSessions(req.userId, deviceId);
    return reply.code(200).send({ sessions });
  });

  // GET /api/v1/auth/me
  app.get("/me", { preHandler: [authenticate] }, async (req, reply) => {
    const user = await userRepo.findById(req.userId);
    if (!user) return reply.code(404).send({ error: "사용자를 찾을 수 없습니다." });
    const { passwordHash: _passwordHash, ...rest } = user;
    return reply.code(200).send(rest);
  });

  // PATCH /api/v1/auth/me  (본인 이름 수정)
  app.patch("/me", { preHandler: [authenticate] }, async (req, reply) => {
    const { name } = req.body as { name?: string };
    if (!name || name.trim().length === 0) {
      return reply.code(400).send({ error: "이름을 입력하세요." });
    }
    try {
      const updated = await userRepo.update(req.userId, { name: name.trim() });
      const { passwordHash: _passwordHash, ...rest } = updated;
      return reply.code(200).send(rest);
    } catch (e) {
      if (e instanceof AuthError) return reply.code(e.statusCode).send({ error: e.message });
      throw e;
    }
  });

  // PATCH /api/v1/auth/me/password — 변경 시 모든 세션 무효화
  app.patch("/me/password", { preHandler: [authenticate] }, async (req, reply) => {
    const body = changePasswordSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(422).send({ error: body.error.issues[0]?.message });
    }

    try {
      await authService.changePassword(req.userId, body.data.currentPassword, body.data.newPassword);
      // 비밀번호 변경 후 자기 자신도 로그아웃
      clearAuthCookies(reply);
      publishActivity({
        action: "auth.password_changed",
        userId: req.userId,
        entityType: "user",
        entityId: req.userId,
        description: "비밀번호 변경 (모든 세션 무효화)",
      });
      return reply.code(204).send();
    } catch (e) {
      if (e instanceof AuthError) {
        return reply.code(e.statusCode).send({ error: e.message });
      }
      throw e;
    }
  });
}
