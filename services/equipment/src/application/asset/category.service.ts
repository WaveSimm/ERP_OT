import { PrismaClient } from "@prisma/client";
import type { ICategoryRepository } from "../../domain/repositories/category.repository.js";

export class CategoryService {
  // repo: Category aggregate 영속성(Clean Arch). prisma: 삭제 가드(cross-aggregate count).
  constructor(
    private readonly repo: ICategoryRepository,
    private readonly prisma: PrismaClient,
  ) {}

  async list(type?: string) {
    return this.repo.findMany(type ? { type } : undefined);
  }

  async create(data: { name: string; type: string; description?: string; sortOrder?: number }) {
    return this.repo.create(data);
  }

  async update(id: string, data: { name?: string; description?: string; sortOrder?: number }) {
    return this.repo.update(id, data);
  }

  async remove(id: string) {
    const equipmentCount = await this.prisma.equipment.count({ where: { categoryId: id } });
    const sensorCount = await this.prisma.sensor.count({ where: { categoryId: id } });
    if (equipmentCount > 0 || sensorCount > 0) {
      throw new Error("해당 카테고리를 사용 중인 장비/센서가 있어 삭제할 수 없습니다.");
    }
    await this.repo.delete(id);
  }
}
