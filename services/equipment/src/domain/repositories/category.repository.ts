import type { Prisma, Category } from "@prisma/client";

/**
 * Category aggregate 영속성 인터페이스 (Clean Architecture — domain 계층).
 * 삭제 가드(사용 중 equipment/sensor count)는 cross-aggregate라 service에 유지.
 */
export interface ICategoryRepository {
  findMany(where?: Prisma.CategoryWhereInput): Promise<Category[]>;
  create(data: Prisma.CategoryUncheckedCreateInput): Promise<Category>;
  update(id: string, data: Prisma.CategoryUncheckedUpdateInput): Promise<Category>;
  delete(id: string): Promise<void>;
}
