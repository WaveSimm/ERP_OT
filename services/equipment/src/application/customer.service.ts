import { PrismaClient } from "@prisma/client";

export class CustomerService {
  constructor(private prisma: PrismaClient) {}

  async list(params: { search?: string; page?: number; limit?: number } = {}) {
    const { search, page = 1, limit = 50 } = params;
    const where: any = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { contactPerson: { contains: search, mode: "insensitive" } },
        { phone: { contains: search } },
        { businessNo: { contains: search } },
        { contacts: { some: { name: { contains: search, mode: "insensitive" } } } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        include: {
          _count: { select: { assets: true, repairOrders: true, contacts: true } },
          contacts: { where: { isPrimary: true }, take: 1, select: { name: true, phone: true } },
        },
        orderBy: { name: "asc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.customer.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async getById(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        assets: { orderBy: { createdAt: "desc" } },
        contacts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
        repairOrders: {
          orderBy: { receivedAt: "desc" },
          take: 20,
          select: {
            id: true,
            orderNumber: true,
            orderType: true,
            status: true,
            techStatus: true,
            salesStatus: true,
            symptom: true,
            receivedAt: true,
            completedAt: true,
            customerAsset: { select: { name: true, serialNumber: true, manufacturer: true } },
          },
        },
      },
    });
    if (!customer) throw new Error("고객을 찾을 수 없습니다.");
    return customer;
  }

  async create(data: {
    name: string;
    businessNo?: string;
    contactPerson?: string;
    department?: string;
    phone?: string;
    email?: string;
    address?: string;
    address2?: string;
    notes?: string;
  }) {
    return this.prisma.customer.create({ data });
  }

  async update(id: string, data: {
    name?: string;
    businessNo?: string;
    contactPerson?: string;
    department?: string;
    phone?: string;
    email?: string;
    address?: string;
    address2?: string;
    notes?: string;
  }) {
    return this.prisma.customer.update({ where: { id }, data });
  }

  async remove(id: string) {
    const orderCount = await this.prisma.repairOrder.count({ where: { customerId: id } });
    if (orderCount > 0) {
      throw new Error("AS 이력이 있는 고객은 삭제할 수 없습니다.");
    }
    await this.prisma.customerAsset.deleteMany({ where: { customerId: id } });
    await this.prisma.customerContact.deleteMany({ where: { customerId: id } });
    return this.prisma.customer.delete({ where: { id } });
  }

  // ─── 담당자 CRUD ────────────────────────────────────────────────────

  async listContacts(customerId: string) {
    return this.prisma.customerContact.findMany({
      where: { customerId },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    });
  }

  async createContact(customerId: string, data: {
    name: string;
    department?: string;
    position?: string;
    phone?: string;
    email?: string;
    isPrimary?: boolean;
    notes?: string;
  }) {
    // 주담당자 설정 시 기존 주담당자 해제
    if (data.isPrimary) {
      await this.prisma.customerContact.updateMany({
        where: { customerId, isPrimary: true },
        data: { isPrimary: false },
      });
    }
    return this.prisma.customerContact.create({
      data: { customerId, ...data },
    });
  }

  async updateContact(contactId: string, data: {
    name?: string;
    department?: string;
    position?: string;
    phone?: string;
    email?: string;
    isPrimary?: boolean;
    notes?: string;
  }) {
    const contact = await this.prisma.customerContact.findUnique({ where: { id: contactId } });
    if (!contact) throw new Error("담당자를 찾을 수 없습니다.");
    if (data.isPrimary) {
      await this.prisma.customerContact.updateMany({
        where: { customerId: contact.customerId, isPrimary: true, id: { not: contactId } },
        data: { isPrimary: false },
      });
    }
    return this.prisma.customerContact.update({ where: { id: contactId }, data });
  }

  async removeContact(contactId: string) {
    return this.prisma.customerContact.delete({ where: { id: contactId } });
  }
}
