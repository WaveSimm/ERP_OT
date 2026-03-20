import { ProjectTemplate, TemplateScope } from "@prisma/client";

export interface TemplateListFilter {
  scope?: TemplateScope;
  category?: string;
  isRecommended?: boolean;
}

export interface ITemplateRepository {
  findById(id: string): Promise<ProjectTemplate | null>;
  findAll(filter?: TemplateListFilter): Promise<ProjectTemplate[]>;
  create(data: Omit<ProjectTemplate, "id" | "createdAt" | "updatedAt">): Promise<ProjectTemplate>;
  update(id: string, data: Partial<ProjectTemplate>): Promise<ProjectTemplate>;
  delete(id: string): Promise<void>;
}
