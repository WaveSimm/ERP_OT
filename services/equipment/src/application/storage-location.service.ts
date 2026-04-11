import { PrismaClient, LocationType } from "@prisma/client";

export class StorageLocationService {
  constructor(private prisma: PrismaClient) {}

  async list(params: { type?: LocationType; search?: string; includeInactive?: boolean; page?: number; limit?: number } = {}) {
    const { type, search, includeInactive, page = 1, limit = 50 } = params;
    const where: any = {};
    if (!includeInactive) where.isActive = true;
    if (type) where.type = type;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.storageLocation.findMany({
        where,
        orderBy: [{ type: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.storageLocation.count({ where }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getById(id: string) {
    const loc = await this.prisma.storageLocation.findUnique({ where: { id } });
    if (!loc) throw new Error("위치를 찾을 수 없습니다.");
    return loc;
  }

  async create(data: { name: string; type: LocationType; description?: string; sortOrder?: number }) {
    return this.prisma.storageLocation.create({ data });
  }

  async update(id: string, data: { name?: string; type?: LocationType; description?: string; sortOrder?: number; isActive?: boolean }) {
    await this.getById(id);
    return this.prisma.storageLocation.update({ where: { id }, data });
  }

  async remove(id: string) {
    // 사용 중인 재고가 있는지 확인
    const count = await this.prisma.inventoryItem.count({
      where: { currentLocation: (await this.getById(id)).name },
    });
    if (count > 0) {
      throw new Error(`해당 위치에 재고 ${count}건이 있어 삭제할 수 없습니다. 비활성화를 사용하세요.`);
    }
    return this.prisma.storageLocation.delete({ where: { id } });
  }
}
