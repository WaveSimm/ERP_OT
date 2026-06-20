import { PrismaClient, Prisma } from "@prisma/client";
import type { IProductVariantRepository } from "../../domain/repositories/product-variant.repository.js";

/**
 * ProductVariant — SKU (옵션 조합) 단위 (v1.6 신규, 2026-05-13)
 *
 * 핵심 규칙:
 * - sku_code = {master_code}-{핵심옵션1}-{핵심옵션2}[-{핵심옵션3}]
 * - variant_specs는 free-form jsonb (마스터별 key 자유)
 * - 같은 마스터 안에 동일 variant_specs는 UNIQUE (중복 방지)
 *
 * Plan v1.6 / Design v1.1 §19.1.2 참고
 */
export class ProductVariantService {
  // repo: ProductVariant aggregate CRUD(Clean Arch). prisma: 복잡 read(listByMaster·getById include·
  //   aggregate)·SKU생성·중복검사·merge($transaction)·remove 가드.
  constructor(
    private readonly repo: IProductVariantRepository,
    private readonly prisma: PrismaClient,
  ) {}

  /** ProductMaster 기준 Variant 목록 + 재고 합산 */
  async listByMaster(productMasterId: string, params: { includeInactive?: boolean } = {}) {
    const { includeInactive = false } = params;
    const where: Prisma.ProductVariantWhereInput = { productMasterId };
    if (!includeInactive) where.isActive = true;

    return this.prisma.productVariant.findMany({
      where,
      include: {
        _count: { select: { inventoryItems: true } },
      },
      orderBy: { createdAt: "asc" },
    });
  }

