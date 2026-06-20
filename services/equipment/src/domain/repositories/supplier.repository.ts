import type { Prisma, Supplier, SupplierContact } from "@prisma/client";

/**
 * Supplier aggregate 영속성 인터페이스 (Clean Architecture — domain 계층).
 * aggregate root(Supplier) + 자식(SupplierContact) CRUD 담당.
 * 복잡 read(list 페이지네이션, getDetail의 cross-aggregate orders/contracts)는 service 유지.
 */
export interface ISupplierRepository {
  findById(id: string): Promise<Supplier | null>;
  findFirstByName(name: string): Promise<Pick<Supplier, "id" | "name"> | null>;
  create(data: Prisma.SupplierUncheckedCreateInput): Promise<Supplier>;
  update(id: string, data: Prisma.SupplierUncheckedUpdateInput): Promise<Supplier>;
  delete(id: string): Promise<void>;
  // 자식: SupplierContact
  addContact(supplierId: string, data: Omit<Prisma.SupplierContactUncheckedCreateInput, "supplierId">): Promise<SupplierContact>;
  updateContact(contactId: string, data: Prisma.SupplierContactUncheckedUpdateInput): Promise<SupplierContact>;
  deleteContact(contactId: string): Promise<void>;
}
