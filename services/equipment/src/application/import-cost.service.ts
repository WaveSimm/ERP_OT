import { PrismaClient } from "@prisma/client";

export class ImportCostService {
  constructor(private prisma: PrismaClient) {}

  /** 원가정산 목록 */
  async list() {
    return this.prisma.importCostSettlement.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        order: { select: { orderNumber: true, currency: true } },
        contract: { select: { contractNumber: true, name: true, client: true } },
        _count: { select: { remittances: true, duties: true, extras: true, items: true } },
      },
    });
  }

  /** 원가정산 상세 */
  async getById(id: string) {
    const item = await this.prisma.importCostSettlement.findUnique({
      where: { id },
      include: {
        order: { select: { orderNumber: true, currency: true, totalAmount: true } },
        contract: { select: { contractNumber: true, name: true, client: true } },
        remittances: { orderBy: { remittanceDate: "asc" } },
        duties: true,
        extras: { include: { targetItem: { select: { name: true } } } },
        items: true,
      },
    });
    if (!item) throw new Error("원가정산을 찾을 수 없습니다.");
    return item;
  }

  /** 원가정산 생성 */
  async create(data: {
    orderId?: string;
    contractId?: string;
    declarationNo: string;
    supplier: string;
    declarationDate: string;
    totalImportCost: number;
    supplyAmount: number;
    vat: number;
    notes?: string;
    createdBy: string;
    remittances?: Array<{
      remittanceDate: string;
      foreignAmount: number;
      exchangeRate: number;
      krwAmount: number;
      invoiceNo?: string;
      notes?: string;
    }>;
    duties?: Array<{
      type: string;
      amount: number;
      vat?: number;
      awbNo?: string;
      notes?: string;
    }>;
    currency?: string;
    saleInfo?: string;
    items?: Array<{
      inventoryNo?: string;
      name: string;
      quantity: number;
      foreignUnitPrice?: number;
      foreignAmount?: number;
      unitPrice: number;
      amount: number;
    }>;
  }) {
    const createData: any = {
      orderId: data.orderId ?? null,
      contractId: data.contractId ?? null,
      declarationNo: data.declarationNo,
      supplier: data.supplier,
      declarationDate: new Date(data.declarationDate),
      currency: data.currency || "USD",
      totalImportCost: data.totalImportCost,
      totalExtraCost: 0,
      supplyAmount: data.supplyAmount,
      vat: data.vat,
      saleInfo: data.saleInfo ?? null,
      notes: data.notes ?? null,
      createdBy: data.createdBy,
    };

    if (data.remittances && data.remittances.length > 0) {
      createData.remittances = {
        create: data.remittances.map(r => ({
          remittanceDate: new Date(r.remittanceDate),
          foreignAmount: r.foreignAmount,
          exchangeRate: r.exchangeRate,
          krwAmount: r.krwAmount,
          invoiceNo: r.invoiceNo ?? null,
          notes: r.notes ?? null,
        })),
      };
    }
    if (data.duties && data.duties.length > 0) {
      createData.duties = {
        create: data.duties.map(d => ({
          type: d.type as any,
          amount: d.amount,
          vat: d.vat || 0,
          awbNo: d.awbNo ?? null,
          notes: d.notes ?? null,
        })),
      };
    }
    if (data.items && data.items.length > 0) {
      createData.items = {
        create: data.items.map(i => ({
          inventoryNo: i.inventoryNo ?? null,
          name: i.name,
          quantity: i.quantity,
          foreignUnitPrice: i.foreignUnitPrice ?? null,
          foreignAmount: i.foreignAmount ?? null,
          unitPrice: i.unitPrice,
          amount: i.amount,
        })),
      };
    }

    return this.prisma.importCostSettlement.create({
      data: createData,
      include: { remittances: true, duties: true, items: true },
    });
  }

  /** 부대비용 추가 */
  async addExtra(settlementId: string, data: {
    targetItemId?: string;
    name: string;
    amount: number;
    notes?: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const extra = await tx.costExtra.create({
        data: {
          settlementId,
          targetItemId: data.targetItemId ?? null,
          name: data.name,
          amount: data.amount,
          notes: data.notes ?? null,
        },
      });

      // totalExtraCost 갱신
      const agg = await tx.costExtra.aggregate({
        where: { settlementId },
        _sum: { amount: true },
      });
      await tx.importCostSettlement.update({
        where: { id: settlementId },
        data: { totalExtraCost: Number(agg._sum.amount) || 0 },
      });

      return extra;
    });
  }

  /** 계약 연결 업데이트 */
  async updateContract(settlementId: string, contractId: string | null) {
    return this.prisma.importCostSettlement.update({
      where: { id: settlementId },
      data: { contractId },
      include: { contract: { select: { contractNumber: true, name: true, client: true } } },
    });
  }

  /** 송금 추가 */
  async addRemittance(settlementId: string, data: {
    remittanceDate: string;
    foreignAmount: number;
    exchangeRate: number;
    krwAmount: number;
    invoiceNo?: string;
    notes?: string;
  }) {
    // 정산 존재 확인
    const settlement = await this.prisma.importCostSettlement.findUnique({ where: { id: settlementId } });
    if (!settlement) throw new Error("원가정산을 찾을 수 없습니다.");

    return this.prisma.costRemittance.create({
      data: {
        settlementId,
        remittanceDate: new Date(data.remittanceDate),
        foreignAmount: data.foreignAmount,
        exchangeRate: data.exchangeRate,
        krwAmount: data.krwAmount,
        invoiceNo: data.invoiceNo ?? null,
        notes: data.notes ?? null,
      },
    });
  }

  /** 송금 삭제 */
  async removeRemittance(remittanceId: string) {
    await this.prisma.costRemittance.delete({ where: { id: remittanceId } });
  }

  /** 삭제 */
  async remove(id: string) {
    await this.prisma.importCostSettlement.delete({ where: { id } });
  }
}