  /** Variant 단건 조회 (관련 inventory 합산 포함) */
  async getById(id: string) {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id },
      include: {
        productMaster: true,
        inventoryItems: {
          where: { currentStatus: "IN_STOCK" },
          select: { id: true, inventoryNo: true, quantity: true, unitPrice: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 20,
        },
      },
    });
    if (!variant) throw new Error("Variant를 찾을 수 없습니다.");

    // 가용 재고 합계
    const totalStock = await this.prisma.inventoryItem.aggregate({
      where: { variantId: id, currentStatus: "IN_STOCK" },
      _sum: { quantity: true },
    });

    return { ...variant, totalStockQuantity: totalStock._sum.quantity ?? 0 };
  }

  /**
   * SKU code 자동 생성 (v1.6 수정 2026-05-14):
   *   {prefix}-{핵심 옵션 값들 약어}
   *
   *   prefix 결정:
   *     - master.masterCode 있으면 그 값 사용
   *     - 없으면 master.name에서 영문/숫자만 추출 후 대문자 3~6자 fallback (v1.6.1: modelName 통합)
   *
   *   key 결정:
   *     - master.keyAttributes 있으면 그 순서대로 variantSpecs 값 사용
   *     - 없으면 variantSpecs의 모든 key를 정렬 순서로 사용 (최대 3개)
   *
   *   값이 하나도 없으면 시퀀스 ({prefix}-001) 사용.
   */
  private async generateSkuCode(productMasterId: string, variantSpecs: Record<string, unknown>): Promise<string | null> {
    const master = await this.prisma.productMaster.findUnique({ where: { id: productMasterId } });
    if (!master) return null;

    // prefix: masterCode 우선, 없으면 name fallback (v1.6.1: modelName 폐기, name 통합)
    let prefix = master.masterCode?.trim();
    if (!prefix) {
      const candidate = (master.name || "").toString();
      const cleaned = candidate.replace(/[^a-zA-Z0-9가-힣]/g, "").slice(0, 6).toUpperCase();
      prefix = cleaned || "VAR";
    }

    // key 결정: keyAttributes 우선, 없으면 variantSpecs의 모든 key (alphabetical)
    const declaredKeys = (master.keyAttributes as string[] | null) ?? [];
    const specKeys = Object.keys(variantSpecs).filter((k) => variantSpecs[k] != null && variantSpecs[k] !== "");
    const keysToUse = declaredKeys.length > 0
      ? declaredKeys.slice(0, 3)
      : specKeys.sort().slice(0, 3);

    const parts: string[] = [prefix];
    for (const attr of keysToUse) {
      const v = variantSpecs[attr];
      if (v == null || v === "") continue;
      const normalized = String(v).trim().replace(/\s+/g, "").toUpperCase();
      parts.push(normalized);
    }

    if (parts.length === 1) {
      // 핵심 옵션 없음 → 시퀀스 추가
      const existing = await this.prisma.productVariant.count({
        where: { productMasterId, skuCode: { startsWith: `${prefix}-` } },
      });
      parts.push(String(existing + 1).padStart(3, "0"));
    }

    return parts.join("-");
  }

  /** Variant 생성 — sku_code 자동 또는 사용자 지정 */
  async create(data: {
    productMasterId: string;
    skuCode?: string;
    variantSpecs?: Record<string, unknown>;
    isActive?: boolean;
  }) {
    const variantSpecs = data.variantSpecs ?? {};

    // SKU code 자동 생성 (사용자 미지정 시)
    let skuCode = data.skuCode?.trim();
    if (!skuCode) {
      skuCode = (await this.generateSkuCode(data.productMasterId, variantSpecs)) ?? undefined;
    }

    // 동일 (master, specs) 중복 체크
    const existing = await this.prisma.productVariant.findFirst({
      where: {
        productMasterId: data.productMasterId,
        variantSpecs: { equals: variantSpecs as Prisma.InputJsonValue },
      },
    });
    if (existing) {
      throw new Error(`이미 동일한 옵션의 Variant가 존재합니다 (id=${existing.id}, sku_code=${existing.skuCode ?? "—"}).`);
    }

    return this.repo.create({
      productMasterId: data.productMasterId,
      skuCode: skuCode ?? null,
      variantSpecs: variantSpecs as Prisma.InputJsonValue,
      isActive: data.isActive ?? true,
    });
  }

  /** Variant 수정 (specs 변경 시 SKU code 재발급 가능) */
  async update(id: string, data: {
    skuCode?: string | null;
    variantSpecs?: Record<string, unknown>;
    isActive?: boolean;
  }) {
    const existing = await this.repo.findById(id);
    if (!existing) throw new Error("Variant를 찾을 수 없습니다.");

    const updateData: Prisma.ProductVariantUncheckedUpdateInput = {};
    if (data.skuCode !== undefined) updateData.skuCode = data.skuCode;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    if (data.variantSpecs !== undefined) {
      // UNIQUE 충돌 사전 검증
      const dup = await this.prisma.productVariant.findFirst({
        where: {
          productMasterId: existing.productMasterId,
          variantSpecs: { equals: data.variantSpecs as Prisma.InputJsonValue },
          NOT: { id },
        },
      });
      if (dup) throw new Error(`동일 옵션 Variant 이미 존재 (id=${dup.id}).`);
      updateData.variantSpecs = data.variantSpecs as Prisma.InputJsonValue;
    }

    return this.repo.update(id, updateData);
  }

  /**
   * Variant 통합 (Merge) — ADMIN 전용
   *   idB의 참조를 모두 idA로 옮긴 뒤 idB 삭제
   *   - inventory_items.variant_id: B → A
   *   - bom_items.variant_id: B → A
   *   - bundle_shipment_items.variant_id: B → A
   *   - overseas_order_items.variant_id: B → A
   *   - purchase_order_items.variant_id: B → A
   *   - inbound_request_items.variant_id: B → A
   *   - 같은 마스터 강제
   */
  async merge(idA: string, idB: string) {
    if (idA === idB) throw new Error("같은 Variant 간 머지 불가");

    const [a, b] = await Promise.all([
      this.prisma.productVariant.findUnique({ where: { id: idA } }),
      this.prisma.productVariant.findUnique({ where: { id: idB } }),
    ]);
    if (!a || !b) throw new Error("Variant를 찾을 수 없습니다.");
    if (a.productMasterId !== b.productMasterId) {
      throw new Error("다른 마스터 Variant 간 머지 불가");
    }

    return this.prisma.$transaction(async (tx) => {
      // 참조 이동
      await tx.inventoryItem.updateMany({ where: { variantId: idB }, data: { variantId: idA } });
      await tx.bomItem.updateMany({ where: { variantId: idB }, data: { variantId: idA } });
      await tx.bundleShipmentItem.updateMany({ where: { variantId: idB }, data: { variantId: idA } });
      await tx.overseasOrderItem.updateMany({ where: { variantId: idB }, data: { variantId: idA } });
      await tx.purchaseOrderItem.updateMany({ where: { variantId: idB }, data: { variantId: idA } });
      await tx.inboundRequestItem.updateMany({ where: { variantId: idB }, data: { variantId: idA } });

      // B 삭제
      await tx.productVariant.delete({ where: { id: idB } });

      return tx.productVariant.findUniqueOrThrow({
        where: { id: idA },
        include: { productMaster: true, _count: { select: { inventoryItems: true } } },
      });
    });
  }

  /** Variant 삭제 — 참조 없을 때만 (ADMIN 전용, 운용 전 한정) */
  async remove(id: string) {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id },
      include: { _count: { select: { inventoryItems: true, bomItems: true } } },
    });
    if (!variant) throw new Error("Variant를 찾을 수 없습니다.");
    if (variant._count.inventoryItems > 0 || variant._count.bomItems > 0) {
      throw new Error("참조(inventory·BomItem)가 있는 Variant는 삭제 불가. merge 또는 isActive=false 사용");
    }
    await this.repo.delete(id);
  }
}
