import bcrypt from "bcryptjs";
import type { IUserRepository } from "../domain/repositories/user.repository";
import type { User } from "../domain/entities/user.entity";
import type { CreateUserDto, UpdateUserDto, UpsertProfileDto } from "../api/dtos/user.dto";
import { AuthError } from "./auth.service";

export class UserService {
  constructor(private readonly userRepo: IUserRepository) {}

  async findAll(): Promise<any[]> {
    const users = await this.userRepo.findAll();
    return users.map((u) => ({ ...this.sanitize(u), profile: (u as any).profile ?? null, isOnline: (u as any).isOnline ?? false }));
  }

  async create(dto: CreateUserDto): Promise<Omit<User, "passwordHash">> {
    const existing = await this.userRepo.findByEmail(dto.email);
    if (existing) throw new AuthError(409, "이미 사용 중인 이메일입니다.");

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.userRepo.create({
      email: dto.email,
      name: dto.name,
      passwordHash,
      role: dto.role,
      isActive: true,
      lastLoginAt: null,
    });
    return this.sanitize(user);
  }

  async update(id: string, dto: UpdateUserDto, requesterId: string): Promise<Omit<User, "passwordHash">> {
    const user = await this.userRepo.findById(id);
    if (!user) throw new AuthError(404, "사용자를 찾을 수 없습니다.");

    // Prevent admin from removing their own ADMIN role
    if (id === requesterId && dto.role && dto.role !== "ADMIN" && user.role === "ADMIN") {
      throw new AuthError(400, "본인의 ADMIN 권한은 제거할 수 없습니다.");
    }

    const updated = await this.userRepo.update(id, dto);
    return this.sanitize(updated);
  }

  async delete(id: string): Promise<void> {
    const user = await this.userRepo.findById(id);
    if (!user) throw new AuthError(404, "사용자를 찾을 수 없습니다.");
    await this.userRepo.delete(id);
  }

  async resetPassword(id: string, newPassword: string): Promise<void> {
    const user = await this.userRepo.findById(id);
    if (!user) throw new AuthError(404, "사용자를 찾을 수 없습니다.");

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.userRepo.update(id, { passwordHash });
  }

  async getProfile(userId: string): Promise<any> {
    const user = await this.userRepo.findById(userId);
    if (!user) throw new AuthError(404, "사용자를 찾을 수 없습니다.");
    const profile = await this.userRepo.findProfile(userId);
    return { ...this.sanitize(user), profile: profile ?? null };
  }

  async upsertProfile(userId: string, dto: UpsertProfileDto): Promise<any> {
    const user = await this.userRepo.findById(userId);
    if (!user) throw new AuthError(404, "사용자를 찾을 수 없습니다.");
    const profile = await this.userRepo.upsertProfile(userId, dto);
    return { ...this.sanitize(user), profile };
  }

  private sanitize(user: User): Omit<User, "passwordHash"> {
    const { passwordHash: _, ...rest } = user;
    return rest;
  }
}
