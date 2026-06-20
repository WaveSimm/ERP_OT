import { PrismaClient, Prisma, MaintenanceType } from "@prisma/client";
import type { IMaintenanceRecordRepository } from "../../domain/repositories/maintenance-record.repository.js";

export class MaintenanceService {
  // repo: MaintenanceRecord CRUD(Clean Arch). prisma: 복잡 read(목록·getPreventiveDue) +
  //   교정 완료 시 sensor 갱신(cross-aggregate).
  constructor(
    private readonly repo: IMaintenanceRecordRepository,
    private readonly prisma: PrismaClient,
  ) {}

  async listByEquipment(equipmentId: string, page = 1, limit = 20) {
    const where = { equipmentId };
    const [items, total] = await Promise.all([
      this.prisma.maintenanceRecord.findMany({
        where,
        orderBy: { performedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.maintenanceRecord.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async listBySensor(sensorId: string, page = 1, limit = 20) {
    const where = { sensorId };
    const [items, total] = await Promise.all([
      this.prisma.maintenanceRecord.findMany({
        where,
        orderBy: { performedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.maintenanceRecord.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async create(data: {
    equipmentId?: string; sensorId?: string;
    type: string; title: string; description?: string;
    performedBy?: string; performedAt: string; completedAt?: string;
    cost?: number; durationHours?: number;
    replacedParts?: string; notes?: string;
  }, userId: string) {
    if (!data.equipmentId && !data.sensorId) {
      throw new Error("equipmentId 또는 sensorId 중 하나는 필수입니다.");
    }

    const record = await this.repo.create({

        type: data.type as MaintenanceType,
        title: data.title,
        performedAt: new Date(data.performedAt),
        createdBy: userId,
        ...(data.equipmentId != null && { equipmentId: data.equipmentId }),
        ...(data.sensorId != null && { sensorId: data.sensorId }),
        ...(data.description != null && { description: data.description }),
        ...(data.performedBy != null && { performedBy: data.performedBy }),
        ...(data.completedAt != null && { completedAt: new Date(data.completedAt) }),
        ...(data.cost != null && { cost: data.cost }),
        ...(data.durationHours != null && { durationHours: data.durationHours }),
        ...(data.replacedParts != null && { replacedParts: data.replacedParts }),
        ...(data.notes != null && { notes: data.notes }),
    });

    // 교정(CALIBRATION) 완료 시 센서의 교정일 자동 갱신
    if (data.type === "CALIBRATION" && data.sensorId && data.completedAt) {
      const sensor = await this.prisma.sensor.findUnique({ where: { id: data.sensorId } });
      if (sensor?.calibrationIntervalDays) {
        const completedDate = new Date(data.completedAt);
        const nextDue = new Date(completedDate);
        nextDue.setDate(nextDue.getDate() + sensor.calibrationIntervalDays);
        await this.prisma.sensor.update({
          where: { id: data.sensorId },
          data: { lastCalibratedAt: completedDate, nextCalibrationDue: nextDue },
        });
      }
    }

    return record;
  }

  async update(id: string, data: Prisma.MaintenanceRecordUncheckedUpdateInput & { performedAt?: string | Date; completedAt?: string | Date }) {
    if (data.performedAt) data.performedAt = new Date(data.performedAt as string);
    if (data.completedAt) data.completedAt = new Date(data.completedAt as string);
    return this.repo.update(id, data as Prisma.MaintenanceRecordUncheckedUpdateInput);
  }

  async remove(id: string) {
    await this.repo.delete(id);
  }

  /** 예방 정비 예정 장비/센서 조회 (D-30 이내) */
  async getPreventiveDue(daysAhead = 30) {
    // 장비별 마지막 예방정비 날짜 + 메타데이터의 preventiveIntervalDays 체크
    const equipment = await this.prisma.equipment.findMany({
      where: { status: { not: "RETIRED" }, metadata: { not: { equals: null } } },
      include: { category: true },
    });

    const results: {
      id: string; name: string; type: string; category: string;
      lastPreventive: Date | null; intervalDays: number; nextDue: Date; daysUntilDue: number;
    }[] = [];

    for (const eq of equipment) {
      const meta = eq.metadata as any;
      const intervalDays = meta?.preventiveIntervalDays;
      if (!intervalDays) continue;

      const lastRecord = await this.prisma.maintenanceRecord.findFirst({
        where: { equipmentId: eq.id, type: "PREVENTIVE" },
        orderBy: { performedAt: "desc" },
      });

      const baseDate = lastRecord?.performedAt ?? eq.createdAt;
      const nextDue = new Date(baseDate);
      nextDue.setDate(nextDue.getDate() + intervalDays);
      const daysUntilDue = Math.ceil((nextDue.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

      if (daysUntilDue <= daysAhead) {
        results.push({
          id: eq.id,
          name: eq.name,
          type: "EQUIPMENT",
          category: (eq as any).category?.name ?? "",
          lastPreventive: lastRecord?.performedAt ?? null,
          intervalDays,
          nextDue,
          daysUntilDue,
        });
      }
    }

    return results.sort((a, b) => a.daysUntilDue - b.daysUntilDue);
  }
}
