import { PrismaClient, Prisma, Sensor } from "@prisma/client";
import type { ISensorRepository, SensorWithCategory } from "../../domain/repositories/sensor.repository.js";

/** ISensorRepository 의 Prisma 구현 (infrastructure 계층). */
export class PrismaSensorRepository implements ISensorRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string): Promise<Sensor | null> {
    return this.prisma.sensor.findUnique({ where: { id } });
  }

  create(data: Prisma.SensorUncheckedCreateInput): Promise<SensorWithCategory> {
    return this.prisma.sensor.create({ data, include: { category: true } });
  }

  update(id: string, data: Prisma.SensorUncheckedUpdateInput): Promise<SensorWithCategory> {
    return this.prisma.sensor.update({ where: { id }, data, include: { category: true } });
  }

  retire(id: string): Promise<Sensor> {
    return this.prisma.sensor.update({ where: { id }, data: { status: "RETIRED" } });
  }
}
