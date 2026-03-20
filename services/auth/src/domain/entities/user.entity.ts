import type { BaseEntity } from "@erp-ot/shared";

export type UserRole = "ADMIN" | "MANAGER" | "OPERATOR" | "VIEWER";

export interface User extends BaseEntity {
  email: string;
  name: string;
  passwordHash: string;
  role: UserRole;
  isActive: boolean;
  lastLoginAt: Date | null;
}
