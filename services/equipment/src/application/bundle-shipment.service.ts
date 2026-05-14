import { PrismaClient } from "@prisma/client";

/**
 * BundleShipment — 번들 출고 인스턴스 (v1.6, 2026-05-13)
 *
 * 핵심 규칙:
 *  - INDIVIDUAL trackingMode SKU → CustomerAsset 생성 (직렬번호 추적)
 *  - BULK trackingMode SKU → CustomerAsset 미생성 (BundleShipmentItem만 기록)
 *  - Inventory 출고 처리: 지정된 InventoryItemLocation 차감 (release)
 *  - inventoryItemId.totalQuantity = 0 도달시 currentStatus = RELEASED
 *  - 가격: 사용자 직접 입력 (자동 합산 X)
 *  - 보증: 번들 단위 warrantyUntil (개별 자산 보증 X)
 *
 * 코드 형식: BD-YYYY-NNNN (연도 시퀀스, Plan v1.6 §4.6.6)
 *
 * Plan v1.6 §4.6.5~§4.6.8 / Design v1.1 §19.1.6, §19.2.3 참고
 */

type BomSlotType = "MAIN" | "OPTIONAL";

interface BundleItemInput {
  productMasterId: string;
  variantId?: string;
  quantity: number;
  slotType: BomSlotType;
  inventoryItemId?: string;       // 어느 재고에서 출고할지 (사용자 선택)
  locationId?: string;            // 특정 location에서 차감 (옵션)
  serialNumber?: string;          // INDIVIDUAL 자산 생성용 (재고에 있는 값 우선)
  customerAssetName?: string;     // 자산 표시명 override
}

export class BundleShipmentService {
  constructor(private prisma: PrismaClient) {}

  /** 번들 코드 자동 발급: BD-YYYY-NNNN (연도 시퀀스) */
  private async generateCode(now: Date = new Date()): Promise<string> {
    const yyyy = String(now.getFullYear());
    const prefix = `BD-${yyyy}-`;
    const last = await this.prisma.bundleShipment.findFirst({
      where: { code: { startsWith: prefix } },
      orderBy: { code: "desc" },
      select: { code: true },
    });
    let seq = 1;
    if (last) {
      const m = last.code.match(/^BD-\d{4}-(\d+)$/);
      if (m && m[1]) seq = parseInt(m[1], 10) + 1;
    }
    return `${prefix}${String(seq).padStart(4, "0")}`;
  }

  async list(params: { customerId?: string; from?: Date; to?: Date; page?: number; limit?: number; sortBy?: string; sortOrder?: "asc" | "desc" } = {}) {
    const { customerId, from, to, page = 1, limit = 50, sortBy, sortOrder = "desc" } = params;
    const where: any = {};
    if (customerId) where.customerId = customerId;
    if (from || to) {
      where.shippedAt = {};
      if (from) where.shippedAt.gte = from;
      if (to) where.shippedAt.lte = to;
    }
    // v1.6 (2026-05-13)
    const SORTABLE: Record<string, any> = {
      code: { code: sortOrder },
      customer: { customer: { name: sortOrder } },
      parentMaster: { parentMaster: { name: sortOrder } },
      shippedAt: { shippedAt: sortOrder },
      warrantyUntil: { warrantyUntil: sortOrder },
    };
    const orderBy = sortBy && SORTABLE[sortBy] ? SORTABLE[sortBy] : { shippedAt: "desc" };

    const [items, total] = await Promise.all([
      this.prisma.bundleShipment.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true } },
          parentMaster: { select: { id: true, masterCode: true, name: true, modelName: true } },
          _count: { select: { items: true, customerAssets: true } },
        },
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.bundleShipment.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async getById(id: string) {
    const bundle = await this.prisma.bundleShipment.findUnique({
      where: { id },
      include: {
        customer: true,
        parentMaster: { include: { bundleItems: { include: { productMaster: true, variant: true } } } },
        items: {
          include: {
            productMaster: true,
            variant: true,
            inventoryItem: { select: { id: true, inventoryNo: true, serialNumber: true } },
            customerAsset: { select: { id: true, name: true, serialNumber: true } },
          },
        },
        customerAssets: {
          select: { id: true, name: true, serialNumber: true, soldAt: true, warrantyExpiry: true },
          orderBy: { soldAt: "desc" },
        },
      },
    });
    if (!bundle) throw new Error("BundleShipment를 찾을 수 없습니다.");
    return bundle;
  }

