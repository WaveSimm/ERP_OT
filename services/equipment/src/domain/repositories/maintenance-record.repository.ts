import type { Prisma, MaintenanceRecord } from "@prisma/client";

/**
 * MaintenanceRecord aggregate 영속성 인터페이스 (Clean Architecture — domain 계층).
 * 복잡 read(listByEquipment/listBySensor 페이지네이션, getPreventiveDue cross-aggregate)와
 * 교정 완료 시 sensor 갱신(cross-aggregate)은 service 유지.
 */
export interface IMaintenanceRecordRepository {
  create(data: Prisma.MaintenanceRecordUncheckedCreateInput): Promise<MaintenanceRecord>;
  update(id: string, data: Prisma.MaintenanceRecordUncheckedUpdateInput): Promise<MaintenanceRecord>;
  delete(id: string): Promise<void>;
}
