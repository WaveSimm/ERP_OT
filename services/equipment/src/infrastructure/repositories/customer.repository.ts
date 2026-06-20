import { PrismaClient, Prisma, Customer, CustomerContact } from "@prisma/client";
import type { ICustomerRepository } from "../../domain/repositories/customer.repository.js";

/** ICustomerRepository 의 Prisma 구현 (infrastructure 계층). */
export class PrismaCustomerRepository implements ICustomerRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string): Promise<Customer | null> {
    return this.prisma.customer.findUnique({ where: { id } });
  }

  create(data: Prisma.CustomerUncheckedCreateInput): Promise<Customer> {
    return this.prisma.customer.create({ data });
  }

  update(id: string, data: Prisma.CustomerUncheckedUpdateInput): Promise<Customer> {
    return this.prisma.customer.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.customer.delete({ where: { id } });
  }

  async deleteAssetsByCustomer(customerId: string): Promise<void> {
    await this.prisma.customerAsset.deleteMany({ where: { customerId } });
  }

  async deleteContactsByCustomer(customerId: string): Promise<void> {
    await this.prisma.customerContact.deleteMany({ where: { customerId } });
  }

  listContactsByCustomer(customerId: string): Promise<CustomerContact[]> {
    return this.prisma.customerContact.findMany({
      where: { customerId },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    });
  }

  findContactById(contactId: string): Promise<CustomerContact | null> {
    return this.prisma.customerContact.findUnique({ where: { id: contactId } });
  }

  createContact(customerId: string, data: Omit<Prisma.CustomerContactUncheckedCreateInput, "customerId">): Promise<CustomerContact> {
    return this.prisma.customerContact.create({ data: { ...data, customerId } });
  }

  updateContact(contactId: string, data: Prisma.CustomerContactUncheckedUpdateInput): Promise<CustomerContact> {
    return this.prisma.customerContact.update({ where: { id: contactId }, data });
  }

  async deleteContact(contactId: string): Promise<void> {
    await this.prisma.customerContact.delete({ where: { id: contactId } });
  }

  async unsetPrimaryContacts(customerId: string, excludeId?: string): Promise<void> {
    await this.prisma.customerContact.updateMany({
      where: { customerId, isPrimary: true, ...(excludeId ? { id: { not: excludeId } } : {}) },
      data: { isPrimary: false },
    });
  }
}
