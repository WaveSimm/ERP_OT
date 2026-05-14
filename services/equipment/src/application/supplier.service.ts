import { PrismaClient } from "@prisma/client";

export class SupplierService {
  constructor(private prisma: PrismaClient) {}

  async list(params: { search?: string; page?: number; limit?: number; sortBy?: string; sortOrder?: "asc" | "desc" } = {}) {
    const { search, page = 1, limit = 100, sortBy, sortOrder = "asc" } = params;
    const where: any = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { country: { contains: search, mode: "insensitive" } },
        { contactName: { contains: search, mode: "insensitive" } },
      ];
    }
    // v1.6 (2026-05-13)
    const SORTABLE: Record<string, any> = {
      name: { name: sortOrder },
      country: { country: sortOrder },
      contactName: { contactName: sortOrder },
      createdAt: { createdAt: sortOrder },
    };
    const orderBy = sortBy && SORTABLE[sortBy] ? SORTABLE[sortBy] : { name: "asc" };

    const [items, total] = await Promise.all([
      this.prisma.supplier.findMany({
        where, orderBy,
        skip: (page - 1) * limit, take: limit,
      }),
      this.prisma.supplier.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async getById(id: string) {
    const s = await this.prisma.supplier.findUnique({ where: { id } });
    if (!s) throw new Error("제조사를 찾을 수 없습니다.");
    return s;
  }

  async getDetail(id: string) {
    const s = await this.prisma.supplier.findUnique({
      where: { id },
      include: { contacts: { orderBy: { createdAt: "asc" } } },
    });
    if (!s) throw new Error("제조사를 찾을 수 없습니다.");
    const [orders, contracts] = await Promise.all([
      this.prisma.overseasOrder.findMany({
        where: { manufacturer: { equals: s.name, mode: "insensitive" } },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true, orderNumber: true, status: true, currency: true,
          totalAmount: true, orderDate: true, orderType: true,
          contract: { select: { id: true, contractNumber: true, name: true } },
        },
      }),
      this.prisma.contract.findMany({
        where: { OR: [
          { name: { contains: s.name, mode: "insensitive" } },
          { client: { contains: s.name, mode: "insensitive" } },
        ]},
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, contractNumber: true, name: true, status: true, client: true },
      }),
    ]);
    return { ...s, orders, contracts };
  }

  async findByName(name: string) {
    return this.prisma.supplier.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
      select: { id: true, name: true },
    });
  }

  async create(data: { name: string; country?: string; contactName?: string; phone?: string; email?: string; website?: string; notes?: string }) {
    return this.prisma.supplier.create({ data });
  }

  async update(id: string, data: Partial<{ name: string; country: string; contactName: string; phone: string; email: string; website: string; notes: string }>) {
    await this.getById(id);
    return this.prisma.supplier.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.getById(id);
    return this.prisma.supplier.delete({ where: { id } });
  }

  // ─── Contacts ──────────────────────────────────────────────────────────────

  async addContact(supplierId: string, data: { name: string; position?: string; phone?: string; email?: string; notes?: string }) {
    await this.getById(supplierId);
    return this.prisma.supplierContact.create({ data: { ...data, supplierId } });
  }

  async updateContact(contactId: string, data: Partial<{ name: string; position: string; phone: string; email: string; notes: string }>) {
    return this.prisma.supplierContact.update({ where: { id: contactId }, data });
  }

  async removeContact(contactId: string) {
    return this.prisma.supplierContact.delete({ where: { id: contactId } });
  }
}
