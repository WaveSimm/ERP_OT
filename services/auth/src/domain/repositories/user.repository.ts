import type { User } from "../entities/user.entity";

export type CreateUserData = Omit<User, "id" | "createdAt" | "updatedAt">;

export type UpdateUserData = {
  name?: string | undefined;
  role?: User["role"] | undefined;
  isActive?: boolean | undefined;
  passwordHash?: string | undefined;
};

export interface IUserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findAll(): Promise<User[]>;
  create(data: CreateUserData): Promise<User>;
  update(id: string, data: UpdateUserData): Promise<User>;
  updateLastLogin(id: string): Promise<void>;
}
