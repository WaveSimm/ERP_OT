import { PrismaClient } from "@prisma/client";
import type { ISensorCompatibilityRepository } from "../../domain/repositories/sensor-compatibility.repository.js";

export class CompatibilityService {
  // repo: SensorCompatibility 생성/삭제(Clean Arch). prisma: 목록(cross include).
  constructor(
    private readonly repo: ISensorCompatibilityRepository,
    private readonly prisma: PrismaClient,
  ) {}

  async listByEquipment(equipmentId: string) {
    return this.prisma.sensorCompatibility.findMany({
      where: { equipmentId },
      include: { sensor: { include: { category: true } } },
    });
  }

  async listBySensor(sensorId: string) {
    return this.prisma.sensorCompatibility.findMany({
      where: { sensorId },
      include: { equipment: { include: { category: true } } },
    });
  }

  async create(data: { equipmentId: string; sensorId: string; notes?: string }) {
    return this.repo.create(data);
  }

  async remove(id: string) {
    await this.repo.delete(id);
  }
}
