import type { Prisma, Part } from "@prisma/client";

/**
 * Part aggregate 영속성 인터페이스 (Clean Architecture — domain 계층).
 * aggregate root(Part) CRUD 담당. 복잡 read(list·getById·listTransactions)와
 * 재고 트랜잭션($transaction: partTransaction + 재고 갱신)은 도메인 로직이라 service 유지.
 */
export interface IPartRepository {
  findById(id: string): Promise<Part | null>;
  create(data: Prisma.PartUncheckedCreateInput): Promise<Part>;
  update(id: string, data: Prisma.PartUncheckedUpdateInput): Promise<Part>;
  delete(id: string): Promise<void>;
}
