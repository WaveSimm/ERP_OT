# Layer 3 — auth.service.ts 변경 초안

> Layer 3 본 작업 시 이 초안을 코드로 적용. Layer 2까지 적용된 상태에서 시작.
> 핵심 변경: hash 저장, transaction, reuse detection, 다기기, algorithms 명시, TTL 1h

## 신규 메서드/필드

```typescript
import bcrypt from "bcryptjs";
import * as jsonwebtoken from "jsonwebtoken";
import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import type { IUserRepository } from "../domain/repositories/user.repository";
import type { FastifyBaseLogger } from "fastify";

export class AuthError extends Error { /* 동일 */ }

export interface LoginContext {
  userAgent?: string;
  ipAddress?: string;
  deviceId?: string;     // 기존 cookie deviceId (있으면 재사용, 없으면 신규 생성)
}

export interface RefreshContext {
  userAgent?: string;
  ipAddress?: string;
  deviceId?: string;
}

export class AuthService {
  constructor(
    private readonly userRepo: IUserRepository,
    private readonly prisma: PrismaClient,
    private readonly accessSecret: string,
    private readonly refreshSecret: string,
    private readonly logger?: FastifyBaseLogger,  // reuse detection alert용
  ) {}

  // 보안 일괄패치 Layer 3 핵심 헬퍼
  private hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  private generateDeviceId(): string {
    return crypto.randomBytes(16).toString("hex");
  }

  // ─── login (H5: $transaction, NEW-7: 다기기 유지, deviceId 처리) ─────────
  async login(email: string, password: string, ctx: LoginContext = {}) {
    const user = await this.userRepo.findByEmail(email);
    if (!user) throw new AuthError(401, "이메일 또는 비밀번호가 올바르지 않습니다.");
    if (!user.isActive) throw new AuthError(403, "비활성화된 계정입니다.");

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new AuthError(401, "이메일 또는 비밀번호가 올바르지 않습니다.");

    const deviceId = ctx.deviceId || this.generateDeviceId();
    const accessToken = this.signAccess(user.id, user.email, user.role, user.name);
    const refreshToken = this.signRefresh(user.id);
    const tokenHash = this.hashToken(refreshToken);

    // H5: 3쓰기를 단일 transaction
    await this.prisma.$transaction([
      // NEW-7: 같은 deviceId의 기존 token만 삭제 (다른 디바이스 유지)
      this.prisma.refreshToken.deleteMany({
        where: { userId: user.id, deviceId },
      }),
      // 새 token 저장 (hash)
      this.prisma.refreshToken.create({
        data: {
          tokenHash,
          userId: user.id,
          deviceId,
          userAgent: ctx.userAgent ?? null,
          ipAddress: ctx.ipAddress ?? null,
          expiresAt: new Date(Date.now() + 7 * 86400_000),
        },
      }),
      // last login 업데이트 (userRepo 내부에서 prisma 사용한다고 가정)
      // 만약 userRepo가 별도 prisma 인스턴스 쓰면 transaction 밖으로
    ]);
    await this.userRepo.updateLastLogin(user.id);

    return {
      accessToken,
      refreshToken,
      deviceId,  // 클라이언트가 cookie로 저장
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    };
  }

  // ─── refresh (C5 hash + reuse detection + NEW-7 deviceId) ─────────────
  async refresh(refreshToken: string, ctx: RefreshContext = {}) {
    let payload: { sub: string };
    try {
      // NEW-4: algorithms 명시
      payload = jsonwebtoken.verify(refreshToken, this.refreshSecret, {
        algorithms: ["HS256"],
      }) as { sub: string };
    } catch {
      throw new AuthError(401, "유효하지 않은 refresh token입니다.");
    }

    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!stored) {
      throw new AuthError(401, "유효하지 않은 refresh token입니다.");
    }

    // ─── Reuse Detection (C5의 핵심) ───────────────────────────────────
    if (stored.rotatedAt !== null) {
      // 이미 회전된 토큰을 재사용 시도 → 탈취 의심
      // 해당 사용자의 모든 세션 무효화
      await this.prisma.refreshToken.deleteMany({ where: { userId: stored.userId } });
      this.logger?.warn(
        { userId: stored.userId, originalIp: stored.ipAddress, attemptIp: ctx.ipAddress },
        "[security-alert] Refresh token reuse detected → all sessions revoked",
      );
      // TODO Layer 5: RabbitMQ로 security.alert 발행
      throw new AuthError(401, "보안 위협이 감지되어 모든 세션이 종료되었습니다. 다시 로그인해 주세요.");
    }

    if (stored.expiresAt < new Date()) {
      throw new AuthError(401, "만료된 refresh token입니다.");
    }

    const user = await this.userRepo.findById(payload.sub);
    if (!user || !user.isActive) throw new AuthError(401, "사용자를 찾을 수 없습니다.");

    const newAccessToken = this.signAccess(user.id, user.email, user.role, user.name);
    const newRefreshToken = this.signRefresh(user.id);
    const newTokenHash = this.hashToken(newRefreshToken);
    const newId = `cl${crypto.randomBytes(11).toString("base64url").slice(0, 22)}`; // cuid-ish

    // 회전: 기존 토큰을 rotated_at 마킹 + 새 토큰 INSERT (transaction)
    await this.prisma.$transaction([
      this.prisma.refreshToken.update({
        where: { id: stored.id },
        data: { rotatedAt: new Date(), rotatedToId: newId },
      }),
      this.prisma.refreshToken.create({
        data: {
          id: newId,
          tokenHash: newTokenHash,
          userId: user.id,
          deviceId: stored.deviceId,
          userAgent: ctx.userAgent ?? stored.userAgent,
          ipAddress: ctx.ipAddress ?? null,
          expiresAt: new Date(Date.now() + 7 * 86400_000),
          lastUsedAt: new Date(),
        },
      }),
    ]);

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      deviceId: stored.deviceId ?? undefined,
    };
  }

  // ─── logout (현재 디바이스만) ───────────────────────────────────────
  async logout(userId: string, deviceId?: string) {
    if (deviceId) {
      await this.prisma.refreshToken.deleteMany({ where: { userId, deviceId } });
    } else {
      // deviceId 없으면 모든 세션 (보수적 — 클라이언트가 명시 권장)
      await this.prisma.refreshToken.deleteMany({ where: { userId } });
    }
  }

  // ─── logoutAll (NEW-7 — 다른 기기 모두 로그아웃) ────────────────────
  async logoutOtherDevices(userId: string, currentDeviceId: string) {
    await this.prisma.refreshToken.deleteMany({
      where: { userId, NOT: { deviceId: currentDeviceId } },
    });
  }

  // ─── 활성 세션 목록 (NEW-7) ────────────────────────────────────────
  async listSessions(userId: string, currentDeviceId: string) {
    const tokens = await this.prisma.refreshToken.findMany({
      where: { userId, rotatedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: "desc" },
    });
    return tokens.map((t) => ({
      deviceId: t.deviceId,
      userAgent: t.userAgent,
      ipAddress: t.ipAddress,
      createdAt: t.createdAt,
      lastUsedAt: t.lastUsedAt,
      isCurrent: t.deviceId === currentDeviceId,
    }));
  }

  // ─── 비밀번호 변경 (기존 유지 + 다른 모든 세션 무효화) ───────────
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.userRepo.findById(userId);
    if (!user) throw new AuthError(404, "사용자를 찾을 수 없습니다.");

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw new AuthError(400, "현재 비밀번호가 올바르지 않습니다.");

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.userRepo.update(userId, { passwordHash });
    // 비밀번호 변경 시 모든 세션 무효화
    await this.prisma.refreshToken.deleteMany({ where: { userId } });
  }

  // ─── verify Access (NEW-4 algorithms 명시) ──────────────────────
  verifyAccess(token: string): { sub: string; email: string; role: string; name: string } {
    return jsonwebtoken.verify(token, this.accessSecret, {
      algorithms: ["HS256"],
    }) as { sub: string; email: string; role: string; name: string };
  }

  // ─── sign helpers (NEW-4: TTL 1h, algorithm 명시) ───────────────
  private signAccess(sub: string, email: string, role: string, name: string): string {
    return jsonwebtoken.sign(
      { sub, email, role, name },
      this.accessSecret,
      { expiresIn: "1h", algorithm: "HS256" },  // 8h → 1h
    );
  }

  private signRefresh(sub: string): string {
    return jsonwebtoken.sign(
      { sub },
      this.refreshSecret,
      { expiresIn: "7d", algorithm: "HS256" },
    );
  }
}
```

