import type { Prisma, ProductMaster } from "@prisma/client";

/**
 * ProductMaster aggregate 영속성 인터페이스 (Clean Architecture — domain 계층).
 * 복잡 read(list의 stock groupBy·getById include·getManufacturers distinct·listBundleItems),
 * BOM 교체/번들 조립($transaction 사가), remove 가드(_count.orderItems)는 service 유지.
 */
export interface IProductMasterRepository {
  findById(id: string): Promise<ProductMaster | null>;
  create(data: Prisma.ProductMasterUncheckedCreateInput): Promise<ProductMaster>;
  update(id: string, data: Prisma.ProductMasterUncheckedUpdateInput): Promise<ProductMaster>;
  delete(id: string): Promise<void>;
}
