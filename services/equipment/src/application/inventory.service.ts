import { PrismaClient, InventoryTrackingMode, InventoryStatus, InventoryCategory, InventorySourceType, InventoryTransactionType } from "@prisma/client";

export class InventoryService {
  constructor(private prisma: PrismaClient) {}

  /**
   * 재고번호 자동생성 (2026-05-13 룰 변경): INV-{YYMM}-{NNNN}
   *   ecount 마이그레이션 데이터 (E#####_#)와 명확히 구분.
   *   월별 시퀀스 reset.
   */
  private async generateInventoryNo(now: Date = new Date()): Promise<string> {
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const prefix = `INV-${yy}${mm}-`;

    const last = await this.prisma.inventoryItem.findFirst({
      where: { inventoryNo: { startsWith: prefix } },
      orderBy: { inventoryNo: "desc" },
      select: { inventoryNo: true },
    });
    let seq = 1;
    if (last) {
      const m = last.inventoryNo.match(/^INV-\d{4}-(\d+)$/);
      if (m && m[1]) seq = parseInt(m[1], 10) + 1;
    }
    return `${prefix}${String(seq).padStart(4, "0")}`;
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
    productMasterId?: string;   // v1.6 (2026-05-13): 번들 조립 등 마스터 단위 필터
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
  }) {
    const { category, status, location, search, productMasterId, page = 1, limit = 50, sortBy, sortOrder = "desc" } = params;
    const where: any = { AND: [] as any[] };
    if (category) where.AND.push({ category });
    if (status) where.AND.push({ currentStatus: status });
    if (productMasterId) where.AND.push({ productMasterId });
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

    // v1.6 (2026-05-13)
    const SORTABLE: Record<string, any> = {
      inventoryNo: { inventoryNo: sortOrder },
      itemName: { itemName: sortOrder },
      manufacturer: { manufacturer: sortOrder },
      serialNumber: { serialNumber: sortOrder },
      category: { category: sortOrder },
      currentStatus: { currentStatus: sortOrder },
      quantity: { quantity: sortOrder },
      currentLocation: { currentLocation: sortOrder },
      totalCostOfOwnership: { totalCostOfOwnership: sortOrder },
      createdAt: { createdAt: sortOrder },
    };
    const orderBy = sortBy && SORTABLE[sortBy] ? SORTABLE[sortBy] : { createdAt: "desc" };

    const [items, total] = await Promise.all([
      this.prisma.inventoryItem.findMany({
        where,
        include: { productMaster: { select: { name: true, manufacturer: true } } },
        orderBy,
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
        supplierRef: { select: { id: true, name: true } },
        orderItem: { include: { order: { select: { orderNumber: true } } } },
        transactions: { orderBy: { date: "desc" }, take: 50 },
        costEvents: { orderBy: { eventDate: "desc" } },
        auditItems: {
          include: { audit: { select: { id: true, name: true, plannedDate: true, status: true } } },
          orderBy: { audit: { plannedDate: "desc" } },
        },
        // v1.6 (2026-05-13): 위치별 분산 (1 inventory = N location)
        locations: { include: { location: { select: { id: true, name: true } } } },
      },
    });
    if (!item) throw new Error("재고를 찾을 수 없습니다.");

    // v1.6 (2026-05-13): locations 행이 없고 legacy currentLocation 텍스트만 있는 경우 fallback
    //   storage_locations.name 매칭 시도하여 응답에만 가상 location 객체 추가 (DB 변경 X)
    if ((!item.locations || item.locations.length === 0) && item.currentLocation) {
      const sl = await this.prisma.storageLocation.findFirst({
        where: { name: item.currentLocation },
        select: { id: true, name: true },
      });
      if (sl) {
        (item as any).locations = [{
          id: `virtual-${item.id}`,
          inventoryItemId: item.id,
          locationId: sl.id,
          quantity: item.quantity,
          location: sl,
          _virtual: true,
        }];
      }
    }

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

  /**
   * 수동 재고 등록 — v1.6 정정 (2026-05-13):
   *   머지 로직 제거. 모든 입고 = 새 inventory_no.
   *   InventoryItemLocation 1 row 동시 생성 (location_id 지정 시).
   *   같은 SKU 묶음은 검색 UI에서 자동 합산.
   */
  async create(data: {
    productMasterId?: string;
    variantId?: string;          // v1.6 신규
    itemName?: string;
    manufacturer?: string;
    serialNumber?: string;
    trackingMode?: InventoryTrackingMode;
    quantity?: number;
    category?: InventoryCategory;
    currentLocation?: string;    // 호환용 텍스트 (deprecated)
    locationId?: string;         // v1.6 신규 — FK
    unitPrice?: number;
    supplyAmount?: number;
    totalAmount?: number;
    sourceType?: InventorySourceType;
    sourceId?: string;
    supplierId?: string;
    inboundRequestId?: string;   // v1.6 신규
    projectName?: string;
    assigneeName?: string;
    notes?: string;
    createdBy: string;
  }) {
    const qty = data.quantity || 1;

    const inventoryNo = await this.generateInventoryNo();
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.inventoryItem.create({
        data: {
          inventoryNo,
          productMasterId: data.productMasterId ?? null,
          variantId: data.variantId ?? null,
          itemName: data.itemName ?? null,
          manufacturer: data.manufacturer ?? null,
          serialNumber: data.serialNumber ?? null,
          trackingMode: data.trackingMode || (data.serialNumber ? "INDIVIDUAL" : "BULK"),
          quantity: qty,
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
          supplierId: data.supplierId ?? null,
          inboundRequestId: data.inboundRequestId ?? null,
          projectName: data.projectName ?? null,
          assigneeName: data.assigneeName ?? null,
          notes: data.notes ?? null,
          createdBy: data.createdBy,
        },
        include: { productMaster: true, variant: true },
      });

      // location_id 지정 시 InventoryItemLocation 1 row 생성
      if (data.locationId) {
        await tx.inventoryItemLocation.create({
          data: {
            inventoryItemId: item.id,
            locationId: data.locationId,
            quantity: qty,
          },
        });
      }

      return item;
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

  /**
   * 재고 삭제 — ADMIN 한정, 운용 전 정리용 (2026-05-13).
   * 의존 이력(transactions, costEvents, auditItems)도 cascade 삭제.
   * 운용 도입 후엔 폐기/EXCLUDED 상태로 대체 예정.
   */
  async delete(id: string) {
    const existing = await this.prisma.inventoryItem.findUnique({
      where: { id },
      select: { id: true, inventoryNo: true },
    });
    if (!existing) throw new Error("재고를 찾을 수 없습니다.");

    return this.prisma.$transaction(async (tx) => {
      // 의존 이력 명시 삭제 (Prisma CASCADE이 없을 경우 대비)
      await tx.inventoryTransaction.deleteMany({ where: { inventoryItemId: id } });
      await tx.assetCostEvent.deleteMany({ where: { inventoryItemId: id } });
      await tx.inventoryAuditItem.deleteMany({ where: { inventoryItemId: id } });
      await tx.inventoryItemLocation.deleteMany({ where: { inventoryItemId: id } });
      return tx.inventoryItem.delete({ where: { id } });
    });
  }

  // ─────────────────────────────────────────────
  // v1.6 신규 (2026-05-13): InventoryItemLocation 기반 출고·이동·조회
  // ─────────────────────────────────────────────

  /** 재고 위치별 분산 조회 */
  async listLocations(inventoryItemId: string) {
    return this.prisma.inventoryItemLocation.findMany({
      where: { inventoryItemId },
      include: { location: { select: { id: true, name: true, type: true } } },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * 출고 (RELEASE) — 특정 위치에서 수량 차감.
   *   - InventoryItemLocation.quantity 감소
   *   - InventoryItem.quantity (totalQuantity) 동기 감소
   *   - InventoryTransaction.type = "OUT" 기록
   *   - totalQuantity = 0 되면 currentStatus = RELEASED 자동 (BULK-1 결정)
   */
  async release(inventoryItemId: string, data: {
    locationId: string;
    quantity: number;
    projectName?: string;
    assigneeName?: string;
    deliveryTo?: string;
    notes?: string;
    createdBy: string;
  }) {
    if (data.quantity <= 0) throw new Error("출고 수량은 1 이상이어야 합니다.");

    return this.prisma.$transaction(async (tx) => {
      const loc = await tx.inventoryItemLocation.findUnique({
        where: {
          inventoryItemId_locationId: {
            inventoryItemId,
            locationId: data.locationId,
          },
        },
        include: { location: { select: { name: true } } },
      });
      if (!loc) throw new Error("해당 위치에 재고가 없습니다.");
      if (loc.quantity < data.quantity) {
        throw new Error(`위치 재고 부족: 보유 ${loc.quantity}, 요청 ${data.quantity}`);
      }

      const item = await tx.inventoryItem.findUniqueOrThrow({ where: { id: inventoryItemId } });

      // 1) Location quantity 감소 (0 되면 row 삭제)
      const remainingAtLocation = loc.quantity - data.quantity;
      if (remainingAtLocation === 0) {
        await tx.inventoryItemLocation.delete({
          where: { inventoryItemId_locationId: { inventoryItemId, locationId: data.locationId } },
        });
      } else {
        await tx.inventoryItemLocation.update({
          where: { inventoryItemId_locationId: { inventoryItemId, locationId: data.locationId } },
          data: { quantity: remainingAtLocation },
        });
      }

      // 2) Item totalQuantity 감소 + status 변경
      const newTotal = item.quantity - data.quantity;
      const updated = await tx.inventoryItem.update({
        where: { id: inventoryItemId },
        data: {
          quantity: newTotal,
          ...(newTotal === 0 && { currentStatus: "RELEASED" }),  // BULK-1: 자동 RELEASED
        },
      });

      // 3) Transaction 기록
      await tx.inventoryTransaction.create({
        data: {
          inventoryItemId,
          type: "RELEASE",
          date: new Date(),
          quantity: data.quantity,
          fromLocation: loc.location.name,
          deliveryTo: data.deliveryTo ?? null,
          projectName: data.projectName ?? null,
          assigneeName: data.assigneeName ?? null,
          notes: data.notes ?? null,
          createdBy: data.createdBy,
        },
      });

      return updated;
    });
  }

  /**
   * 위치 간 이동 (TRANSFER) — inventoryNo 유지, 위치 row만 조정.
   *   - 같은 inventory의 InventoryItemLocation 두 row 수량 이동
   *   - InventoryTransaction.type = "TRANSFER" 기록
   */
  async transfer(inventoryItemId: string, data: {
    fromLocationId: string;
    toLocationId: string;
    quantity: number;
    notes?: string;
    createdBy: string;
  }) {
    if (data.quantity <= 0) throw new Error("이동 수량은 1 이상이어야 합니다.");
    if (data.fromLocationId === data.toLocationId) throw new Error("같은 위치로 이동 불가");

    return this.prisma.$transaction(async (tx) => {
      const fromLoc = await tx.inventoryItemLocation.findUnique({
        where: {
          inventoryItemId_locationId: { inventoryItemId, locationId: data.fromLocationId },
        },
        include: { location: { select: { name: true } } },
      });
      if (!fromLoc) throw new Error("출발 위치에 재고가 없습니다.");
      if (fromLoc.quantity < data.quantity) {
        throw new Error(`출발 위치 재고 부족: 보유 ${fromLoc.quantity}, 요청 ${data.quantity}`);
      }

      const toLocation = await tx.storageLocation.findUnique({
        where: { id: data.toLocationId },
        select: { name: true },
      });
      if (!toLocation) throw new Error("도착 위치를 찾을 수 없습니다.");

      // 1) From 감소 (0 되면 row 삭제)
      const fromRemaining = fromLoc.quantity - data.quantity;
      if (fromRemaining === 0) {
        await tx.inventoryItemLocation.delete({
          where: { inventoryItemId_locationId: { inventoryItemId, locationId: data.fromLocationId } },
        });
      } else {
        await tx.inventoryItemLocation.update({
          where: { inventoryItemId_locationId: { inventoryItemId, locationId: data.fromLocationId } },
          data: { quantity: fromRemaining },
        });
      }

      // 2) To 누적 (없으면 신규)
      await tx.inventoryItemLocation.upsert({
        where: { inventoryItemId_locationId: { inventoryItemId, locationId: data.toLocationId } },
        create: { inventoryItemId, locationId: data.toLocationId, quantity: data.quantity },
        update: { quantity: { increment: data.quantity } },
      });

      // 3) Transaction 기록 (TRANSFER) — totalQuantity는 그대로
      await tx.inventoryTransaction.create({
        data: {
          inventoryItemId,
          type: "TRANSFER",
          date: new Date(),
          quantity: data.quantity,
          fromLocation: fromLoc.location.name,
          toLocation: toLocation.name,
          notes: data.notes ?? null,
          createdBy: data.createdBy,
        },
      });

      return tx.inventoryItem.findUniqueOrThrow({
        where: { id: inventoryItemId },
        include: { locations: { include: { location: true } } },
      });
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
