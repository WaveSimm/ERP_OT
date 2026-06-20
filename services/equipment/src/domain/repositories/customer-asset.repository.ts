import type { Prisma, CustomerAsset } from "@prisma/client";

/**
 * CustomerAsset aggregate 영속성 인터페이스 (Clean Architecture — domain 계층).
 * 복잡 read(list/getById의 customer·_count·repairOrders include)와 remove 가드
 * (repairOrder count = cross-aggregate)는 service 유지 — aggregate-root CRUD만 repository.
 */
export interface ICustomerAssetRepository {
  findById(id: string): Promise<CustomerAsset | null>;
  create(data: Prisma.CustomerAssetUncheckedCreateInput): Promise<CustomerAsset>;
  update(id: string, data: Prisma.CustomerAssetUncheckedUpdateInput): Promise<CustomerAsset>;
  delete(id: string): Promise<void>;
}
