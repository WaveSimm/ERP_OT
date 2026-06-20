import { PrismaClient, Prisma, DeploymentTemplate } from "@prisma/client";
import type { IDeploymentTemplateRepository } from "../../domain/repositories/deployment-template.repository.js";

/** IDeploymentTemplateRepository 의 Prisma 구현 (infrastructure 계층). */
export class PrismaDeploymentTemplateRepository implements IDeploymentTemplateRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findMany(where?: Prisma.DeploymentTemplateWhereInput): Promise<DeploymentTemplate[]> {
    return this.prisma.deploymentTemplate.findMany({
      ...(where ? { where } : {}),
      orderBy: { createdAt: "desc" },
    });
  }

  findById(id: string): Promise<DeploymentTemplate | null> {
    return this.prisma.deploymentTemplate.findUnique({ where: { id } });
  }

  create(data: Prisma.DeploymentTemplateUncheckedCreateInput): Promise<DeploymentTemplate> {
    return this.prisma.deploymentTemplate.create({ data });
  }

  update(id: string, data: Prisma.DeploymentTemplateUncheckedUpdateInput): Promise<DeploymentTemplate> {
    return this.prisma.deploymentTemplate.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.deploymentTemplate.delete({ where: { id } });
  }
}