## auth.routes.ts 변경 사항

```typescript
// POST /api/v1/auth/login
const result = await authService.login(body.data.email, body.data.password, {
  userAgent: req.headers["user-agent"],
  ipAddress: req.headers["x-forwarded-for"]?.split(",")[0] ?? req.ip,  // C6 forward 후
  deviceId: req.cookies["deviceId"],
});

// 쿠키 4종 (C8 path 통일)
const cookieOpts = {
  httpOnly: true,
  path: "/",  // 통일
  sameSite: "strict" as const,
  secure: process.env.NODE_ENV === "production",
};
reply
  .setCookie("accessToken", result.accessToken, { ...cookieOpts, maxAge: 3600 })
  .setCookie("refreshToken", result.refreshToken, { ...cookieOpts, maxAge: 604800 })
  .setCookie("deviceId", result.deviceId, { ...cookieOpts, maxAge: 31536000 });
// CSRF 토큰은 별도 fetch /api/csrf

return reply.code(200).send({ user: result.user });  // accessToken 본문 미포함

// POST /api/v1/auth/refresh — cookie 기반
const refreshToken = req.cookies["refreshToken"];
if (!refreshToken) return reply.code(401).send({ error: { code: "NO_REFRESH_TOKEN", message: "..." } });
const result = await authService.refresh(refreshToken, {
  userAgent: req.headers["user-agent"],
  ipAddress: ...,
  deviceId: req.cookies["deviceId"],
});

// POST /api/v1/auth/logout
const deviceId = req.cookies["deviceId"];
await authService.logout(req.userId, deviceId);
reply.clearCookie("accessToken").clearCookie("refreshToken").clearCookie("deviceId");

// POST /api/v1/auth/logout-all (신규)
await authService.logoutOtherDevices(req.userId, req.cookies["deviceId"]);

// GET /api/v1/auth/sessions (신규)
const sessions = await authService.listSessions(req.userId, req.cookies["deviceId"]);
```