  /**
   * 형제 자산 조회 (AS관리에서 사용)
   * 같은 BundleShipment의 다른 CustomerAsset 목록.
   * Plan v1.6 §4.6.9, Design v1.1 §19.2.3
   */
  async getSiblingAssets(bundleShipmentId: string) {
    const bundle = await this.prisma.bundleShipment.findUnique({
      where: { id: bundleShipmentId },
      include: {
        customer: { select: { id: true, name: true } },
        customerAssets: {
          select: {
            id: true,
            name: true,
            serialNumber: true,
            assetType: true,
            manufacturer: true,
            model: true,
            bundleRole: true,
            soldAt: true,
            warrantyExpiry: true,
            otInventoryNo: true,
          },
        },
      },
    });
    if (!bundle) throw new Error("BundleShipment를 찾을 수 없습니다.");
    return {
      bundleShipment: { id: bundle.id, code: bundle.code, shippedAt: bundle.shippedAt, customer: bundle.customer },
      siblings: bundle.customerAssets,
    };
  }

  /**
   * 번들 출고 처리 (v1.6 B안 사전 조립, 2026-05-13):
   *   사전 조립된 번들 재고(InventoryItem with productMaster.itemType=BUNDLE) 1건을 차감.
   *
   *   입력:
   *     inventoryItemId: 번들 재고 (필수)
   *     locationId?: 특정 위치 차감 (옵션, 미지정 시 첫 location)
   *     quantity?: 차감 수량 (기본 1)
   *
   *   동작:
   *     1. BundleShipment 생성
   *     2. InventoryItemLocation 차감 → totalQuantity 0이면 RELEASED
   *     3. InventoryTransaction(RELEASE) 기록
   *     4. INDIVIDUAL이면 CustomerAsset 1건 생성 (번들 자산)
   */
  async create(data: {
    parentMasterId?: string;
    customerId: string;
    projectId?: string;
    shippedAt: Date;
    shipTo?: string;
    warrantyUntil?: Date;
    totalPrice?: number;
    notes?: string;
    inventoryItemId: string;
    locationId?: string;
    quantity?: number;
    customerAssetName?: string;
    createdBy: string;
  }) {
    if (!data.inventoryItemId) throw new Error("번들 재고 (inventoryItemId)가 필요합니다.");
    const qty = data.quantity ?? 1;

    const customer = await this.prisma.customer.findUnique({ where: { id: data.customerId } });
    if (!customer) throw new Error("고객사를 찾을 수 없습니다.");

    let inv = await this.prisma.inventoryItem.findUnique({
      where: { id: data.inventoryItemId },
      include: { locations: true, productMaster: true },
    });
    if (!inv) throw new Error("번들 재고를 찾을 수 없습니다.");
    if (inv.currentStatus !== "IN_STOCK") throw new Error(`재고 ${inv.inventoryNo}는 IN_STOCK 상태가 아닙니다 (${inv.currentStatus}).`);
    if (inv.productMaster?.itemType !== "BUNDLE") {
      throw new Error(`재고 ${inv.inventoryNo}는 번들 마스터가 아닙니다. (단일 품목은 일반 출고를 사용하십시오)`);
    }

    // v1.6 (2026-05-13) legacy fallback: locations 비어있고 currentLocation 있으면 자동 백필
    if ((!inv.locations || inv.locations.length === 0) && inv.currentLocation) {
      const sl = await this.prisma.storageLocation.findFirst({
        where: { name: inv.currentLocation },
        select: { id: true },
      });
      if (sl) {
        await this.prisma.inventoryItemLocation.create({
          data: { inventoryItemId: inv.id, locationId: sl.id, quantity: inv.quantity },
        });
        const refetched = await this.prisma.inventoryItem.findUnique({
          where: { id: data.inventoryItemId },
          include: { locations: true, productMaster: true },
        });
        if (refetched) inv = refetched;
      }
    }

    const code = await this.generateCode();

    return this.prisma.$transaction(async (tx) => {
      // 1) BundleShipment 생성
      const bundle = await tx.bundleShipment.create({
        data: {
          code,
          parentMasterId: data.parentMasterId ?? inv.productMasterId,
          customerId: data.customerId,
          projectId: data.projectId ?? null,
          shippedAt: data.shippedAt,
          shipTo: data.shipTo ?? null,
          warrantyUntil: data.warrantyUntil ?? null,
          totalPrice: data.totalPrice ?? null,
          notes: data.notes ?? null,
        },
      });

      // 2) location 차감
      const targetLoc = data.locationId
        ? inv.locations.find((l: any) => l.locationId === data.locationId)
        : inv.locations[0];
      if (targetLoc) {
        if (targetLoc.quantity < qty) {
          throw new Error(`재고 부족 (보유 ${targetLoc.quantity}, 요청 ${qty})`);
        }
        await tx.inventoryItemLocation.update({
          where: { id: targetLoc.id },
          data: { quantity: targetLoc.quantity - qty },
        });
      } else if (inv.quantity < qty) {
        throw new Error(`재고 부족 (보유 ${inv.quantity}, 요청 ${qty})`);
      }

      // 3) totalQuantity 재계산 + 상태 갱신
      const remaining = await tx.inventoryItemLocation.aggregate({
        where: { inventoryItemId: inv.id },
        _sum: { quantity: true },
      });
      const totalQty = remaining._sum.quantity ?? Math.max(0, inv.quantity - qty);
      await tx.inventoryItem.update({
        where: { id: inv.id },
        data: {
          quantity: totalQty,
          ...(totalQty === 0 && { currentStatus: "RELEASED" }),
        },
      });

      // 4) RELEASE 트랜잭션
      await tx.inventoryTransaction.create({
        data: {
          inventoryItemId: inv.id,
          type: "RELEASE",
          date: data.shippedAt,
          quantity: qty,
          fromLocation: data.locationId ?? null,
          notes: `BundleShipment ${bundle.code} 출고`,
          projectName: data.shipTo ?? null,
          createdBy: data.createdBy,
        },
      });

      // 5) INDIVIDUAL이면 CustomerAsset 1건 생성
      let customerAssetId: string | null = null;
      if (inv.trackingMode === "INDIVIDUAL") {
        const asset = await tx.customerAsset.create({
          data: {
            customerId: data.customerId,
            assetType: inv.productMaster?.name ?? "번들",
            name: data.customerAssetName ?? inv.productMaster?.name ?? "",
            serialNumber: inv.serialNumber ?? null,
            manufacturer: inv.productMaster?.manufacturer ?? null,
            model: inv.productMaster?.modelName ?? null,
            soldAt: data.shippedAt,
            warrantyExpiry: data.warrantyUntil ?? null,
            otInventoryNo: inv.inventoryNo,
            bundleShipmentId: bundle.id,
            bundleRole: "MAIN",
          },
        });
        customerAssetId = asset.id;
      }

      // 6) BundleShipmentItem 기록 (호환성, 단일 출고 단위)
      await tx.bundleShipmentItem.create({
        data: {
          bundleShipmentId: bundle.id,
          productMasterId: inv.productMasterId!,
          variantId: inv.variantId ?? null,
          quantity: qty,
          slotType: "MAIN",
          inventoryItemId: inv.id,
          customerAssetId,
        },
      });

      return tx.bundleShipment.findUnique({
        where: { id: bundle.id },
        include: {
          items: { include: { productMaster: true, variant: true, inventoryItem: true, customerAsset: true } },
          customerAssets: true,
        },
      });
    });
  }

  /** 메타데이터 갱신 (warranty / notes / price 등). 출고 item 변경은 ADMIN 별도 처리 */
  async update(id: string, data: {
    shipTo?: string;
    warrantyUntil?: Date | null;
    totalPrice?: number | null;
    notes?: string | null;
  }) {
    return this.prisma.bundleShipment.update({
      where: { id },
      data: {
        ...(data.shipTo !== undefined && { shipTo: data.shipTo }),
        ...(data.warrantyUntil !== undefined && { warrantyUntil: data.warrantyUntil }),
        ...(data.totalPrice !== undefined && { totalPrice: data.totalPrice }),
        ...(data.notes !== undefined && { notes: data.notes }),
      },
    });
  }
}
