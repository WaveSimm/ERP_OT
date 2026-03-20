import { ProjectBaseline } from "@prisma/client";

export interface IBaselineRepository {
  findById(id: string): Promise<ProjectBaseline | null>;
  findByProjectId(projectId: string): Promise<ProjectBaseline[]>;
  create(data: { projectId: string; name: string; reason: string; createdBy: string }): Promise<ProjectBaseline>;
  delete(id: string): Promise<void>;
}
