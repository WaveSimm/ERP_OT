import { PrismaClient } from "@prisma/client";

export class CategoryService {
  constructor(private prisma: PrismaClient) {}

  async list(type?: string) {
    const where: any = {};
    if (type) where.type = type;
    return this.prisma.category.findMany({ where, orderBy: { sortOrder: "asc" } });
  }

  async create(data: { name: string; type: string; description?: string; sortOrder?: number }) {
    return this.prisma.category.create({ data });
  }

  async update(id: string, data: { name?: string; description?: string; sortOrder?: number }) {
    return this.prisma.category.update({ where: { id }, data });
  }

  async remove(id: string) {
    const equipmentCount = await this.prisma.equipment.count({ where: { categoryId: id } });
    const sensorCount = await this.prisma.sensor.count({ where: { categoryId: id } });
    if (equipmentCount > 0 || sensorCount > 0) {
      throw new Error("해당 카테고리를 사용 중인 장비/센서가 있어 삭제할 수 없습니다.");
    }
    return this.prisma.category.delete({ where: { id } });
  }
}
