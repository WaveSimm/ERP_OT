import type { User, EmployeeStatus } from "../entities/user.entity";

export type CreateUserData = Omit<User, "id" | "createdAt" | "updatedAt" | "status" | "retirementDate"> & {
  status?: EmployeeStatus;
  retirementDate?: Date | null;
};

export type UpdateUserData = {
  name?: string | undefined;
  role?: User["role"] | undefined;
  isActive?: boolean | undefined;
  status?: EmployeeStatus | undefined;
  retirementDate?: Date | null | undefined;
  passwordHash?: string | undefined;
};

export type UserProfileData = {
  phoneOffice?:    string | null | undefined;
  phoneMobile?:    string | null | undefined;
  address?:        string | null | undefined;
  departmentId?:   string | null | undefined;
  departmentName?: string | null | undefined;
};

export interface IUserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findAll(opts?: { includeRetired?: boolean }): Promise<User[]>;
  create(data: CreateUserData): Promise<User>;
  update(id: string, data: UpdateUserData): Promise<User>;
  updateLastLogin(id: string): Promise<void>;
  delete(id: string): Promise<void>;
  findProfile(userId: string): Promise<UserProfileData | null>;
  upsertProfile(userId: string, data: UserProfileData): Promise<UserProfileData>;
}
