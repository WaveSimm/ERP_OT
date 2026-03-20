import { ProjectStatus } from "@prisma/client";

export interface CreateProjectDto {
  name: string;
  description?: string;
  plannedBudget?: number;
  templateId?: string;
  templateStartDate?: string;
  ownerId?: string;
}

export interface UpdateProjectDto {
  name?: string;
  description?: string | null;
  status?: ProjectStatus;
  plannedBudget?: number | null;
  actualBudget?: number | null;
  ownerId?: string;
}

export interface CloneProjectDto {
  name: string;
  dateOffsetDays?: number;
  includeSegments?: boolean;
  includeAssignments?: boolean;
  includeDependencies?: boolean;
}

export interface ProjectListQuery {
  status?: ProjectStatus;
  groupId?: string;
  ownerId?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface ProjectListResponse {
  items: unknown[];
  total: number;
  page: number;
  limit: number;
}
