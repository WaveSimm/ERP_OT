import bcrypt from "bcryptjs";
import type { IUserRepository, UpdateUserData, UserProfileData } from "../domain/repositories/user.repository";
import type { User, EmployeeStatus } from "../domain/entities/user.entity";
import type { CreateUserDto, UpdateUserDto, UpsertProfileDto } from "../api/dtos/user.dto";
import { AuthError } from "./auth.service";

type SanitizedUser = Omit<User, "passwordHash">;
// findAll/Profile은 런타임에 profile·isOnline을 덧붙여 반환 (repo 구현이 include)
type UserWithExtras = User & { profile?: UserProfileData | null; isOnline?: boolean };
type UserListItem = SanitizedUser & { profile: UserProfileData | null; isOnline: boolean };

export class UserService {
  constructor(private readonly userRepo: IUserRepository) {}

  async findAll(opts?: { includeRetired?: boolean }): Promise<UserListItem[]> {
    const users = await this.userRepo.findAll(opts);
    return users.map((u) => {
      const ux = u as UserWithExtras;
      return { ...this.sanitize(u), profile: ux.profile ?? null, isOnline: ux.isOnline ?? false };
    });
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

  // 자원-모델-분리 PDCA Phase 3a-1: 직원 상태 관리
  async retire(id: string, retirementDate?: Date): Promise<Omit<User, "passwordHash">> {
    const user = await this.userRepo.findById(id);
    if (!user) throw new AuthError(404, "사용자를 찾을 수 없습니다.");
    if (user.status === "RETIRED") throw new AuthError(400, "이미 퇴직 처리된 사용자입니다.");
    const updated = await this.userRepo.update(id, {
      status: "RETIRED",
      isActive: false,
      retirementDate: retirementDate ?? new Date(),
    });
    return this.sanitize(updated);
  }

  async reactivate(id: string): Promise<Omit<User, "passwordHash">> {
    const user = await this.userRepo.findById(id);
    if (!user) throw new AuthError(404, "사용자를 찾을 수 없습니다.");
    const updated = await this.userRepo.update(id, {
      status: "ACTIVE",
      isActive: true,
      retirementDate: null,
    });
    return this.sanitize(updated);
  }

  async updateStatus(
    id: string,
    dto: { status: EmployeeStatus; retirementDate?: Date | null },
  ): Promise<Omit<User, "passwordHash">> {
    const user = await this.userRepo.findById(id);
    if (!user) throw new AuthError(404, "사용자를 찾을 수 없습니다.");
    // RETIRED 변경 시 isActive=false + retirementDate 자동
    const data: UpdateUserData = { status: dto.status };
    if (dto.status === "RETIRED") {
      data.isActive = false;
      data.retirementDate = dto.retirementDate ?? new Date();
    } else if (dto.status === "ACTIVE") {
      data.isActive = true;
      data.retirementDate = null;
    } else if (dto.status === "SUSPENDED") {
      data.isActive = false;
    }
    const updated = await this.userRepo.update(id, data);
    return this.sanitize(updated);
  }

  async resetPassword(id: string, newPassword: string): Promise<void> {
    const user = await this.userRepo.findById(id);
    if (!user) throw new AuthError(404, "사용자를 찾을 수 없습니다.");

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.userRepo.update(id, { passwordHash });
  }

  async getProfile(userId: string): Promise<SanitizedUser & { profile: UserProfileData | null }> {
    const user = await this.userRepo.findById(userId);
    if (!user) throw new AuthError(404, "사용자를 찾을 수 없습니다.");
    const profile = await this.userRepo.findProfile(userId);
    return { ...this.sanitize(user), profile: profile ?? null };
  }

  async upsertProfile(userId: string, dto: UpsertProfileDto): Promise<SanitizedUser & { profile: UserProfileData }> {
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
