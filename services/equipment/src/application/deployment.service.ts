import { PrismaClient, DeploymentStatus } from "@prisma/client";

export class DeploymentService {
  constructor(private prisma: PrismaClient) {}

  async list(params: { projectId?: string; equipmentId?: string; sensorId?: string; status?: string; page?: number; limit?: number }) {
    const { projectId, equipmentId, sensorId, status, page = 1, limit = 20 } = params;
    const where: any = {};
    if (projectId) where.projectId = projectId;
    if (equipmentId) where.equipmentId = equipmentId;
    if (sensorId) where.sensors = { some: { sensorId } };
    if (status) where.status = status as DeploymentStatus;

    const [items, total] = await Promise.all([
      this.prisma.deployment.findMany({
        where,
        include: {
          equipment: { include: { category: true } },
          sensors: { include: { sensor: { include: { category: true } } } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.deployment.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async getById(id: string) {
    const deployment = await this.prisma.deployment.findUnique({
      where: { id },
      include: {
        equipment: { include: { category: true } },
        sensors: { include: { sensor: { include: { category: true } } } },
      },
    });
    if (!deployment) throw new Error("투입 구성을 찾을 수 없습니다.");
    return deployment;
  }

  async listByTask(taskId: string) {
    return this.prisma.deployment.findMany({
      where: { taskId },
      include: {
        equipment: { include: { category: true } },
        sensors: { include: { sensor: { include: { category: true } } } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async create(data: {
    equipmentId?: string; projectId: string; projectName: string;
    taskId?: string; taskName?: string;
    startDate: string; endDate?: string;
    sensors?: { sensorId: string; configParams?: any; notes?: string }[];
    configParams?: any; notes?: string;
  }, userId: string) {
    const sensors = data.sensors ?? [];

    const startDt = new Date(data.startDate);
    const endDt = data.endDate ? new Date(data.endDate) : new Date(data.startDate);

    // 1. 센서 가용 여부 확인 (AVAILABLE/DEPLOYED 허용, 일정 충돌만 검사)
    for (const s of sensors) {
      const sensor = await this.prisma.sensor.findUnique({ where: { id: s.sensorId } });
      if (!sensor) throw new Error(`센서 ${s.sensorId}를 찾을 수 없습니다.`);
      if (!["AVAILABLE", "DEPLOYED"].includes(sensor.status)) {
        throw new Error(`센서 ${sensor.name}은(는) 현재 ${sensor.status} 상태로 사용할 수 없습니다.`);
      }
    }

    // 2. 장비 일정 충돌 확인 (equipmentId 존재 시)
    let equipment: any = null;
    if (data.equipmentId) {
      equipment = await this.prisma.equipment.findUnique({ where: { id: data.equipmentId } });
      if (!equipment) throw new Error("장비를 찾을 수 없습니다.");

      const conflicts = await this.prisma.assetSchedule.findMany({
        where: {
          equipmentId: data.equipmentId,
          startDate: { lt: endDt },
          endDate: { gt: startDt },
        },
      });
      if (conflicts.length > 0) {
        const names = conflicts.map((c) => `${c.title} (${c.startDate.toLocaleDateString()}~${c.endDate.toLocaleDateString()})`);
        throw new Error(`장비 일정 충돌: ${names.join(", ")}`);
      }
    }

    // 3. 센서 일정 충돌 확인
    for (const s of sensors) {
      const sensorConflicts = await this.prisma.assetSchedule.findMany({
        where: {
          sensorId: s.sensorId,
          startDate: { lt: endDt },
          endDate: { gt: startDt },
        },
      });
      if (sensorConflicts.length > 0) {
        const sensor = await this.prisma.sensor.findUnique({ where: { id: s.sensorId } });
        const names = sensorConflicts.map((c) => `${c.title} (${c.startDate.toLocaleDateString()}~${c.endDate.toLocaleDateString()})`);
        throw new Error(`센서 ${sensor?.name} 일정 충돌: ${names.join(", ")}`);
      }
    }

    // 4. 트랜잭션으로 투입 구성 생성 + 센서 체크아웃

    return this.prisma.$transaction(async (tx) => {
      // Deployment 생성
      const deployment = await tx.deployment.create({
        data: {
          ...(data.equipmentId != null && { equipmentId: data.equipmentId }),
          projectId: data.projectId,
          projectName: data.projectName,
          ...(data.taskId != null && { taskId: data.taskId }),
          ...(data.taskName != null && { taskName: data.taskName }),
          startDate: startDt,
          ...(data.endDate != null && { endDate: endDt }),
          ...(data.configParams != null && { configParams: data.configParams }),
          ...(data.notes != null && { notes: data.notes }),
          createdBy: userId,
          ...(sensors.length > 0 && {
            sensors: {
              create: sensors.map((s) => ({
                sensorId: s.sensorId,
                ...(s.configParams != null && { configParams: s.configParams }),
                ...(s.notes != null && { notes: s.notes }),
              })),
            },
          }),
        },
        include: {
          equipment: { include: { category: true } },
          sensors: { include: { sensor: { include: { category: true } } } },
        },
      });

      // 센서 상태 업데이트 (AVAILABLE → DEPLOYED)
      for (const s of sensors) {
        const locationLabel = equipment
          ? `${equipment.name}에 장착 중 (${data.projectName})`
          : `${data.projectName} 투입 중`;
        await tx.sensor.update({
          where: { id: s.sensorId },
          data: {
            status: "DEPLOYED",
            ...(data.equipmentId != null && { currentEquipmentId: data.equipmentId }),
            currentDeploymentId: deployment.id,
            currentLocation: locationLabel,
          },
        });
      }

      // 장비 일정 생성 (equipmentId 존재 시)
      if (data.equipmentId) {
        await tx.assetSchedule.create({
          data: {
            equipmentId: data.equipmentId,
            type: "PROJECT",
            title: data.projectName,
            startDate: startDt,
            endDate: endDt,
            projectId: data.projectId,
            projectName: data.projectName,
            deploymentId: deployment.id,
            createdBy: userId,
          },
        });
      }

      // 센서별 일정 생성
      for (const s of sensors) {
        await tx.assetSchedule.create({
          data: {
            sensorId: s.sensorId,
            type: "PROJECT",
            title: data.projectName,
            startDate: startDt,
            endDate: endDt,
            projectId: data.projectId,
            projectName: data.projectName,
            deploymentId: deployment.id,
            createdBy: userId,
          },
        });
      }

      return deployment;
    });
  }

  async activate(id: string) {
    const deployment = await this.prisma.deployment.findUnique({
      where: { id },
      include: { sensors: true },
    });
    if (!deployment) throw new Error("투입 구성을 찾을 수 없습니다.");

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.deployment.update({
        where: { id },
        data: { status: "ACTIVE" },
        include: { equipment: true, sensors: { include: { sensor: { include: { category: true } } } } },
      });

      // 장비 상태 → IN_OPERATION (equipmentId 존재 시)
      if (deployment.equipmentId) {
        await tx.equipment.update({
          where: { id: deployment.equipmentId },
          data: { status: "IN_OPERATION" },
        });
      }

      return updated;
    });
  }

  async complete(id: string) {
    const deployment = await this.prisma.deployment.findUnique({
      where: { id },
      include: { sensors: true, equipment: true },
    });
    if (!deployment) throw new Error("투입 구성을 찾을 수 없습니다.");

    return this.prisma.$transaction(async (tx) => {
      // Deployment 완료
      const updated = await tx.deployment.update({
        where: { id },
        data: { status: "COMPLETED", endDate: new Date() },
        include: { equipment: true, sensors: { include: { sensor: { include: { category: true } } } } },
      });

      // 센서 반납
      for (const ds of deployment.sensors) {
        await tx.deploymentSensor.update({
          where: { id: ds.id },
          data: { returnedAt: new Date() },
        });
        await tx.sensor.update({
          where: { id: ds.sensorId },
          data: {
            status: "AVAILABLE",
            currentEquipmentId: null,
            currentDeploymentId: null,
            currentLocation: "창고",
          },
        });
      }

      // 일정 종료일 업데이트
      await tx.assetSchedule.updateMany({
        where: { deploymentId: id },
        data: { endDate: new Date() },
      });

      // 장비 상태 → AVAILABLE (다른 ACTIVE 투입이 없을 때만, equipmentId 존재 시)
      if (deployment.equipmentId) {
        const otherActive = await tx.deployment.count({
          where: { equipmentId: deployment.equipmentId, status: "ACTIVE", id: { not: id } },
        });
        if (otherActive === 0) {
          await tx.equipment.update({
            where: { id: deployment.equipmentId },
            data: { status: "AVAILABLE" },
          });
        }
      }

      return updated;
    });
  }

  async cancel(id: string) {
    const deployment = await this.prisma.deployment.findUnique({
      where: { id },
      include: { sensors: true },
    });
    if (!deployment) throw new Error("투입 구성을 찾을 수 없습니다.");

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.deployment.update({
        where: { id },
        data: { status: "CANCELLED" },
        include: { equipment: true, sensors: { include: { sensor: { include: { category: true } } } } },
      });

      for (const ds of deployment.sensors) {
        await tx.deploymentSensor.update({
          where: { id: ds.id },
          data: { returnedAt: new Date() },
        });
        await tx.sensor.update({
          where: { id: ds.sensorId },
          data: {
            status: "AVAILABLE",
            currentEquipmentId: null,
            currentDeploymentId: null,
            currentLocation: "창고",
          },
        });
      }

      // 일정 삭제
      await tx.assetSchedule.deleteMany({ where: { deploymentId: id } });

      // 장비 상태 → AVAILABLE (다른 ACTIVE 투입이 없을 때만, equipmentId 존재 시)
      if (deployment.equipmentId) {
        const otherActive = await tx.deployment.count({
          where: { equipmentId: deployment.equipmentId, status: "ACTIVE", id: { not: id } },
        });
        if (otherActive === 0) {
          await tx.equipment.update({
            where: { id: deployment.equipmentId },
            data: { status: "AVAILABLE" },
          });
        }
      }

      return updated;
    });
  }

  async remove(id: string) {
    const deployment = await this.prisma.deployment.findUnique({
      where: { id },
      include: { sensors: true },
    });
    if (!deployment) throw new Error("투입 구성을 찾을 수 없습니다.");

    return this.prisma.$transaction(async (tx) => {
      // 센서 복원
      for (const ds of deployment.sensors) {
        await tx.sensor.update({
          where: { id: ds.sensorId },
          data: {
            status: "AVAILABLE",
            currentEquipmentId: null,
            currentDeploymentId: null,
            currentLocation: "창고",
          },
        });
      }

      // 일정 삭제
      await tx.assetSchedule.deleteMany({ where: { deploymentId: id } });

      // 장비 상태 복원
      if (deployment.equipmentId) {
        const otherActive = await tx.deployment.count({
          where: { equipmentId: deployment.equipmentId, status: "ACTIVE", id: { not: id } },
        });
        if (otherActive === 0) {
          await tx.equipment.update({
            where: { id: deployment.equipmentId },
            data: { status: "AVAILABLE" },
          });
        }
      }

      // 센서 배정 레코드 삭제
      await tx.deploymentSensor.deleteMany({ where: { deploymentId: id } });

      // deployment 레코드 삭제
      await tx.deployment.delete({ where: { id } });
    });
  }
}
