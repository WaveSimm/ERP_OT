import type { Prisma, Customer, CustomerContact } from "@prisma/client";

/**
 * Customer aggregate 영속성 인터페이스 (Clean Architecture — domain 계층).
 * aggregate root(Customer) + 자식(CustomerContact) CRUD. 복잡 read(list/getById의 include·
 * inventory batch lookup)와 remove 가드(repairOrder count)는 service 유지.
 */
export interface ICustomerRepository {
  findById(id: string): Promise<Customer | null>;
  create(data: Prisma.CustomerUncheckedCreateInput): Promise<Customer>;
  update(id: string, data: Prisma.CustomerUncheckedUpdateInput): Promise<Customer>;
  delete(id: string): Promise<void>;
  deleteAssetsByCustomer(customerId: string): Promise<void>;
  deleteContactsByCustomer(customerId: string): Promise<void>;
  // 자식: CustomerContact
  listContactsByCustomer(customerId: string): Promise<CustomerContact[]>;
  findContactById(contactId: string): Promise<CustomerContact | null>;
  createContact(customerId: string, data: Omit<Prisma.CustomerContactUncheckedCreateInput, "customerId">): Promise<CustomerContact>;
  updateContact(contactId: string, data: Prisma.CustomerContactUncheckedUpdateInput): Promise<CustomerContact>;
  deleteContact(contactId: string): Promise<void>;
  /** 주담당자 플래그 해제 (customerId 의 isPrimary=true 들을 false 로; excludeId 제외). */
  unsetPrimaryContacts(customerId: string, excludeId?: string): Promise<void>;
}
