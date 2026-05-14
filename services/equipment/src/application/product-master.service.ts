import { PrismaClient, ProductItemType } from "@prisma/client";

type BomItemInput = {
  productMasterId: string;
  variantId?: string;
  quantity: number;
  slotType?: "MAIN" | "OPTIONAL";
  notes?: string;
};

export class ProductMasterService {
  constructor(private prisma: PrismaClient) {}

  async list(params: {
    search?: string;
    name?: string;
    modelName?: string;
    manufacturer?: string;
    itemType?: ProductItemType;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
  } = {}) {
    const { search, name, modelName, manufacturer, itemType, page = 1, limit = 50, sortBy, sortOrder = "asc" } = params;
    const where: any = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { modelName: { contains: search, mode: "insensitive" } },
        { manufacturer: { contains: search, mode: "insensitive" } },
      ];
    }
    if (name) {
      where.name = { contains: name, mode: "insensitive" };
    }
    if (modelName) {
      where.modelName = { contains: modelName, mode: "insensitive" };
    }
    if (manufacturer) {
      where.manufacturer = { contains: manufacturer, mode: "insensitive" };
    }
    if (itemType) {
      where.itemType = itemType;
    }

    // v1.6 (2026-05-13): 사용자 정렬 지원
    const SORTABLE: Record<string, any> = {
      name: { name: sortOrder },
      modelName: { modelName: sortOrder },
      manufacturer: { manufacturer: sortOrder },
      defaultCurrency: { defaultCurrency: sortOrder },
      referencePrice: { referencePrice: sortOrder },
      itemType: { itemType: sortOrder },
    };
    const orderBy = sortBy && SORTABLE[sortBy] ? SORTABLE[sortBy] : { name: "asc" };

    const [items, total] = await Promise.all([
      this.prisma.productMaster.findMany({
        where,
        include: {
          _count: { select: { orderItems: true, bundleItems: true, bundleShipments: true, variants: true } },
          variants: {
            where: { isActive: true },
            select: { id: true, skuCode: true, variantSpecs: true },
            orderBy: { createdAt: "asc" },
            take: 10,
          },
        },
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.productMaster.count({ where }),
    ]);

    // v1.6 (2026-05-13): 각 마스터의 IN_STOCK 보유 재고 요약
    //   검색 결과에서 사용자가 식별을 돕도록 재고 N건 / 위치 K개 표시
    const masterIds = items.map((m) => m.id);
    const stockGroups = masterIds.length > 0
      ? await this.prisma.inventoryItem.groupBy({
          by: ["productMasterId"],
          where: { productMasterId: { in: masterIds }, currentStatus: "IN_STOCK" },
          _count: { _all: true },
          _sum: { quantity: true },
        })
      : [];
    const stockMap = new Map<string, { items: number; quantity: number }>();
    for (const g of stockGroups) {
      if (g.productMasterId) {
        stockMap.set(g.productMasterId, {
          items: g._count._all ?? 0,
          quantity: Number(g._sum.quantity ?? 0),
        });
      }
    }
    const enriched = items.map((m) => ({
      ...m,
      stockSummary: stockMap.get(m.id) ?? { items: 0, quantity: 0 },
    }));

    return { items: enriched, total, page, limit };
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
        // v1.6 (2026-05-14): variants 포함 (발주 등록 시 SKU code 채움용)
        variants: {
          where: { isActive: true },
          select: { id: true, skuCode: true, variantSpecs: true },
          orderBy: { createdAt: "asc" },
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
    itemType?: ProductItemType;
    isActive?: boolean;
    masterCode?: string;
    keyAttributes?: any;
    unitOfMeasure?: string;
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
    itemType?: ProductItemType;
    isActive?: boolean;
    masterCode?: string;
    keyAttributes?: any;
    unitOfMeasure?: string;
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

  // ─── BUNDLE 전용: 구성품 (BomItem) 관리 (v1.6 B안, 2026-05-13) ───

  async listBundleItems(parentMasterId: string) {
    const master = await this.prisma.productMaster.findUnique({
      where: { id: parentMasterId },
      include: {
        bundleItems: {
          include: {
            productMaster: { select: { id: true, name: true, modelName: true, manufacturer: true } },
            variant: true,
          },
        },
      },
    });
    if (!master) throw new Error("장비 마스터를 찾을 수 없습니다.");
    if (master.itemType !== "BUNDLE") throw new Error("이 마스터는 번들이 아닙니다.");
    return master.bundleItems;
  }

  async replaceBundleItems(parentMasterId: string, items: BomItemInput[]) {
    const master = await this.prisma.productMaster.findUnique({ where: { id: parentMasterId } });
    if (!master) throw new Error("장비 마스터를 찾을 수 없습니다.");
    if (master.itemType !== "BUNDLE") throw new Error("이 마스터는 번들이 아닙니다.");
    if (items.length === 0) throw new Error("최소 1개 구성품 필요");

    return this.prisma.$transaction(async (tx) => {
      await tx.bomItem.deleteMany({ where: { parentMasterId } });
      await tx.bomItem.createMany({
        data: items.map((it) => ({
          parentMasterId,
          productMasterId: it.productMasterId,
          variantId: it.variantId ?? null,
          quantity: it.quantity,
          slotType: it.slotType ?? "MAIN",
          notes: it.notes ?? null,
        })),
      });
      return tx.productMaster.findUnique({
        where: { id: parentMasterId },
        include: { bundleItems: { include: { productMaster: true, variant: true } } },
      });
    });
  }

  /**
   * 번들 사전 조립 (v1.6 B안, 2026-05-13)
   *   구성품 재고 차감 + 번들 SKU로 새 InventoryItem 생성을 단일 트랜잭션으로 처리.
   *
   * 입력:
   *   parentMasterId: 번들 마스터 (itemType=BUNDLE)
   *   components: [{ inventoryItemId, locationId?, quantity }]
   *   output: { unitPrice?, locationId?, serialNumber?, notes?, quantity? (=1) }
   *
   * 동작:
   *   1. 각 구성품: InventoryItemLocation 차감 + totalQuantity 재계산 (0이면 RELEASED) + InventoryTransaction(ASSEMBLY)
   *   2. 새 InventoryItem 생성 (productMasterId=parentMasterId, inventoryNo=INV-YYMM-NNNN)
   *   3. output.locationId 있으면 InventoryItemLocation 1행 생성
   *   4. InventoryTransaction(ASSEMBLY) — 번들 입고 기록
   */
  async assembleBundle(
    parentMasterId: string,
    data: {
      components: Array<{ inventoryItemId: string; locationId?: string; quantity: number }>;
      output: {
        quantity?: number;
        unitPrice?: number;
        locationId?: string;
        serialNumber?: string;
        notes?: string;
      };
      createdBy: string;
    },
  ) {
    const master = await this.prisma.productMaster.findUnique({ where: { id: parentMasterId } });
    if (!master) throw new Error("장비 마스터를 찾을 수 없습니다.");
    if (master.itemType !== "BUNDLE") throw new Error("이 마스터는 번들이 아닙니다.");
    if (data.components.length === 0) throw new Error("최소 1개 구성품 필요");

    const outputQty = data.output.quantity ?? 1;
    const unitPrice = data.output.unitPrice ?? 0;
    const totalAmount = unitPrice * outputQty;

    return this.prisma.$transaction(async (tx) => {
      // 1) 구성품 재고 차감
      for (const c of data.components) {
        let item = await tx.inventoryItem.findUnique({
          where: { id: c.inventoryItemId },
          include: { locations: true },
        });
        if (!item) throw new Error(`구성품 재고 ${c.inventoryItemId} 없음`);
        if (item.currentStatus !== "IN_STOCK") {
          throw new Error(`구성품 ${item.inventoryNo}는 IN_STOCK 상태가 아님 (${item.currentStatus})`);
        }

        // v1.6 (2026-05-13) legacy fallback: location 행이 비어있고 currentLocation 텍스트만 있으면
        //   storage_locations.name 매칭해서 자동 inventory_item_locations 1행 백필
        if ((!item.locations || item.locations.length === 0) && item.currentLocation) {
          const sl = await tx.storageLocation.findFirst({
            where: { name: item.currentLocation },
            select: { id: true },
          });
          if (sl) {
            await tx.inventoryItemLocation.create({
              data: {
                inventoryItemId: item.id,
                locationId: sl.id,
                quantity: item.quantity,
              },
            });
            const refetched = await tx.inventoryItem.findUnique({
              where: { id: c.inventoryItemId },
              include: { locations: true },
            });
            if (refetched) item = refetched;
          }
        }

        // location 차감
        const targetLoc = c.locationId
          ? item.locations.find((l: any) => l.locationId === c.locationId)
          : item.locations[0];
        if (!targetLoc) {
          throw new Error(
            `구성품 ${item.inventoryNo}에 사용 가능 location 없음` +
            (item.currentLocation ? ` (legacy 위치 "${item.currentLocation}"가 storage_locations에 등록되지 않음)` : ""),
          );
        }
        if (targetLoc.quantity < c.quantity) {
          throw new Error(`구성품 ${item.inventoryNo} location 재고 부족 (보유 ${targetLoc.quantity}, 요청 ${c.quantity})`);
        }
        await tx.inventoryItemLocation.update({
          where: { id: targetLoc.id },
          data: { quantity: targetLoc.quantity - c.quantity },
        });

        // totalQuantity 재계산 + 상태 갱신
        const remaining = await tx.inventoryItemLocation.aggregate({
          where: { inventoryItemId: item.id },
          _sum: { quantity: true },
        });
        const totalQty = remaining._sum.quantity ?? 0;
        await tx.inventoryItem.update({
          where: { id: item.id },
          data: {
            quantity: totalQty,
            ...(totalQty === 0 && { currentStatus: "RELEASED" }),
          },
        });

        // ASSEMBLY 트랜잭션 기록 (구성품 차감)
        await tx.inventoryTransaction.create({
          data: {
            inventoryItemId: item.id,
            type: "ASSEMBLY",
            date: new Date(),
            quantity: c.quantity,
            fromLocation: targetLoc.locationId ?? null,
            notes: `번들 조립: ${master.name}`,
            createdBy: data.createdBy,
          },
        });
      }

      // 2) 번들 inventoryNo 발급
      const now = new Date();
      const yy = String(now.getFullYear()).slice(-2);
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const prefix = `INV-${yy}${mm}-`;
      const last = await tx.inventoryItem.findFirst({
        where: { inventoryNo: { startsWith: prefix } },
        orderBy: { inventoryNo: "desc" },
        select: { inventoryNo: true },
      });
      let seq = 1;
      if (last) {
        const m = last.inventoryNo.match(/^INV-\d{4}-(\d+)$/);
        if (m && m[1]) seq = parseInt(m[1], 10) + 1;
      }
      const inventoryNo = `${prefix}${String(seq).padStart(4, "0")}`;

      // 3) 번들 InventoryItem 생성
      const bundleItem = await tx.inventoryItem.create({
        data: {
          inventoryNo,
          productMasterId: parentMasterId,
          serialNumber: data.output.serialNumber ?? null,
          trackingMode: data.output.serialNumber ? "INDIVIDUAL" : "BULK",
          quantity: outputQty,
          category: "PRODUCT",
          currentStatus: "IN_STOCK",
          unitPrice: unitPrice || null,
          totalAmount: totalAmount || null,
          totalAdditionalCost: 0,
          totalCostOfOwnership: totalAmount,
          sourceType: null,
          notes: data.output.notes ?? `번들 조립 (${master.name})`,
          createdBy: data.createdBy,
        },
      });

      // 4) 번들 location 행
      if (data.output.locationId) {
        await tx.inventoryItemLocation.create({
          data: {
            inventoryItemId: bundleItem.id,
            locationId: data.output.locationId,
            quantity: outputQty,
          },
        });
      }

      // 5) 번들 입고 트랜잭션
      await tx.inventoryTransaction.create({
        data: {
          inventoryItemId: bundleItem.id,
          type: "ASSEMBLY",
          date: new Date(),
          quantity: outputQty,
          toLocation: data.output.locationId ?? null,
          notes: `번들 조립 완료: ${master.name}`,
          createdBy: data.createdBy,
        },
      });

      return bundleItem;
    });
  }
}
