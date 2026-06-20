import type { Prisma, SensorCompatibility } from "@prisma/client";

/**
 * SensorCompatibility aggregate 영속성 인터페이스 (Clean Architecture — domain 계층).
 * 목록(listByEquipment/listBySensor의 cross include)은 service 유지, 생성/삭제만 repository.
 */
export interface ISensorCompatibilityRepository {
  create(data: Prisma.SensorCompatibilityUncheckedCreateInput): Promise<SensorCompatibility>;
  delete(id: string): Promise<void>;
}
