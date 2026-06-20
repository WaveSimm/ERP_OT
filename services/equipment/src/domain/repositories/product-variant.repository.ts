import type { Prisma, ProductVariant } from "@prisma/client";

/** create/update 가 기존과 동일하게 productMaster 를 포함해 반환 (런타임 응답 shape 유지). */
export type VariantWithMaster = Prisma.ProductVariantGetPayload<{ include: { productMaster: true } }>;

/**
 * ProductVariant aggregate 영속성 인터페이스 (Clean Architecture — domain 계층).
 * 복잡 read(listByMaster·getById include·aggregate), SKU 생성(read), 중복검사(findFirst),
 * merge($transaction 사가), remove 가드(_count)는 service 유지.
 */
export interface IProductVariantRepository {
  findById(id: string): Promise<ProductVariant | null>;
  create(data: Prisma.ProductVariantUncheckedCreateInput): Promise<VariantWithMaster>;
  update(id: string, data: Prisma.ProductVariantUncheckedUpdateInput): Promise<VariantWithMaster>;
  delete(id: string): Promise<void>;
}
