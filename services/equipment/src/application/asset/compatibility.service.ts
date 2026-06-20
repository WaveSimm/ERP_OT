import { PrismaClient } from "@prisma/client";

export class CompatibilityService {
  constructor(private prisma: PrismaClient) {}

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
    return this.prisma.sensorCompatibility.create({ data });
  }

  async remove(id: string) {
    return this.prisma.sensorCompatibility.delete({ where: { id } });
  }
}
