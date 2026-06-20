import { PrismaClient, Prisma, ScheduleType } from "@prisma/client";
import type { IAssetScheduleRepository } from "../../domain/repositories/asset-schedule.repository.js";

export class ScheduleService {
  // repo: AssetSchedule CRUD(Clean Arch). prisma: 복잡 read(목록·timeline·충돌검사).
  constructor(
    private readonly repo: IAssetScheduleRepository,
    private readonly prisma: PrismaClient,
  ) {}

  async listByEquipment(equipmentId: string, startDate?: string, endDate?: string) {
    const where: any = { equipmentId };
    if (startDate || endDate) {
      where.AND = [];
      if (startDate) where.AND.push({ endDate: { gte: new Date(startDate) } });
      if (endDate) where.AND.push({ startDate: { lte: new Date(endDate) } });
    }
    return this.prisma.assetSchedule.findMany({ where, orderBy: { startDate: "asc" } });
  }

  async listBySensor(sensorId: string, startDate?: string, endDate?: string) {
    const where: any = { sensorId };
    if (startDate || endDate) {
      where.AND = [];
      if (startDate) where.AND.push({ endDate: { gte: new Date(startDate) } });
      if (endDate) where.AND.push({ startDate: { lte: new Date(endDate) } });
    }
    return this.prisma.assetSchedule.findMany({ where, orderBy: { startDate: "asc" } });
  }

  async getTimeline(params: {
    startDate: string; endDate: string;
    assetType?: string; categoryId?: string;
  }) {
    const { startDate, endDate, categoryId } = params;
    const assetType = params.assetType && params.assetType !== "undefined" ? params.assetType : undefined;
    const start = new Date(startDate);
    const end = new Date(endDate);

    const assets: any[] = [];

    if (!assetType || assetType === "EQUIPMENT" || assetType === "ALL") {
      const eqWhere: any = { status: { not: "RETIRED" } };
      if (categoryId) eqWhere.categoryId = categoryId;
      const equipment = await this.prisma.equipment.findMany({
        where: eqWhere,
        include: {
          category: true,
          schedules: {
            where: { endDate: { gte: start }, startDate: { lte: end } },
            orderBy: { startDate: "asc" },
          },
        },
        orderBy: { name: "asc" },
      });
      for (const eq of equipment) {
        assets.push({
          id: eq.id, name: eq.name, type: "EQUIPMENT",
          category: eq.category.name, status: eq.status,
          schedules: eq.schedules,
        });
      }
    }

    if (!assetType || assetType === "SENSOR" || assetType === "ALL") {
      const snWhere: any = { status: { not: "RETIRED" } };
      if (categoryId) snWhere.categoryId = categoryId;
      const sensors = await this.prisma.sensor.findMany({
        where: snWhere,
        include: {
          category: true,
          schedules: {
            where: { endDate: { gte: start }, startDate: { lte: end } },
            orderBy: { startDate: "asc" },
          },
        },
        orderBy: { name: "asc" },
      });
      for (const sn of sensors) {
        assets.push({
          id: sn.id, name: sn.name, type: "SENSOR",
          category: sn.category.name, status: sn.status,
          schedules: sn.schedules,
        });
      }
    }

    return { assets, startDate, endDate };
  }

  async create(data: {
    equipmentId?: string; sensorId?: string;
    type?: string; title: string; description?: string;
    startDate: string; endDate: string;
    projectId?: string; projectName?: string; deploymentId?: string;
  }, userId: string) {
    if (!data.equipmentId && !data.sensorId) {
      throw new Error("equipmentId 또는 sensorId 중 하나는 필수입니다.");
    }

    // 충돌 감지 (날짜 겹침만 검사)
    const conflicts = await this.checkConflicts(
      data.equipmentId ?? null,
      data.sensorId ?? null,
      data.startDate,
      data.endDate,
    );
    if (conflicts.length > 0) {
      const names = conflicts.map((c) => `${c.title} (${c.startDate.toLocaleDateString()}~${c.endDate.toLocaleDateString()})`);
      throw new Error(`일정 충돌: ${names.join(", ")}`);
    }

    return this.repo.create({
      type: (data.type as ScheduleType) ?? "MAINTENANCE",
      title: data.title,
      startDate: new Date(data.startDate),
      endDate: new Date(data.endDate),
      createdBy: userId,
      ...(data.equipmentId != null && { equipmentId: data.equipmentId }),
      ...(data.sensorId != null && { sensorId: data.sensorId }),
      ...(data.description != null && { description: data.description }),
      ...(data.projectId != null && { projectId: data.projectId }),
      ...(data.projectName != null && { projectName: data.projectName }),
      ...(data.deploymentId != null && { deploymentId: data.deploymentId }),
    });
  }

  async update(id: string, data: Prisma.AssetScheduleUncheckedUpdateInput & { startDate?: string | Date; endDate?: string | Date }) {
    if (data.startDate) data.startDate = new Date(data.startDate as string);
    if (data.endDate) data.endDate = new Date(data.endDate as string);

    // 날짜 변경 시 충돌 재검사
    if (data.startDate || data.endDate) {
      const existing = await this.repo.findById(id);
      if (existing) {
        const conflicts = await this.checkConflicts(
          existing.equipmentId,
          existing.sensorId,
          ((data.startDate ?? existing.startDate) as Date).toISOString(),
          ((data.endDate ?? existing.endDate) as Date).toISOString(),
          id,
        );
        if (conflicts.length > 0) {
          const names = conflicts.map((c) => `${c.title} (${c.startDate.toLocaleDateString()}~${c.endDate.toLocaleDateString()})`);
          throw new Error(`일정 충돌: ${names.join(", ")}`);
        }
      }
    }

    return this.repo.update(id, data as Prisma.AssetScheduleUncheckedUpdateInput);
  }

  async remove(id: string) {
    await this.repo.delete(id);
  }

  private async checkConflicts(
    equipmentId: string | null,
    sensorId: string | null,
    startDate: string,
    endDate: string,
    excludeId?: string,
  ) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const where: any = {
      startDate: { lte: end },
      endDate: { gte: start },
    };
    if (equipmentId) where.equipmentId = equipmentId;
    if (sensorId) where.sensorId = sensorId;
    if (excludeId) where.id = { not: excludeId };

    return this.prisma.assetSchedule.findMany({ where });
  }
}
