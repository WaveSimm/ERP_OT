import { PrismaClient } from "@prisma/client";

export class CustomerAssetService {
  constructor(private prisma: PrismaClient) {}

  async list(params: { customerId?: string; search?: string; page?: number; limit?: number } = {}) {
    const { customerId, search, page = 1, limit = 50 } = params;
    const where: any = {};
    if (customerId) where.customerId = customerId;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { serialNumber: { contains: search, mode: "insensitive" } },
        { manufacturer: { contains: search, mode: "insensitive" } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.customerAsset.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true } },
          _count: { select: { repairOrders: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.customerAsset.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async getById(id: string) {
    const asset = await this.prisma.customerAsset.findUnique({
      where: { id },
      include: {
        customer: true,
        repairOrders: {
          orderBy: { receivedAt: "desc" },
          take: 20,
        },
      },
    });
    if (!asset) throw new Error("고객 자산을 찾을 수 없습니다.");
    return asset;
  }

  async create(data: {
    customerId: string;
    assetType: string;
    name: string;
    serialNumber?: string;
    manufacturer?: string;
    model?: string;
    manufacturedAt?: string;
    soldAt?: string;
    warrantyExpiry?: string;
    otInventoryNo?: string;
    notes?: string;
  }) {
    const { soldAt, warrantyExpiry, ...rest } = data;
    const createData: any = { ...rest };
    if (soldAt) createData.soldAt = new Date(soldAt);
    if (warrantyExpiry) createData.warrantyExpiry = new Date(warrantyExpiry);
    return this.prisma.customerAsset.create({ data: createData });
  }

  async update(id: string, data: {
    assetType?: string;
    name?: string;
    serialNumber?: string;
    manufacturer?: string;
    model?: string;
    manufacturedAt?: string;
    soldAt?: string;
    warrantyExpiry?: string;
    otInventoryNo?: string;
    notes?: string;
  }) {
    const { soldAt, warrantyExpiry, ...rest } = data;
    const updateData: any = { ...rest };
    if (soldAt !== undefined) updateData.soldAt = soldAt ? new Date(soldAt) : null;
    if (warrantyExpiry !== undefined) updateData.warrantyExpiry = warrantyExpiry ? new Date(warrantyExpiry) : null;
    return this.prisma.customerAsset.update({ where: { id }, data: updateData });
  }

  async remove(id: string) {
    const orderCount = await this.prisma.repairOrder.count({ where: { customerAssetId: id } });
    if (orderCount > 0) {
      throw new Error("AS 이력이 있는 자산은 삭제할 수 없습니다.");
    }
    return this.prisma.customerAsset.delete({ where: { id } });
  }
}
