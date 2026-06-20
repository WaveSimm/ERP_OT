import { PrismaClient, Prisma, Supplier, SupplierContact } from "@prisma/client";
import type { ISupplierRepository } from "../../domain/repositories/supplier.repository.js";

/** ISupplierRepository 의 Prisma 구현 (infrastructure 계층). */
export class PrismaSupplierRepository implements ISupplierRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string): Promise<Supplier | null> {
    return this.prisma.supplier.findUnique({ where: { id } });
  }

  findFirstByName(name: string): Promise<Pick<Supplier, "id" | "name"> | null> {
    return this.prisma.supplier.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
      select: { id: true, name: true },
    });
  }

  create(data: Prisma.SupplierUncheckedCreateInput): Promise<Supplier> {
    return this.prisma.supplier.create({ data });
  }

  update(id: string, data: Prisma.SupplierUncheckedUpdateInput): Promise<Supplier> {
    return this.prisma.supplier.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.supplier.delete({ where: { id } });
  }

  addContact(
    supplierId: string,
    data: Omit<Prisma.SupplierContactUncheckedCreateInput, "supplierId">,
  ): Promise<SupplierContact> {
    return this.prisma.supplierContact.create({ data: { ...data, supplierId } });
  }

  updateContact(contactId: string, data: Prisma.SupplierContactUncheckedUpdateInput): Promise<SupplierContact> {
    return this.prisma.supplierContact.update({ where: { id: contactId }, data });
  }

  async deleteContact(contactId: string): Promise<void> {
    await this.prisma.supplierContact.delete({ where: { id: contactId } });
  }
}
