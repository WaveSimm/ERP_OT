import { PrismaClient } from "@prisma/client";

export class PartService {
  constructor(private prisma: PrismaClient) {}

  async list(params: { search?: string; lowStock?: boolean; page?: number; limit?: number } = {}) {
    const { search, lowStock, page = 1, limit = 50 } = params;
    const where: any = {};

    if (search) {
      where.OR = [
        { partNumber: { contains: search, mode: "insensitive" } },
        { name: { contains: search, mode: "insensitive" } },
        { manufacturer: { contains: search, mode: "insensitive" } },
      ];
    }

    if (lowStock) {
      where.stockQuantity = { lte: this.prisma.part.fields?.minStockLevel ?? 0 };
      // Prisma doesn't support field comparison directly, use raw query approach
      // Instead, fetch all and filter in application layer for low stock
    }

    const [items, total] = await Promise.all([
      this.prisma.part.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.part.count({ where }),
    ]);

    const result = lowStock
      ? items.filter((p) => p.stockQuantity <= p.minStockLevel)
      : items;

    return { items: result, total: lowStock ? result.length : total, page, limit };
  }

  async getById(id: string) {
    const part = await this.prisma.part.findUnique({
      where: { id },
      include: {
        transactions: { orderBy: { performedAt: "desc" }, take: 20 },
        quoteItems: { include: { quote: { select: { repairOrderId: true, quoteNumber: true } } }, take: 10 },
      },
    });
    if (!part) throw new Error("부품을 찾을 수 없습니다.");
    return part;
  }

  async create(data: {
    partNumber: string;
    name: string;
    manufacturer?: string;
    category?: string;
    unitPrice?: number;
    currency?: string;
    stockQuantity?: number;
    minStockLevel?: number;
    leadTimeDays?: number;
    location?: string;
    compatibleAssets?: any;
    notes?: string;
  }) {
    return this.prisma.part.create({ data: data as any });
  }

  async update(id: string, data: {
    partNumber?: string;
    name?: string;
    manufacturer?: string;
    category?: string;
    unitPrice?: number;
    currency?: string;
    stockQuantity?: number;
    minStockLevel?: number;
    leadTimeDays?: number;
    location?: string;
    compatibleAssets?: any;
    notes?: string;
  }) {
    return this.prisma.part.update({ where: { id }, data: data as any });
  }

  async remove(id: string) {
    const txCount = await this.prisma.partTransaction.count({ where: { partId: id } });
    if (txCount > 0) throw new Error("입출고 이력이 있는 부품은 삭제할 수 없습니다.");
    return this.prisma.part.delete({ where: { id } });
  }

  // ─── 부품 입출고 ─────────────────────────────────────────────────────────

  async listTransactions(params: { partId?: string; repairOrderId?: string; page?: number; limit?: number } = {}) {
    const { partId, repairOrderId, page = 1, limit = 50 } = params;
    const where: any = {};
    if (partId) where.partId = partId;
    if (repairOrderId) where.repairOrderId = repairOrderId;

    const [items, total] = await Promise.all([
      this.prisma.partTransaction.findMany({
        where,
        include: { part: { select: { id: true, name: true, partNumber: true } } },
        orderBy: { performedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.partTransaction.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async createTransaction(data: {
    partId: string;
    type: string; // IN | OUT | ADJUST
    quantity: number;
    reason?: string;
    repairOrderId?: string;
    purchaseOrderId?: string;
    performedBy?: string;
  }) {
    const part = await this.prisma.part.findUnique({ where: { id: data.partId } });
    if (!part) throw new Error("부품을 찾을 수 없습니다.");

    let newStock = part.stockQuantity;
    if (data.type === "IN") newStock += data.quantity;
    else if (data.type === "OUT") newStock -= data.quantity;
    else newStock = data.quantity; // ADJUST = 직접 설정

    if (newStock < 0) throw new Error("재고가 부족합니다.");

    const [tx] = await this.prisma.$transaction([
      this.prisma.partTransaction.create({ data: data as any }),
      this.prisma.part.update({ where: { id: data.partId }, data: { stockQuantity: newStock } }),
    ]);

    return tx;
  }
}
