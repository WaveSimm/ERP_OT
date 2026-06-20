import type { Prisma, Sensor } from "@prisma/client";

/** create/update 가 기존과 동일하게 category 를 포함해 반환 (런타임 응답 shape 유지). */
export type SensorWithCategory = Prisma.SensorGetPayload<{ include: { category: true } }>;

/**
 * Sensor aggregate 영속성 인터페이스 (Clean Architecture — domain 계층).
 * 복잡 read(list/listAvailable/getById의 include·교정계산, getDeploymentHistory cross-aggregate)와
 * 상태전이 FSM(changeStatus)은 service 유지 — aggregate-root CRUD만 repository.
 */
export interface ISensorRepository {
  findById(id: string): Promise<Sensor | null>;
  create(data: Prisma.SensorUncheckedCreateInput): Promise<SensorWithCategory>;
  update(id: string, data: Prisma.SensorUncheckedUpdateInput): Promise<SensorWithCategory>;
  retire(id: string): Promise<Sensor>;
}
