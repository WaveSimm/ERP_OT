import type { Prisma, Contract } from "@prisma/client";

/**
 * Contract aggregate 영속성 인터페이스 (Clean Architecture — domain 계층).
 * 복잡 read(list/getById의 _count·orders include), 계약번호 생성(read), finalize 중복검사,
 * remove 가드(_count.orders)는 service 유지 — aggregate-root CRUD만 repository.
 */
export interface IContractRepository {
  findById(id: string): Promise<Contract | null>;
  create(data: Prisma.ContractUncheckedCreateInput): Promise<Contract>;
  update(id: string, data: Prisma.ContractUncheckedUpdateInput): Promise<Contract>;
  delete(id: string): Promise<void>;
}
