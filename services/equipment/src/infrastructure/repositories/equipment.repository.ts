import { PrismaClient, Prisma, Equipment, EquipmentComponent } from "@prisma/client";
import type { IEquipmentRepository, EquipmentWithCategory } from "../../domain/repositories/equipment.repository.js";

/** IEquipmentRepository 의 Prisma 구현 (infrastructure 계층). */
export class PrismaEquipmentRepository implements IEquipmentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string): Promise<Equipment | null> {
    return this.prisma.equipment.findUnique({ where: { id } });
  }

  create(data: Prisma.EquipmentUncheckedCreateInput): Promise<EquipmentWithCategory> {
    return this.prisma.equipment.create({ data, include: { category: true } });
  }

  update(id: string, data: Prisma.EquipmentUncheckedUpdateInput): Promise<EquipmentWithCategory> {
    return this.prisma.equipment.update({ where: { id }, data, include: { category: true } });
  }

  retire(id: string): Promise<Equipment> {
    return this.prisma.equipment.update({ where: { id }, data: { status: "RETIRED" } });
  }

  findComponentsByEquipment(equipmentId: string): Promise<EquipmentComponent[]> {
    return this.prisma.equipmentComponent.findMany({
      where: { equipmentId },
      orderBy: { sortOrder: "asc" },
    });
  }

  addComponent(data: Prisma.EquipmentComponentUncheckedCreateInput): Promise<EquipmentComponent> {
    return this.prisma.equipmentComponent.create({ data });
  }

  updateComponent(id: string, data: Prisma.EquipmentComponentUncheckedUpdateInput): Promise<EquipmentComponent> {
    return this.prisma.equipmentComponent.update({ where: { id }, data });
  }

  async deleteComponent(id: string): Promise<void> {
    await this.prisma.equipmentComponent.delete({ where: { id } });
  }
}
