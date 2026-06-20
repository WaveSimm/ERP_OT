import { PrismaClient, Prisma } from "@prisma/client";
import type { ICustomerAssetRepository } from "../../domain/repositories/customer-asset.repository.js";

export class CustomerAssetService {
  // repo: CustomerAsset aggregate CRUD(Clean Arch). prisma: 복잡 read(list/getById include) + remove 가드.
  constructor(
    private readonly repo: ICustomerAssetRepository,
    private readonly prisma: PrismaClient,
  ) {}

  async list(params: { customerId?: string; search?: string; page?: number; limit?: number } = {}) {
    const { customerId, search, page = 1, limit = 50 } = params;
    const where: Prisma.CustomerAssetWhereInput = {};
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
    const createData: Prisma.CustomerAssetUncheckedCreateInput = { ...rest };
    if (soldAt) createData.soldAt = new Date(soldAt);
    if (warrantyExpiry) createData.warrantyExpiry = new Date(warrantyExpiry);
    return this.repo.create(createData);
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
    const updateData: Prisma.CustomerAssetUncheckedUpdateInput = { ...rest };
    if (soldAt !== undefined) updateData.soldAt = soldAt ? new Date(soldAt) : null;
    if (warrantyExpiry !== undefined) updateData.warrantyExpiry = warrantyExpiry ? new Date(warrantyExpiry) : null;
    return this.repo.update(id, updateData);
  }

  async remove(id: string) {
    const orderCount = await this.prisma.repairOrder.count({ where: { customerAssetId: id } });
    if (orderCount > 0) {
      throw new Error("AS 이력이 있는 자산은 삭제할 수 없습니다.");
    }
    await this.repo.delete(id);
  }
}
