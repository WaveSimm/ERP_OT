import { Resource, ResourceType } from "@prisma/client";

export interface ResourceListFilter {
  type?: ResourceType;
  isActive?: boolean;
}

export interface IResourceRepository {
  findById(id: string): Promise<Resource | null>;
  findAll(filter?: ResourceListFilter): Promise<Resource[]>;
  create(data: Omit<Resource, "id" | "createdAt" | "updatedAt">): Promise<Resource>;
  update(id: string, data: Partial<Resource>): Promise<Resource>;
}
