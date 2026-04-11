import { PrismaClient } from "@prisma/client";

export class ProductMasterService {
  constructor(private prisma: PrismaClient) {}

  async list(params: { search?: string; manufacturer?: string; page?: number; limit?: number } = {}) {
    const { search, manufacturer, page = 1, limit = 50 } = params;
    const where: any = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { modelName: { contains: search, mode: "insensitive" } },
        { manufacturer: { contains: search, mode: "insensitive" } },
      ];
    }
    if (manufacturer) {
      where.manufacturer = { contains: manufacturer, mode: "insensitive" };
    }

    const [items, total] = await Promise.all([
      this.prisma.productMaster.findMany({
        where,
        include: { _count: { select: { orderItems: true } } },
        orderBy: { name: "asc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.productMaster.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async getById(id: string) {
    const pm = await this.prisma.productMaster.findUnique({
      where: { id },
      include: {
        orderItems: {
          include: { order: { select: { id: true, orderNumber: true, status: true, manufacturer: true } } },
          orderBy: { createdAt: "desc" },
          take: 20,
        },
      },
    });
    if (!pm) throw new Error("장비 마스터를 찾을 수 없습니다.");
    return pm;
  }

  async create(data: {
    name: string;
    modelName: string;
    manufacturer: string;
    defaultCurrency?: string;
    referencePrice?: number;
    specs?: any;
  }) {
    return this.prisma.productMaster.create({ data: data as any });
  }

  async update(id: string, data: {
    name?: string;
    modelName?: string;
    manufacturer?: string;
    defaultCurrency?: string;
    referencePrice?: number;
    specs?: any;
  }) {
    await this.getById(id);
    return this.prisma.productMaster.update({ where: { id }, data: data as any });
  }

  async remove(id: string) {
    const pm = await this.prisma.productMaster.findUnique({
      where: { id },
      include: { _count: { select: { orderItems: true } } },
    });
    if (!pm) throw new Error("장비 마스터를 찾을 수 없습니다.");
    if (pm._count.orderItems > 0) {
      throw new Error("발주 품목이 있어 삭제할 수 없습니다.");
    }
    return this.prisma.productMaster.delete({ where: { id } });
  }

  async getManufacturers() {
    const result = await this.prisma.productMaster.findMany({
      select: { manufacturer: true },
      distinct: ["manufacturer"],
      orderBy: { manufacturer: "asc" },
    });
    return result.map((r) => r.manufacturer);
  }
}
