import { PrismaClient, Prisma } from "@prisma/client";
import type { IDeploymentTemplateRepository } from "../../domain/repositories/deployment-template.repository.js";

export class TemplateService {
  // repo: DeploymentTemplate aggregate(Clean Arch). prisma: saveFromDeployment의 deployment read.
  constructor(
    private readonly repo: IDeploymentTemplateRepository,
    private readonly prisma: PrismaClient,
  ) {}

  async list(params: { categoryId?: string; isPublic?: boolean; createdBy?: string }) {
    const where: Prisma.DeploymentTemplateWhereInput = {};
    if (params.categoryId) where.categoryId = params.categoryId;
    if (params.isPublic !== undefined) where.isPublic = params.isPublic;
    if (params.createdBy) where.createdBy = params.createdBy;
    return this.repo.findMany(where);
  }

  async getById(id: string) {
    const tmpl = await this.repo.findById(id);
    if (!tmpl) throw new Error("템플릿을 찾을 수 없습니다.");
    return tmpl;
  }

  async create(data: {
    name: string; description?: string; categoryId?: string;
    sensorConfig: Prisma.InputJsonValue; isPublic?: boolean;
  }, userId: string) {
    return this.repo.create({
      name: data.name,
      sensorConfig: data.sensorConfig,
      createdBy: userId,
      ...(data.description != null && { description: data.description }),
      ...(data.categoryId != null && { categoryId: data.categoryId }),
      ...(data.isPublic != null && { isPublic: data.isPublic }),
    });
  }

  async update(id: string, data: Prisma.DeploymentTemplateUncheckedUpdateInput) {
    return this.repo.update(id, data);
  }

  async remove(id: string) {
    await this.repo.delete(id);
  }

  /** 투입 구성에서 템플릿 저장 */
  async saveFromDeployment(deploymentId: string, data: { name: string; description?: string; isPublic?: boolean }, userId: string) {
    const deployment = await this.prisma.deployment.findUnique({
      where: { id: deploymentId },
      include: { sensors: { include: { sensor: { include: { category: true } } } } },
    });
    if (!deployment) throw new Error("투입 구성을 찾을 수 없습니다.");

    const sensorConfig = deployment.sensors.map((ds) => ({
      sensorCategoryId: ds.sensor.categoryId,
      sensorCategoryName: ds.sensor.category?.name,
      configParams: ds.configParams,
    })) as Prisma.InputJsonValue;

    return this.repo.create({
      name: data.name,
      sensorConfig,
      createdBy: userId,
      ...(data.description != null && { description: data.description }),
      ...(data.isPublic != null && { isPublic: data.isPublic }),
    });
  }
}
