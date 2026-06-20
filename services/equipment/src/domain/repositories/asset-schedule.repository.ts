import type { Prisma, AssetSchedule } from "@prisma/client";

/**
 * AssetSchedule aggregate 영속성 인터페이스 (Clean Architecture — domain 계층).
 * 복잡 read(listByEquipment/Sensor 날짜필터, getTimeline cross-aggregate, checkConflicts)는
 * service 유지 — aggregate-root CRUD만 repository.
 */
export interface IAssetScheduleRepository {
  findById(id: string): Promise<AssetSchedule | null>;
  create(data: Prisma.AssetScheduleUncheckedCreateInput): Promise<AssetSchedule>;
  update(id: string, data: Prisma.AssetScheduleUncheckedUpdateInput): Promise<AssetSchedule>;
  delete(id: string): Promise<void>;
}
