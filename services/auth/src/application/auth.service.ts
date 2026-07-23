// 보안 일괄패치 PDCA Layer 3
//   C5: RefreshToken sha256 해시 저장 (DB 평문 노출 차단)
//   C8: Refresh 쿠키 path 통일 (auth.routes.ts에서 처리)
//   H5: login 다중 쓰기 $transaction 원자화
//   NEW-4: JWT verify에 algorithms 명시 (alg confusion 방지) + Access TTL 8h → 1h
//   NEW-7: 다중 디바이스 허용 (deviceId) + logoutOtherDevices + listSessions
//   Reuse Detection: rotatedAt 마킹된 토큰 재사용 시 전 세션 무효화 + alert

import bcrypt from "bcryptjs";
import * as jsonwebtoken from "jsonwebtoken";
import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import type { IUserRepository } from "../domain/repositories/user.repository";
import type { FastifyBaseLogger } from "fastify";

export class AuthError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export interface LoginContext {
  userAgent?: string | undefined;
  ipAddress?: string | undefined;
  deviceId?: string | undefined; // 기존 cookie 값 (있으면 재사용)
}

export interface RefreshContext {
  userAgent?: string | undefined;
  ipAddress?: string | undefined;
  deviceId?: string | undefined;
}

const ACCESS_TTL_SECONDS = 15 * 60; // 15m — refresh(30m)보다 짧게 두어 활동 중 자동 갱신(슬라이딩)되게
const REFRESH_TTL_SECONDS = 30 * 60; // 30m 슬라이딩 — 모든 기기(모바일/외부/닫은 탭)에서 30분 유휴 로그아웃
const REUSE_GRACE_MS = 60 * 1000; // 회전 후 60초 내 같은 IP의 재사용 = 멀티탭 정상 레이스로 간주(전 세션 무효화 오발 방지)
const JWT_ALGORITHM = "HS256" as const;

