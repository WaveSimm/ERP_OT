import { PrismaClient, Prisma } from "@prisma/client";
import type { ICustomerRepository } from "../../domain/repositories/customer.repository.js";

export class CustomerService {
  // repo: Customer aggregate(+contacts) CRUD(Clean Arch). prisma: 복잡 read(list/getById include·
  //   inventory batch) + remove 가드(repairOrder count).
  constructor(
    private readonly repo: ICustomerRepository,
    private readonly prisma: PrismaClient,
  ) {}

  async list(params: { search?: string; page?: number; limit?: number; sortBy?: string; sortOrder?: "asc" | "desc" } = {}) {
    const { search, page = 1, limit = 50, sortBy, sortOrder = "asc" } = params;
    const where: Prisma.CustomerWhereInput = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { contactPerson: { contains: search, mode: "insensitive" } },
        { phone: { contains: search } },
        { businessNo: { contains: search } },
        { contacts: { some: { name: { contains: search, mode: "insensitive" } } } },
      ];
    }

    // v1.6 (2026-05-13)
    const SORTABLE: Record<string, any> = {
      name: { name: sortOrder },
      contactPerson: { contactPerson: sortOrder },
      phone: { phone: sortOrder },
      createdAt: { createdAt: sortOrder },
    };
    const orderBy = sortBy && SORTABLE[sortBy] ? SORTABLE[sortBy] : { name: "asc" };

    const [items, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        include: {
          _count: { select: { assets: true, repairOrders: true, contacts: true } },
          contacts: { where: { isPrimary: true }, take: 1, select: { name: true, phone: true } },
        },
        orderBy,
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

    // 자산 → inventory_items batch lookup (otInventoryNo 매칭 → inventoryItemId 추가)
    const inventoryNos = customer.assets
      .map((a) => a.otInventoryNo)
      .filter((no): no is string => !!no && no !== "");
    let invMap = new Map<string, string>();
    if (inventoryNos.length > 0) {
      const items = await this.prisma.inventoryItem.findMany({
        where: { inventoryNo: { in: inventoryNos } },
        select: { id: true, inventoryNo: true },
      });
      invMap = new Map(items.map((i) => [i.inventoryNo, i.id]));
    }
    const assetsWithInv = customer.assets.map((a) => ({
      ...a,
      inventoryItemId: a.otInventoryNo ? invMap.get(a.otInventoryNo) ?? null : null,
    }));

    return { ...customer, assets: assetsWithInv };
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
    return this.repo.create(data);
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
    return this.repo.update(id, data);
  }

  async remove(id: string) {
    const orderCount = await this.prisma.repairOrder.count({ where: { customerId: id } });
    if (orderCount > 0) {
      throw new Error("AS 이력이 있는 고객은 삭제할 수 없습니다.");
    }
    await this.repo.deleteAssetsByCustomer(id);
    await this.repo.deleteContactsByCustomer(id);
    await this.repo.delete(id);
  }

  // ─── 담당자 CRUD ────────────────────────────────────────────────────

  async listContacts(customerId: string) {
    return this.repo.listContactsByCustomer(customerId);
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
      await this.repo.unsetPrimaryContacts(customerId);
    }
    return this.repo.createContact(customerId, data);
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
    const contact = await this.repo.findContactById(contactId);
    if (!contact) throw new Error("담당자를 찾을 수 없습니다.");
    if (data.isPrimary) {
      await this.repo.unsetPrimaryContacts(contact.customerId, contactId);
    }
    return this.repo.updateContact(contactId, data);
  }

  async removeContact(contactId: string) {
    await this.repo.deleteContact(contactId);
  }
}
