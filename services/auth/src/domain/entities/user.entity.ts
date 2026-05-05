import type { BaseEntity } from "@erp-ot/shared";

export type UserRole = "ADMIN" | "MANAGER" | "OPERATOR" | "VIEWER";

// 자원-모델-분리 PDCA Phase 3a-1 (2026-05-04)
export type EmployeeStatus = "ACTIVE" | "RETIRED" | "SUSPENDED";

export interface User extends BaseEntity {
  email: string;
  name: string;
  passwordHash: string;
  role: UserRole;
  isActive: boolean;
  status: EmployeeStatus;
  retirementDate: Date | null;
  lastLoginAt: Date | null;
}
