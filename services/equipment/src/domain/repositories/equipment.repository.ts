import type { Prisma, Equipment, EquipmentComponent } from "@prisma/client";

/** create/update 가 기존과 동일하게 category 를 포함해 반환 (런타임 응답 shape 유지). */
export type EquipmentWithCategory = Prisma.EquipmentGetPayload<{ include: { category: true } }>;

/**
 * Equipment aggregate 영속성 인터페이스 (Clean Architecture — domain 계층).
 * aggregate root(Equipment) + 자식(EquipmentComponent). 복잡 read(list/getById의 다중 include)와
 * 상태전이 FSM(changeStatus)은 service 유지.
 */
export interface IEquipmentRepository {
  findById(id: string): Promise<Equipment | null>;
  create(data: Prisma.EquipmentUncheckedCreateInput): Promise<EquipmentWithCategory>;
  update(id: string, data: Prisma.EquipmentUncheckedUpdateInput): Promise<EquipmentWithCategory>;
  retire(id: string): Promise<Equipment>;
  // 자식: EquipmentComponent
  findComponentsByEquipment(equipmentId: string): Promise<EquipmentComponent[]>;
  addComponent(data: Prisma.EquipmentComponentUncheckedCreateInput): Promise<EquipmentComponent>;
  updateComponent(id: string, data: Prisma.EquipmentComponentUncheckedUpdateInput): Promise<EquipmentComponent>;
  deleteComponent(id: string): Promise<void>;
}
