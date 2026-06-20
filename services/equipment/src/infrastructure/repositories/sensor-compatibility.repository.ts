import { PrismaClient, Prisma, SensorCompatibility } from "@prisma/client";
import type { ISensorCompatibilityRepository } from "../../domain/repositories/sensor-compatibility.repository.js";

/** ISensorCompatibilityRepository 의 Prisma 구현 (infrastructure 계층). */
export class PrismaSensorCompatibilityRepository implements ISensorCompatibilityRepository {
  constructor(private readonly prisma: PrismaClient) {}

  create(data: Prisma.SensorCompatibilityUncheckedCreateInput): Promise<SensorCompatibility> {
    return this.prisma.sensorCompatibility.create({ data });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.sensorCompatibility.delete({ where: { id } });
  }
}
