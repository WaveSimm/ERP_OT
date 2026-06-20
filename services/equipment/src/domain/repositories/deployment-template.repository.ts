import type { Prisma, DeploymentTemplate } from "@prisma/client";

/**
 * DeploymentTemplate aggregate 영속성 인터페이스 (Clean Architecture — domain 계층).
 * CRUD + 단순 목록 담당. saveFromDeployment 의 cross-aggregate read(deployment+sensors)는
 * service 에 유지하고, 템플릿 생성만 create 로 위임.
 */
export interface IDeploymentTemplateRepository {
  findMany(where?: Prisma.DeploymentTemplateWhereInput): Promise<DeploymentTemplate[]>;
  findById(id: string): Promise<DeploymentTemplate | null>;
  create(data: Prisma.DeploymentTemplateUncheckedCreateInput): Promise<DeploymentTemplate>;
  update(id: string, data: Prisma.DeploymentTemplateUncheckedUpdateInput): Promise<DeploymentTemplate>;
  delete(id: string): Promise<void>;
}
