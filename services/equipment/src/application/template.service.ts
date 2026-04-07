import { PrismaClient } from "@prisma/client";

export class TemplateService {
  constructor(private prisma: PrismaClient) {}

  async list(params: { categoryId?: string; isPublic?: boolean; createdBy?: string }) {
    const where: any = {};
    if (params.categoryId) where.categoryId = params.categoryId;
    if (params.isPublic !== undefined) where.isPublic = params.isPublic;
    if (params.createdBy) where.createdBy = params.createdBy;
    return this.prisma.deploymentTemplate.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
  }

  async getById(id: string) {
    const tmpl = await this.prisma.deploymentTemplate.findUnique({ where: { id } });
    if (!tmpl) throw new Error("템플릿을 찾을 수 없습니다.");
    return tmpl;
  }

  async create(data: {
    name: string; description?: string; categoryId?: string;
    sensorConfig: any; isPublic?: boolean;
  }, userId: string) {
    return this.prisma.deploymentTemplate.create({
      data: {
        name: data.name,
        sensorConfig: data.sensorConfig,
        createdBy: userId,
        ...(data.description != null && { description: data.description }),
        ...(data.categoryId != null && { categoryId: data.categoryId }),
        ...(data.isPublic != null && { isPublic: data.isPublic }),
      },
    });
  }

  async update(id: string, data: any) {
    return this.prisma.deploymentTemplate.update({ where: { id }, data });
  }

  async remove(id: string) {
    return this.prisma.deploymentTemplate.delete({ where: { id } });
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
    }));

    return this.prisma.deploymentTemplate.create({
      data: {
        name: data.name,
        sensorConfig,
        createdBy: userId,
        ...(data.description != null && { description: data.description }),
        ...(data.isPublic != null && { isPublic: data.isPublic }),
      },
    });
  }
}
