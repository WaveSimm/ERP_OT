import { PrismaClient, InventoryTrackingMode, InventoryStatus, InventoryCategory, InventorySourceType, InventoryTransactionType } from "@prisma/client";

export class InventoryService {
  constructor(private prisma: PrismaClient) {}

  /** 재고번호 자동생성: E{5자리 시퀀스} */
  private async generateInventoryNo(): Promise<string> {
    const last = await this.prisma.inventoryItem.findFirst({ orderBy: { createdAt: "desc" } });
    let seq = 1;
    if (last) {
      const m = last.inventoryNo.match(/^E(\d+)/);
      if (m && m[1]) seq = parseInt(m[1], 10) + 1;
    }
    return `E${String(seq).padStart(5, "0")}`;
  }

  /** 재고 목록 (필터/페이징) */
  /** 필터 드롭다운용 고유값 목록 */
  async getFilterOptions() {
    const [locations, projects, assignees] = await Promise.all([
      this.prisma.inventoryItem.findMany({
        where: { currentLocation: { not: null } },
        select: { currentLocation: true },
        distinct: ["currentLocation"],
        orderBy: { currentLocation: "asc" },
      }),
      this.prisma.inventoryItem.findMany({
        where: { projectName: { not: null } },
        select: { projectName: true },
        distinct: ["projectName"],
        orderBy: { projectName: "asc" },
      }),
      this.prisma.inventoryItem.findMany({
        where: { assigneeName: { not: null } },
        select: { assigneeName: true },
        distinct: ["assigneeName"],
        orderBy: { assigneeName: "asc" },
      }),
    ]);
    return {
      locations: locations.map(l => l.currentLocation).filter(Boolean),
      projects: projects.map(p => p.projectName).filter(Boolean),
      assignees: assignees.map(a => a.assigneeName).filter(Boolean),
    };
  }

