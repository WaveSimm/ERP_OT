import { PrismaClient, AssetStatus } from "@prisma/client";

const VALID_TRANSITIONS: Record<string, AssetStatus[]> = {
  AVAILABLE: ["DEPLOYED", "IN_MAINTENANCE", "BROKEN", "RETIRED"],
  DEPLOYED: ["AVAILABLE", "BROKEN", "RETIRED"],
  IN_MAINTENANCE: ["AVAILABLE", "BROKEN", "RETIRED"],
  BROKEN: ["IN_MAINTENANCE", "RETIRED"],
  RETIRED: [],
  IN_OPERATION: ["AVAILABLE", "IN_MAINTENANCE", "BROKEN", "RETIRED"],
};

export class SensorService {
  constructor(private prisma: PrismaClient) {}

  async list(params: { categoryId?: string; status?: string; search?: string; page?: number; limit?: number }) {
    const { categoryId, status, search, page = 1, limit = 20 } = params;
    const where: any = {};
    if (categoryId) where.categoryId = categoryId;
    if (status) where.status = status as AssetStatus;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { serialNumber: { contains: search, mode: "insensitive" } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.sensor.findMany({
        where,
        include: { category: true },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.sensor.count({ where }),
    ]);

    // 교정 잔여일 계산
    const enriched = items.map((s) => ({
      ...s,
      calibrationDaysRemaining: s.nextCalibrationDue
        ? Math.ceil((s.nextCalibrationDue.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        : null,
    }));

    return { items: enriched, total, page, limit };
  }

  async listAvailable(categoryId?: string, startDate?: string, endDate?: string) {
    const where: any = {
      status: { in: ["AVAILABLE", "DEPLOYED"] as AssetStatus[] },
    };
    if (categoryId) where.categoryId = categoryId;

    const sensors = await this.prisma.sensor.findMany({
      where,
      include: { category: true },
      orderBy: { name: "asc" },
    });

    // 날짜가 지정되면 해당 기간에 일정 충돌이 없는 센서만 반환
    if (startDate) {
      const start = new Date(startDate);
      // endDate 없으면 startDate 다음날까지 (하루 단위)
      const end = endDate ? new Date(endDate) : new Date(start.getTime() + 24 * 60 * 60 * 1000);
      const sensorIds = sensors.map((s) => s.id);
      if (sensorIds.length === 0) return [];
      const conflicts = await this.prisma.assetSchedule.findMany({
        where: {
          sensorId: { in: sensorIds },
          startDate: { lte: end },
          endDate: { gte: start },
        },
        select: { sensorId: true },
      });
      const conflictIds = new Set(conflicts.map((c) => c.sensorId));
      return sensors.filter((s) => !conflictIds.has(s.id));
    }

    return sensors;
  }

  async getById(id: string) {
    const sensor = await this.prisma.sensor.findUnique({
      where: { id },
      include: {
        category: true,
        sensorCompatibility: { include: { equipment: { include: { category: true } } } },
      },
    });
    if (!sensor) throw new Error("센서를 찾을 수 없습니다.");

    return {
      ...sensor,
      calibrationDaysRemaining: sensor.nextCalibrationDue
        ? Math.ceil((sensor.nextCalibrationDue.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        : null,
    };
  }

  async create(data: {
    categoryId: string; name: string; serialNumber: string;
    manufacturer?: string; model?: string; acquiredAt?: string;
    description?: string; calibrationIntervalDays?: number;
    lastCalibratedAt?: string; metadata?: any;
  }, userId: string) {
    let nextCalibrationDue: Date | undefined;
    if (data.lastCalibratedAt && data.calibrationIntervalDays) {
      nextCalibrationDue = new Date(data.lastCalibratedAt);
      nextCalibrationDue.setDate(nextCalibrationDue.getDate() + data.calibrationIntervalDays);
    }

    return this.prisma.sensor.create({
      data: {
        categoryId: data.categoryId,
        name: data.name,
        serialNumber: data.serialNumber,
        createdBy: userId,
        ...(data.manufacturer != null && { manufacturer: data.manufacturer }),
        ...(data.model != null && { model: data.model }),
        ...(data.acquiredAt != null && { acquiredAt: new Date(data.acquiredAt) }),
        ...(data.description != null && { description: data.description }),
        ...(data.calibrationIntervalDays != null && { calibrationIntervalDays: data.calibrationIntervalDays }),
        ...(data.lastCalibratedAt != null && { lastCalibratedAt: new Date(data.lastCalibratedAt) }),
        ...(nextCalibrationDue != null && { nextCalibrationDue }),
        ...(data.metadata != null && { metadata: data.metadata }),
      },
      include: { category: true },
    });
  }

  async update(id: string, data: any) {
    if (data.acquiredAt) data.acquiredAt = new Date(data.acquiredAt);
    if (data.lastCalibratedAt) {
      data.lastCalibratedAt = new Date(data.lastCalibratedAt);
      const sensor = await this.prisma.sensor.findUnique({ where: { id } });
      const interval = data.calibrationIntervalDays ?? sensor?.calibrationIntervalDays;
      if (interval) {
        data.nextCalibrationDue = new Date(data.lastCalibratedAt);
        data.nextCalibrationDue.setDate(data.nextCalibrationDue.getDate() + interval);
      }
    }
    return this.prisma.sensor.update({
      where: { id },
      data,
      include: { category: true },
    });
  }

  async changeStatus(id: string, newStatus: AssetStatus) {
    const sensor = await this.prisma.sensor.findUnique({ where: { id } });
    if (!sensor) throw new Error("센서를 찾을 수 없습니다.");

    const allowed = VALID_TRANSITIONS[sensor.status] ?? [];
    if (!allowed.includes(newStatus)) {
      throw new Error(`${sensor.status} → ${newStatus} 상태 전이가 허용되지 않습니다.`);
    }

    const updateData: any = { status: newStatus };
    if (newStatus === "AVAILABLE") {
      updateData.currentEquipmentId = null;
      updateData.currentDeploymentId = null;
      updateData.currentLocation = "창고";
    }

    return this.prisma.sensor.update({ where: { id }, data: updateData, include: { category: true } });
  }

  async getDeploymentHistory(id: string) {
    return this.prisma.deploymentSensor.findMany({
      where: { sensorId: id },
      include: {
        deployment: { include: { equipment: { include: { category: true } } } },
      },
      orderBy: { checkedOutAt: "desc" },
    });
  }

  async remove(id: string) {
    return this.prisma.sensor.update({ where: { id }, data: { status: "RETIRED" } });
  }
}
