export interface CreateTemplateDto {
  name: string;
  description?: string;
  category?: string;
  scope?: "PERSONAL" | "TEAM" | "GLOBAL";
}

export interface TemplatePreviewDto {
  projectStartDate: string; // YYYY-MM-DD
}

export interface TemplateInstantiateDto {
  projectId: string;
  projectStartDate: string; // YYYY-MM-DD
  includeSegments?: boolean;
  includeAssignments?: boolean;
  includeDependencies?: boolean;
}

export interface TemplateListQuery {
  category?: string;
  scope?: string;
}
