import { PrismaClient, ContractStatus } from "@prisma/client";

export class ContractService {
  constructor(private prisma: PrismaClient) {}

  async list(params: { search?: string; status?: ContractStatus; page?: number; limit?: number; sortBy?: string; sortOrder?: "asc" | "desc" } = {}) {
    const { search, status, page = 1, limit = 100, sortBy, sortOrder = "asc" } = params;
    const where: any = {};

    if (search) {
      where.OR = [
        { contractNumber: { contains: search, mode: "insensitive" } },
        { name: { contains: search, mode: "insensitive" } },
        { client: { contains: search, mode: "insensitive" } },
        { manufacturer: { contains: search, mode: "insensitive" } },
        { manager: { contains: search, mode: "insensitive" } },
      ];
    }
    if (status) where.status = status;

    // v1.6 (2026-05-13)
    const SORTABLE: Record<string, any> = {
      contractNumber: { contractNumber: sortOrder },
      name: { name: sortOrder },
      client: { client: sortOrder },
      manufacturer: { manufacturer: sortOrder },
      status: { status: sortOrder },
      startDate: { startDate: sortOrder },
      endDate: { endDate: sortOrder },
    };
    const orderBy = sortBy && SORTABLE[sortBy] ? SORTABLE[sortBy] : { contractNumber: "asc" };

    const [items, total] = await Promise.all([
      this.prisma.contract.findMany({
        where,
        include: { _count: { select: { orders: true } } },
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.contract.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async getById(id: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id },
      include: {
        orders: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true, orderNumber: true, manufacturer: true, currency: true,
            status: true, totalAmount: true, totalAmountKRW: true, orderDate: true,
            _count: { select: { items: true } },
          },
        },
      },
    });
    if (!contract) throw new Error("계약을 찾을 수 없습니다.");
    return contract;
  }

  async create(data: {
    contractNumber?: string;
    name: string;
    client: string;
    clientContact?: string;
    manufacturer?: string;
    category?: string;
    contractType?: string;
    contractDate?: string;
    deadline?: string;
    manager?: string;
    status?: ContractStatus;
    notes?: string;
    createdBy?: string;
  }) {
    const { contractDate, deadline, ...rest } = data;
    const contractNumber = rest.contractNumber || await this.generateNextNumber();
    return this.prisma.contract.create({
      data: {
        ...rest,
        contractNumber,
        ...(contractDate && { contractDate: new Date(contractDate) }),
        ...(deadline && { deadline: new Date(deadline) }),
      },
    });
  }

  async update(id: string, data: {
    contractNumber?: string;
    name?: string;
    client?: string;
    clientContact?: string;
    manufacturer?: string;
    category?: string;
    contractType?: string;
    contractDate?: string;
    deadline?: string;
    manager?: string;
    status?: ContractStatus;
    notes?: string;
  }) {
    await this.getById(id);
    const { contractDate, deadline, ...rest } = data;
    return this.prisma.contract.update({
      where: { id },
      data: {
        ...rest,
        ...(contractDate !== undefined && { contractDate: contractDate ? new Date(contractDate) : null }),
        ...(deadline !== undefined && { deadline: deadline ? new Date(deadline) : null }),
      },
    });
  }

  async remove(id: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id },
      include: { _count: { select: { orders: true } } },
    });
    if (!contract) throw new Error("계약을 찾을 수 없습니다.");
    if (contract._count.orders > 0) {
      throw new Error("발주가 있어 삭제할 수 없습니다.");
    }
    return this.prisma.contract.delete({ where: { id } });
  }

  /** #YY-NN 형식의 다음 계약번호 생성 */
  async generateNextNumber(): Promise<string> {
    const yy = String(new Date().getFullYear()).slice(-2);
    const prefix = `#${yy}-`;

    const last = await this.prisma.contract.findFirst({
      where: { contractNumber: { startsWith: prefix } },
      orderBy: { contractNumber: "desc" },
    });

    let seq = 1;
    if (last) {
      const parts = last.contractNumber.split("-");
      seq = (parseInt(parts[1] ?? "0", 10) || 0) + 1;
    }
    return `${prefix}${String(seq).padStart(2, "0")}`;
  }
}
