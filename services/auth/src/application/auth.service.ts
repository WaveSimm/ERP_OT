import bcrypt from "bcryptjs";
import * as jsonwebtoken from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import type { IUserRepository } from "../domain/repositories/user.repository";

export class AuthError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export class AuthService {
  constructor(
    private readonly userRepo: IUserRepository,
    private readonly prisma: PrismaClient,
    private readonly accessSecret: string,
    private readonly refreshSecret: string,
  ) {}

  async login(email: string, password: string) {
    const user = await this.userRepo.findByEmail(email);
    if (!user) throw new AuthError(401, "이메일 또는 비밀번호가 올바르지 않습니다.");
    if (!user.isActive) throw new AuthError(403, "비활성화된 계정입니다.");

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new AuthError(401, "이메일 또는 비밀번호가 올바르지 않습니다.");

    const accessToken = this.signAccess(user.id, user.email, user.role, user.name);
    const refreshToken = this.signRefresh(user.id);

    await this.prisma.refreshToken.deleteMany({ where: { userId: user.id } });
    await this.prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 86400_000),
      },
    });

    await this.userRepo.updateLastLogin(user.id);

    return {
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    };
  }

  async refresh(refreshToken: string) {
    let payload: { sub: string };
    try {
      payload = jsonwebtoken.verify(refreshToken, this.refreshSecret) as { sub: string };
    } catch {
      throw new AuthError(401, "유효하지 않은 refresh token입니다.");
    }

    const stored = await this.prisma.refreshToken.findUnique({ where: { token: refreshToken } });
    if (!stored || stored.expiresAt < new Date()) {
      throw new AuthError(401, "만료되었거나 유효하지 않은 refresh token입니다.");
    }

    const user = await this.userRepo.findById(payload.sub);
    if (!user || !user.isActive) throw new AuthError(401, "사용자를 찾을 수 없습니다.");

    const newAccessToken = this.signAccess(user.id, user.email, user.role, user.name);
    const newRefreshToken = this.signRefresh(user.id);

    await this.prisma.refreshToken.update({
      where: { token: refreshToken },
      data: {
        token: newRefreshToken,
        expiresAt: new Date(Date.now() + 7 * 86400_000),
      },
    });

    return { accessToken: newAccessToken, refreshToken: newRefreshToken };
  }

  async logout(userId: string) {
    await this.prisma.refreshToken.deleteMany({ where: { userId } });
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.userRepo.findById(userId);
    if (!user) throw new AuthError(404, "사용자를 찾을 수 없습니다.");

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw new AuthError(400, "현재 비밀번호가 올바르지 않습니다.");

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.userRepo.update(userId, { passwordHash });
  }

  verifyAccess(token: string): { sub: string; email: string; role: string; name: string } {
    return jsonwebtoken.verify(token, this.accessSecret) as { sub: string; email: string; role: string; name: string };
  }

  private signAccess(sub: string, email: string, role: string, name: string): string {
    return jsonwebtoken.sign({ sub, email, role, name }, this.accessSecret, { expiresIn: "8h" });
  }

  private signRefresh(sub: string): string {
    return jsonwebtoken.sign({ sub }, this.refreshSecret, { expiresIn: "7d" });
  }
}
