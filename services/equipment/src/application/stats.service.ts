import { PrismaClient } from "@prisma/client";

export class StatsService {
  constructor(private prisma: PrismaClient) {}

  /** 장비 가동률: (운용일수 / 전체일수) per equipment */
  async utilization(startDate: string, endDate: string) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const totalDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));

    const equipment = await this.prisma.equipment.findMany({
      include: { category: true },
    });

    const schedules = await this.prisma.assetSchedule.findMany({
      where: {
        equipmentId: { not: null },
        type: "PROJECT",
        startDate: { lt: end },
        endDate: { gt: start },
      },
    });

    return equipment.map((eq) => {
      const eqSchedules = schedules.filter((s) => s.equipmentId === eq.id);
      let operatingDays = 0;
      for (const s of eqSchedules) {
        const sStart = s.startDate > start ? s.startDate : start;
        const sEnd = s.endDate < end ? s.endDate : end;
        operatingDays += Math.max(0, Math.ceil((sEnd.getTime() - sStart.getTime()) / (1000 * 60 * 60 * 24)));
      }
      return {
        id: eq.id,
        name: eq.name,
        category: eq.category?.name,
        status: eq.status,
        operatingDays,
        totalDays,
        utilizationRate: Math.round((operatingDays / totalDays) * 100),
      };
    });
  }

  /** 정비 비용 통계 (장비/센서별) */
  async maintenanceCosts(startDate?: string, endDate?: string) {
    const where: any = {};
    if (startDate) where.performedAt = { ...(where.performedAt ?? {}), gte: new Date(startDate) };
    if (endDate) where.performedAt = { ...(where.performedAt ?? {}), lte: new Date(endDate) };

    const records = await this.prisma.maintenanceRecord.findMany({
      where,
      include: {
        equipment: { select: { id: true, name: true } },
        sensor: { select: { id: true, name: true } },
      },
    });

    const byAsset: Record<string, { name: string; type: string; totalCost: number; count: number }> = {};

    for (const r of records) {
      const key = r.equipmentId ?? r.sensorId ?? "unknown";
      const name = r.equipment?.name ?? r.sensor?.name ?? "알 수 없음";
      const type = r.equipmentId ? "EQUIPMENT" : "SENSOR";
      if (!byAsset[key]) byAsset[key] = { name, type, totalCost: 0, count: 0 };
      byAsset[key].totalCost += Number(r.cost ?? 0);
      byAsset[key].count++;
    }

    return Object.entries(byAsset)
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.totalCost - a.totalCost);
  }

  /** 고장 빈도 Top-N */
  async breakdownFrequency(limit = 10) {
    const records = await this.prisma.maintenanceRecord.findMany({
      where: { type: "CORRECTIVE" },
      include: {
        equipment: { select: { id: true, name: true } },
        sensor: { select: { id: true, name: true } },
      },
    });

    const freq: Record<string, { name: string; type: string; count: number }> = {};
    for (const r of records) {
      const key = r.equipmentId ?? r.sensorId ?? "unknown";
      const name = r.equipment?.name ?? r.sensor?.name ?? "알 수 없음";
      const type = r.equipmentId ? "EQUIPMENT" : "SENSOR";
      if (!freq[key]) freq[key] = { name, type, count: 0 };
      freq[key].count++;
    }

    return Object.entries(freq)
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  /** 센서 교정 경고 (D-30 이내) */
  async calibrationWarnings() {
    const sensors = await this.prisma.sensor.findMany({
      where: {
        nextCalibrationDue: { not: null },
        status: { not: "RETIRED" },
      },
      include: { category: true },
    });

    const now = Date.now();
    return sensors
      .map((s) => {
        const daysRemaining = Math.ceil((s.nextCalibrationDue!.getTime() - now) / (1000 * 60 * 60 * 24));
        return {
          id: s.id,
          name: s.name,
          category: s.category?.name,
          status: s.status,
          nextCalibrationDue: s.nextCalibrationDue,
          daysRemaining,
          severity: daysRemaining <= 0 ? "EXPIRED" : daysRemaining <= 7 ? "URGENT" : daysRemaining <= 30 ? "WARNING" : "OK",
        };
      })
      .filter((s) => s.daysRemaining <= 30)
      .sort((a, b) => a.daysRemaining - b.daysRemaining);
  }

  /** 전체 요약 (대시보드 카드용) */
  async summary() {
    const [equipmentCount, sensorCount, activeDeployments, calibrationWarnings] = await Promise.all([
      this.prisma.equipment.groupBy({ by: ["status"], _count: true }),
      this.prisma.sensor.groupBy({ by: ["status"], _count: true }),
      this.prisma.deployment.count({ where: { status: "ACTIVE" } }),
      this.calibrationWarnings(),
    ]);

    return {
      equipment: equipmentCount.reduce((acc, g) => ({ ...acc, [g.status]: g._count }), {} as Record<string, number>),
      sensors: sensorCount.reduce((acc, g) => ({ ...acc, [g.status]: g._count }), {} as Record<string, number>),
      activeDeployments,
      calibrationWarnings: calibrationWarnings.length,
      urgentCalibrations: calibrationWarnings.filter((w) => w.severity === "EXPIRED" || w.severity === "URGENT").length,
    };
  }
}
