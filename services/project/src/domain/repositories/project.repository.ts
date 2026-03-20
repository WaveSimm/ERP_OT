import { Project, ProjectStatus } from "@prisma/client";

export interface ProjectListFilter {
  status?: ProjectStatus;
  groupId?: string;
  ownerId?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface IProjectRepository {
  findById(id: string): Promise<Project | null>;
  findAll(filter: ProjectListFilter): Promise<{ items: Project[]; total: number }>;
  create(data: Omit<Project, "id" | "createdAt" | "updatedAt">): Promise<Project>;
  update(id: string, data: Partial<Project>): Promise<Project>;
  delete(id: string): Promise<void>;
}