## index.ts 변경 사항

```typescript
// AuthService 생성자에 logger 추가
const authService = new AuthService(userRepo, prisma, ACCESS_SECRET, REFRESH_SECRET, app.log);
```

## apps/web/src/lib/api.ts 변경 사항

```typescript
// localStorage 제거
- function getToken() { return localStorage.getItem("erp_token"); }
- function setToken(t) { localStorage.setItem("erp_token", t); }
+ // accessToken은 httpOnly cookie에만 (JS 접근 불가)

// fetch 옵션에 credentials 추가
fetch(url, {
  credentials: "include",  // cookie 자동 전송
  headers: {
    "Content-Type": "application/json",
+   "X-CSRF-Token": getCookie("csrfToken"),  // CSRF
  },
});

// 401 silent refresh
if (res.status === 401 && !isRefreshRequest) {
  await refreshTokens();
  return retry(originalRequest);
}
```

## CSRF 토큰 처리 (apps/web/src/app/api/csrf/route.ts 신규)

```typescript
import { NextResponse } from "next/server";
import crypto from "node:crypto";

export async function GET() {
  const csrfToken = crypto.randomBytes(16).toString("hex");
  const res = NextResponse.json({ csrfToken });
  res.cookies.set("csrfToken", csrfToken, {
    httpOnly: false,  // JS가 읽어야 함
    sameSite: "strict",
    path: "/",
    maxAge: 3600,
  });
  return res;
}
```

## 적용 순서 (Layer 3 본 작업)

1. Prisma migration 실행: `docker exec erp-ot-auth npx prisma migrate deploy`
2. auth.service.ts 위 코드로 교체
3. auth.routes.ts cookie 처리 + 신규 라우트 추가
4. apps/web/src/lib/api.ts 변경
5. CSRF route 추가
6. shared/middleware/csrf.ts 추가 (web proxy 단계 검증)
7. 사용자 메뉴 UI: 활성 세션 + 다른 기기 로그아웃
8. 재빌드 + sanity (login → refresh → 다기기 시뮬 → reuse 시뮬)
9. git commit + tag security-layer-3-done