export class AuthService {
  constructor(
    private readonly userRepo: IUserRepository,
    private readonly prisma: PrismaClient,
    private readonly accessSecret: string,
    private readonly refreshSecret: string,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  // ─── 헬퍼 ──────────────────────────────────────────────────────────────
  private hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  private generateDeviceId(): string {
    return crypto.randomBytes(16).toString("hex");
  }

  // ─── login (H5: $transaction, NEW-7: 다기기, deviceId 처리) ────────────
  async login(email: string, password: string, ctx: LoginContext = {}) {
    const user = await this.userRepo.findByEmail(email);
    if (!user) throw new AuthError(401, "이메일 또는 비밀번호가 올바르지 않습니다.", "INVALID_CREDENTIALS");
    if (!user.isActive) throw new AuthError(403, "비활성화된 계정입니다.", "ACCOUNT_DISABLED");
    // 자원-모델-분리 PDCA Phase 3a-1: 퇴직자/정지 차단
    if (user.status === "RETIRED") throw new AuthError(403, "퇴직 처리된 계정입니다.", "ACCOUNT_RETIRED");
    if (user.status === "SUSPENDED") throw new AuthError(403, "정지된 계정입니다.", "ACCOUNT_SUSPENDED");

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new AuthError(401, "이메일 또는 비밀번호가 올바르지 않습니다.", "INVALID_CREDENTIALS");

    const deviceId = ctx.deviceId || this.generateDeviceId();
    const accessToken = this.signAccess(user.id, user.email, user.role, user.name);
    const refreshToken = this.signRefresh(user.id);
    const tokenHash = this.hashToken(refreshToken);

    // H5: 같은 디바이스의 기존 토큰 삭제 + 새 토큰 INSERT을 하나의 트랜잭션으로
    // NEW-7: 다른 디바이스의 토큰은 유지 (다기기 동시 로그인 가능)
    await this.prisma.$transaction([
      this.prisma.refreshToken.deleteMany({
        where: { userId: user.id, deviceId },
      }),
      this.prisma.refreshToken.create({
        data: {
          tokenHash,
          userId: user.id,
          deviceId,
          userAgent: ctx.userAgent ?? null,
          ipAddress: ctx.ipAddress ?? null,
          expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
        },
      }),
    ]);
    await this.userRepo.updateLastLogin(user.id);

    const isTeamLeader = await this.isTeamLeader(user.id);

    return {
      accessToken,
      refreshToken,
      deviceId,
      user: { id: user.id, email: user.email, name: user.name, role: user.role, isTeamLeader },
    };
  }

  // 조직도 직책(팀장/총괄/대표) 보유 여부 — 헤더 메뉴 노출 조건
  async isTeamLeader(userId: string): Promise<boolean> {
    const cnt = await this.prisma.department.count({
      where: {
        isActive: true,
        OR: [{ headUserId: userId }, { soukwalUserId: userId }, { daepyoUserId: userId }],
      },
    });
    return cnt > 0;
  }

  // ─── refresh (C5 hash + Reuse Detection + NEW-7) ───────────────────────
  async refresh(refreshToken: string, ctx: RefreshContext = {}) {
    let payload: { sub: string };
    try {
      // NEW-4: algorithms 명시
      payload = jsonwebtoken.verify(refreshToken, this.refreshSecret, {
        algorithms: [JWT_ALGORITHM],
      }) as { sub: string };
    } catch {
      throw new AuthError(401, "유효하지 않은 refresh token입니다.", "INVALID_REFRESH");
    }

    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!stored) {
      throw new AuthError(401, "유효하지 않은 refresh token입니다.", "INVALID_REFRESH");
    }

    // ─── Reuse Detection (+ grace) ────────────────────────────────
    // 이미 회전된 토큰을 재사용하려는 시도 → 탈취 의심.
    // 단, 멀티탭/동시 요청의 정상 레이스(두 탭이 같은 쿠키로 거의 동시에 refresh)가
    // 오발되어 전 세션이 무효화되는 사고가 있어, "회전 직후 + 같은 IP"의 재사용은
    // 공격이 아닌 레이스로 간주하고 정상 회전을 허용한다(오래된 행은 IP 미기록 → IP 불일치만 차단).
    if (stored.rotatedAt !== null) {
      const withinGrace = Date.now() - stored.rotatedAt.getTime() < REUSE_GRACE_MS;
      const ipMismatch = !!stored.ipAddress && !!ctx.ipAddress && stored.ipAddress !== ctx.ipAddress;
      if (withinGrace && !ipMismatch) {
        this.logger?.info(
          { userId: stored.userId, ip: ctx.ipAddress, rotatedAt: stored.rotatedAt },
          "[auth] refresh race within grace — rotation allowed (not treated as reuse attack)",
        );
      } else {
        // 해당 사용자의 모든 세션 무효화
        await this.prisma.refreshToken.deleteMany({ where: { userId: stored.userId } });
        this.logger?.warn(
          {
            userId: stored.userId,
            originalIp: stored.ipAddress,
            attemptIp: ctx.ipAddress,
            rotatedAt: stored.rotatedAt,
          },
          "[security-alert] Refresh token reuse detected — all sessions revoked",
        );
        throw new AuthError(
          401,
          "보안 위협이 감지되어 모든 세션이 종료되었습니다. 다시 로그인해 주세요.",
          "REFRESH_REUSE_DETECTED",
        );
      }
    }

    if (stored.expiresAt < new Date()) {
      throw new AuthError(401, "만료된 refresh token입니다.", "REFRESH_EXPIRED");
    }

    const user = await this.userRepo.findById(payload.sub);
    if (!user || !user.isActive) {
      throw new AuthError(401, "사용자를 찾을 수 없습니다.", "INVALID_REFRESH");
    }

    const newAccessToken = this.signAccess(user.id, user.email, user.role, user.name);
    const newRefreshToken = this.signRefresh(user.id);
    const newTokenHash = this.hashToken(newRefreshToken);

    // 회전: create 먼저 (id 받기) → update old with rotated_to_id
    const newRow = await this.prisma.refreshToken.create({
      data: {
        tokenHash: newTokenHash,
        userId: user.id,
        deviceId: stored.deviceId,
        userAgent: ctx.userAgent ?? stored.userAgent,
        ipAddress: ctx.ipAddress ?? null,
        expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
        lastUsedAt: new Date(),
      },
    });
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { rotatedAt: new Date(), rotatedToId: newRow.id },
    });

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      deviceId: stored.deviceId ?? undefined,
    };
  }

  // ─── logout (deviceId 명시 시 해당 디바이스만, 없으면 모든 세션) ─────
  async logout(userId: string, deviceId?: string) {
    if (deviceId) {
      await this.prisma.refreshToken.deleteMany({ where: { userId, deviceId } });
    } else {
      await this.prisma.refreshToken.deleteMany({ where: { userId } });
    }
  }

  // refresh 쿠키만으로 로그아웃 — access 토큰이 만료됐어도 세션을 확실히 종료한다.
  //   (로그아웃 라우트가 authenticate에 의존하지 않도록: 만료 상태 로그아웃 시 세션이 살아남는 버그 방지)
  //   토큰 행에서 userId를 얻어 해당 디바이스의 refresh 토큰(회전 잔재 포함)을 모두 삭제하고 userId를 반환.
  async logoutByRefreshToken(refreshToken: string, deviceId?: string): Promise<string | undefined> {
    const tokenHash = this.hashToken(refreshToken);
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: { userId: true },
    });
    if (!row) return undefined;
    if (deviceId) {
      await this.prisma.refreshToken.deleteMany({ where: { userId: row.userId, deviceId } });
    } else {
      await this.prisma.refreshToken.deleteMany({ where: { tokenHash } });
    }
    return row.userId;
  }

  // ─── logoutOtherDevices (NEW-7 — 다른 기기 모두 로그아웃) ──────────
  async logoutOtherDevices(userId: string, currentDeviceId: string) {
    await this.prisma.refreshToken.deleteMany({
      where: { userId, NOT: { deviceId: currentDeviceId } },
    });
  }

  // ─── listSessions (NEW-7 — 활성 세션 목록) ─────────────────────────
  async listSessions(userId: string, currentDeviceId?: string) {
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
      isCurrent: !!currentDeviceId && t.deviceId === currentDeviceId,
    }));
  }

  // ─── changePassword (변경 시 모든 세션 무효화) ─────────────────────
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.userRepo.findById(userId);
    if (!user) throw new AuthError(404, "사용자를 찾을 수 없습니다.");

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw new AuthError(400, "현재 비밀번호가 올바르지 않습니다.");

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.userRepo.update(userId, { passwordHash });
    // 비밀번호 변경 시 모든 세션 무효화 (보안 강화)
    await this.prisma.refreshToken.deleteMany({ where: { userId } });
  }

  // ─── verifyAccess (NEW-4 algorithms 명시) ──────────────────────────
  verifyAccess(token: string): { sub: string; email: string; role: string; name: string } {
    return jsonwebtoken.verify(token, this.accessSecret, {
      algorithms: [JWT_ALGORITHM],
    }) as { sub: string; email: string; role: string; name: string };
  }

  // ─── sign helpers (NEW-4: TTL 1h, algorithm 명시) ───────────────────
  private signAccess(sub: string, email: string, role: string, name: string): string {
    return jsonwebtoken.sign(
      { sub, email, role, name },
      this.accessSecret,
      { expiresIn: ACCESS_TTL_SECONDS, algorithm: JWT_ALGORITHM },
    );
  }

  private signRefresh(sub: string): string {
    return jsonwebtoken.sign(
      { sub },
      this.refreshSecret,
      { expiresIn: REFRESH_TTL_SECONDS, algorithm: JWT_ALGORITHM },
    );
  }
}
