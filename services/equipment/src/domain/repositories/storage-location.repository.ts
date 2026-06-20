import type { Prisma, StorageLocation } from "@prisma/client";

/**
 * StorageLocation aggregate 영속성 인터페이스 (Clean Architecture — domain 계층).
 * 복잡 read(list: 페이지네이션·동적정렬)와 삭제 가드(inventoryItem count = cross-aggregate)는
 * service에 유지 — aggregate-root CRUD만 repository.
 */
export interface IStorageLocationRepository {
  findById(id: string): Promise<StorageLocation | null>;
  create(data: Prisma.StorageLocationUncheckedCreateInput): Promise<StorageLocation>;
  update(id: string, data: Prisma.StorageLocationUncheckedUpdateInput): Promise<StorageLocation>;
  delete(id: string): Promise<void>;
}
