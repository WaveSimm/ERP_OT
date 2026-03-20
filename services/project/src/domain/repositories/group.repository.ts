import { ProjectGroup, GroupType } from "@prisma/client";

export interface IGroupRepository {
  findById(id: string): Promise<ProjectGroup | null>;
  findAll(type?: GroupType): Promise<ProjectGroup[]>;
  findChildren(parentGroupId: string): Promise<ProjectGroup[]>;
  create(data: Omit<ProjectGroup, "id" | "createdAt" | "updatedAt">): Promise<ProjectGroup>;
  update(id: string, data: Partial<ProjectGroup>): Promise<ProjectGroup>;
  delete(id: string): Promise<void>;
}
