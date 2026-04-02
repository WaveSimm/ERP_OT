import { PrismaClient } from "@prisma/client";
import type { IUserRepository, CreateUserData, UpdateUserData, UserProfileData } from "../../domain/repositories/user.repository";
import type { User } from "../../domain/entities/user.entity";

export class UserPrismaRepository implements IUserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<User | null> {
    const row = await this.prisma.user.findUnique({ where: { id } });
    return row ? this.toEntity(row) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const row = await this.prisma.user.findUnique({ where: { email } });
    return row ? this.toEntity(row) : null;
  }

  async findAll(): Promise<(User & { profile?: UserProfileData | null; isOnline?: boolean })[]> {
    const now = new Date();
    const rows = await this.prisma.user.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        profile: true,
        refreshTokens: { where: { expiresAt: { gt: now } }, select: { id: true }, take: 1 },
      },
    });
    return rows.map((row) => ({
      ...this.toEntity(row),
      profile: row.profile ? {
        phoneOffice:    row.profile.phoneOffice,
        phoneMobile:    row.profile.phoneMobile,
        address:        row.profile.address,
        departmentId:   row.profile.departmentId,
        departmentName: row.profile.departmentName,
      } : null,
      isOnline: row.refreshTokens.length > 0,
    }));
  }

  async create(data: CreateUserData): Promise<User> {
    const row = await this.prisma.user.create({
      data: {
        email: data.email,
        name: data.name,
        passwordHash: data.passwordHash,
        role: data.role,
        isActive: data.isActive,
        lastLoginAt: data.lastLoginAt,
      },
    });
    return this.toEntity(row);
  }

  async update(id: string, data: UpdateUserData): Promise<User> {
    const row = await this.prisma.user.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.role !== undefined && { role: data.role }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
        ...(data.passwordHash !== undefined && { passwordHash: data.passwordHash }),
      },
    });
    return this.toEntity(row);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.user.delete({ where: { id } });
  }

  async updateLastLogin(id: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { lastLoginAt: new Date() },
    });
  }

  async findProfile(userId: string): Promise<UserProfileData | null> {
    const row = await this.prisma.userProfile.findUnique({ where: { userId } });
    if (!row) return null;
    return {
      phoneOffice:    row.phoneOffice,
      phoneMobile:    row.phoneMobile,
      address:        row.address,
      departmentId:   row.departmentId,
      departmentName: row.departmentName,
    };
  }

  async upsertProfile(userId: string, data: UserProfileData): Promise<UserProfileData> {
    // exactOptionalPropertyTypes 대응: undefined 필드 제거 후 Prisma에 전달
    const clean: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined) clean[k] = v as string | null;
    }
    const row = await this.prisma.userProfile.upsert({
      where: { userId },
      create: { userId, ...clean },
      update: { ...clean },
    });
    return {
      phoneOffice:    row.phoneOffice,
      phoneMobile:    row.phoneMobile,
      address:        row.address,
      departmentId:   row.departmentId,
      departmentName: row.departmentName,
    };
  }

  private toEntity(row: {
    id: string;
    email: string;
    name: string;
    passwordHash: string;
    role: "ADMIN" | "MANAGER" | "OPERATOR" | "VIEWER";
    isActive: boolean;
    lastLoginAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): User {
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      passwordHash: row.passwordHash,
      role: row.role,
      isActive: row.isActive,
      lastLoginAt: row.lastLoginAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
