import { PrismaClient, AssetStatus } from "@prisma/client";

const VALID_TRANSITIONS: Record<string, AssetStatus[]> = {
  AVAILABLE: ["IN_OPERATION", "IN_MAINTENANCE", "BROKEN", "RETIRED"],
  IN_OPERATION: ["AVAILABLE", "IN_MAINTENANCE", "BROKEN", "RETIRED"],
  IN_MAINTENANCE: ["AVAILABLE", "BROKEN", "RETIRED"],
  BROKEN: ["IN_MAINTENANCE", "RETIRED"],
  RETIRED: [],
};

export class EquipmentService {
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
      this.prisma.equipment.findMany({
        where,
        include: { category: true },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.equipment.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async getById(id: string) {
    const equipment = await this.prisma.equipment.findUnique({
      where: { id },
      include: {
        category: true,
        components: { orderBy: { sortOrder: "asc" } },
        sensorCompatibility: { include: { sensor: { include: { category: true } } } },
      },
    });
    if (!equipment) throw new Error("장비를 찾을 수 없습니다.");
    return equipment;
  }

  async create(data: {
    categoryId: string; name: string; serialNumber: string;
    manufacturer?: string; model?: string; acquiredAt?: string;
    description?: string; imageUrl?: string; metadata?: any;
  }, userId: string) {
    return this.prisma.equipment.create({
      data: {
        categoryId: data.categoryId,
        name: data.name,
        serialNumber: data.serialNumber,
        createdBy: userId,
        ...(data.manufacturer != null && { manufacturer: data.manufacturer }),
        ...(data.model != null && { model: data.model }),
        ...(data.acquiredAt != null && { acquiredAt: new Date(data.acquiredAt) }),
        ...(data.description != null && { description: data.description }),
        ...(data.imageUrl != null && { imageUrl: data.imageUrl }),
        ...(data.metadata != null && { metadata: data.metadata }),
      },
      include: { category: true },
    });
  }

  async update(id: string, data: any) {
    if (data.acquiredAt) data.acquiredAt = new Date(data.acquiredAt);
    return this.prisma.equipment.update({
      where: { id },
      data,
      include: { category: true },
    });
  }

  async changeStatus(id: string, newStatus: AssetStatus) {
    const equipment = await this.prisma.equipment.findUnique({ where: { id } });
    if (!equipment) throw new Error("장비를 찾을 수 없습니다.");

    const allowed = VALID_TRANSITIONS[equipment.status] ?? [];
    if (!allowed.includes(newStatus)) {
      throw new Error(`${equipment.status} → ${newStatus} 상태 전이가 허용되지 않습니다.`);
    }

    return this.prisma.equipment.update({
      where: { id },
      data: { status: newStatus },
      include: { category: true },
    });
  }

  async remove(id: string) {
    return this.prisma.equipment.update({
      where: { id },
      data: { status: "RETIRED" },
    });
  }

  // ── 구성요소 CRUD ──

  async listComponents(equipmentId: string) {
    return this.prisma.equipmentComponent.findMany({
      where: { equipmentId },
      orderBy: { sortOrder: "asc" },
    });
  }

  async addComponent(equipmentId: string, data: { name: string; spec?: string; notes?: string; sortOrder?: number }) {
    return this.prisma.equipmentComponent.create({
      data: {
        equipmentId,
        name: data.name,
        ...(data.spec != null && { spec: data.spec }),
        ...(data.notes != null && { notes: data.notes }),
        ...(data.sortOrder != null && { sortOrder: data.sortOrder }),
      },
    });
  }

  async updateComponent(id: string, data: { name?: string; spec?: string; notes?: string; sortOrder?: number }) {
    return this.prisma.equipmentComponent.update({ where: { id }, data });
  }

  async removeComponent(id: string) {
    return this.prisma.equipmentComponent.delete({ where: { id } });
  }
}