  /** 재고 목록 (필터/페이징) */
  async list(params: {
    category?: InventoryCategory;
    status?: InventoryStatus;
    location?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const { category, status, location, search, page = 1, limit = 50 } = params;
    const where: any = { AND: [] as any[] };
    if (category) where.AND.push({ category });
    if (status) where.AND.push({ currentStatus: status });
    if (location) {
      where.AND.push({
        OR: [
          { currentLocation: { contains: location, mode: "insensitive" } },
          { projectName: { contains: location, mode: "insensitive" } },
          { assigneeName: { contains: location, mode: "insensitive" } },
        ],
      });
    }
    if (search) {
      where.AND.push({
        OR: [
          { inventoryNo: { contains: search, mode: "insensitive" } },
          { serialNumber: { contains: search, mode: "insensitive" } },
          { itemName: { contains: search, mode: "insensitive" } },
          { productMaster: { name: { contains: search, mode: "insensitive" } } },
        ],
      });
    }
    if (where.AND.length === 0) delete where.AND;

    const [items, total] = await Promise.all([
      this.prisma.inventoryItem.findMany({
        where,
        include: { productMaster: { select: { name: true, modelName: true, manufacturer: true } } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.inventoryItem.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  /** 재고 상세 (트랜잭션 + 비용이력 포함) */
  async getById(id: string) {
    const item = await this.prisma.inventoryItem.findUnique({
      where: { id },
      include: {
        productMaster: true,
        orderItem: { include: { order: { select: { orderNumber: true } } } },
        transactions: { orderBy: { date: "desc" }, take: 50 },
        costEvents: { orderBy: { eventDate: "desc" } },
        auditItems: {
          include: { audit: { select: { id: true, name: true, plannedDate: true, status: true } } },
          orderBy: { audit: { plannedDate: "desc" } },
        },
      },
    });
    if (!item) throw new Error("재고를 찾을 수 없습니다.");

    // inventoryNo 기반으로 원가정산 연결 조회
    const costItem = await this.prisma.costItem.findFirst({
      where: { inventoryNo: item.inventoryNo },
      include: {
        settlement: {
          select: {
            id: true, declarationNo: true, supplier: true, declarationDate: true,
            contract: { select: { id: true, contractNumber: true, name: true, client: true } },
          },
        },
      },
    });

    return { ...item, costSettlement: costItem?.settlement ?? null };
  }

  /** 수동 재고 등록 */
  async create(data: {
    productMasterId?: string;
    itemName?: string;
    manufacturer?: string;
    serialNumber?: string;
    trackingMode?: InventoryTrackingMode;
    quantity?: number;
    category?: InventoryCategory;
    currentLocation?: string;
    unitPrice?: number;
    supplyAmount?: number;
    totalAmount?: number;
    sourceType?: InventorySourceType;
    sourceId?: string;
    projectName?: string;
    assigneeName?: string;
    notes?: string;
    createdBy: string;
  }) {
    const inventoryNo = await this.generateInventoryNo();

    return this.prisma.inventoryItem.create({
      data: {
        inventoryNo,
        productMasterId: data.productMasterId ?? null,
        itemName: data.itemName ?? null,
        manufacturer: data.manufacturer ?? null,
        serialNumber: data.serialNumber ?? null,
        trackingMode: data.trackingMode || "INDIVIDUAL",
        quantity: data.quantity || 1,
        category: data.category || "PRODUCT",
        currentLocation: data.currentLocation ?? null,
        currentStatus: "IN_STOCK",
        unitPrice: data.unitPrice ?? null,
        supplyAmount: data.supplyAmount ?? null,
        totalAmount: data.totalAmount ?? null,
        totalAdditionalCost: 0,
        totalCostOfOwnership: data.totalAmount || 0,
        sourceType: data.sourceType ?? null,
        sourceId: data.sourceId ?? null,
        projectName: data.projectName ?? null,
        assigneeName: data.assigneeName ?? null,
        notes: data.notes ?? null,
        createdBy: data.createdBy,
      },
      include: { productMaster: true },
    });
  }

  /** 발주 입고 → 재고 자동 생성 */
  async createFromReceipt(data: {
    orderItemId: string;
    serialNumber?: string;
    currentLocation?: string;
    createdBy: string;
  }) {
    const orderItem = await this.prisma.overseasOrderItem.findUnique({
      where: { id: data.orderItemId },
      include: { order: true },
    });
    if (!orderItem) throw new Error("발주 품목을 찾을 수 없습니다.");

    const inventoryNo = await this.generateInventoryNo();

    return this.prisma.$transaction(async (tx) => {
      const item = await tx.inventoryItem.create({
        data: {
          inventoryNo,
          productMasterId: orderItem.productMasterId,
          serialNumber: data.serialNumber ?? null,
          trackingMode: "INDIVIDUAL",
          quantity: 1,
          category: "IN_TRANSIT",
          currentLocation: data.currentLocation || "본사 창고",
          currentStatus: "IN_STOCK",
          unitPrice: orderItem.unitPrice,
          totalAmount: orderItem.amount,
          totalAdditionalCost: 0,
          totalCostOfOwnership: orderItem.amount,
          sourceType: "OVERSEAS_ORDER",
          sourceId: orderItem.orderId,
          orderItemId: orderItem.id,
          createdBy: data.createdBy,
        },
      });

      // 입고 트랜잭션 기록
      await tx.inventoryTransaction.create({
        data: {
          inventoryItemId: item.id,
          type: "PURCHASE",
          date: new Date(),
          quantity: 1,
          toLocation: data.currentLocation || "본사 창고",
          notes: `발주 ${orderItem.order.orderNumber} 입고`,
          createdBy: data.createdBy,
        },
      });

      return item;
    });
  }

  /** 재고 수정 */
  async update(id: string, data: {
    serialNumber?: string;
    category?: InventoryCategory;
    currentLocation?: string;
    currentStatus?: InventoryStatus;
    projectName?: string;
    assigneeName?: string;
    notes?: string;
  }) {
    return this.prisma.inventoryItem.update({
      where: { id },
      data: {
        ...(data.serialNumber !== undefined && { serialNumber: data.serialNumber }),
        ...(data.category && { category: data.category }),
        ...(data.currentLocation !== undefined && { currentLocation: data.currentLocation }),
        ...(data.currentStatus && { currentStatus: data.currentStatus }),
        ...(data.projectName !== undefined && { projectName: data.projectName }),
        ...(data.assigneeName !== undefined && { assigneeName: data.assigneeName }),
        ...(data.notes !== undefined && { notes: data.notes }),
      },
      include: { productMaster: true },
    });
  }

  /** 대시보드 통계 */
  async getStats() {
    const [total, byCategory, byStatus, recentTransactions] = await Promise.all([
      this.prisma.inventoryItem.count(),
      this.prisma.inventoryItem.groupBy({ by: ["category"], _count: true }),
      this.prisma.inventoryItem.groupBy({ by: ["currentStatus"], _count: true }),
      this.prisma.inventoryTransaction.findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
        include: { inventoryItem: { select: { inventoryNo: true } } },
      }),
    ]);

    return { total, byCategory, byStatus, recentTransactions };
  }
}
