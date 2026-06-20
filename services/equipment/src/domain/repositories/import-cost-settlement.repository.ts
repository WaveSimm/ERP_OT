import type { Prisma, ImportCostSettlement, CostRemittance } from "@prisma/client";

/** create 가 기존과 동일하게 자식들을 포함해 반환 (런타임 응답 shape 유지). */
export type SettlementWithChildren = Prisma.ImportCostSettlementGetPayload<{
  include: { remittances: true; duties: true; items: true };
}>;
/** updateContract 가 기존과 동일하게 contract 를 포함해 반환. */
export type SettlementWithContract = Prisma.ImportCostSettlementGetPayload<{
  include: { contract: { select: { contractNumber: true; name: true; client: true } } };
}>;

/**
 * ImportCostSettlement aggregate 영속성 인터페이스 (Clean Architecture — domain 계층).
 * 복잡 read(list/getById include)와 addExtra($transaction: costExtra + totalExtraCost 갱신)는
 * service 유지 — aggregate CRUD + remittance 자식만 repository.
 */
export interface IImportCostSettlementRepository {
  findById(id: string): Promise<ImportCostSettlement | null>;
  create(data: Prisma.ImportCostSettlementUncheckedCreateInput): Promise<SettlementWithChildren>;
  updateContract(id: string, contractId: string | null): Promise<SettlementWithContract>;
  delete(id: string): Promise<void>;
  // 자식: CostRemittance
  createRemittance(data: Prisma.CostRemittanceUncheckedCreateInput): Promise<CostRemittance>;
  deleteRemittance(remittanceId: string): Promise<void>;
}
