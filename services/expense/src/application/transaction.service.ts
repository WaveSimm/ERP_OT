import type { PrismaClient, TransactionStatus } from "@prisma/client";

export interface CreateTransactionInput {
  userId: string;
  sourceId: string;
  transactedAt: Date;
  merchantName: string;
  amount: number;
  currency?: string;
  paymentType?: string;
  approvalNo?: string;
  contractId?: string | null;
  contractNumber?: string | null;
  contractName?: string | null;
  detail?: string;
  memo?: string;
  isCanceled?: boolean;
}

export interface ListTransactionParams {
  status?: TransactionStatus;
  contractId?: string;
  sourceId?: string;
  from?: Date;
  to?: Date;
  page?: number;
  limit?: number;
}

export class TransactionService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(userId: string, params: ListTransactionParams = {}) {
    const { status, contractId, sourceId, from, to, page = 1, limit = 100 } = params;
    const where: any = { userId };
    if (status) where.status = status;
    if (contractId) where.contractId = contractId;
    if (sourceId) where.sourceId = sourceId;
    if (from || to) {
      where.transactedAt = {};
      if (from) where.transactedAt.gte = from;
      if (to) where.transactedAt.lte = to;
    }

    const [items, total] = await Promise.all([
      this.prisma.expenseTransaction.findMany({
        where,
        include: {
          source: { select: { id: true, name: true, displayName: true, type: true, ownership: true } },
          matches: {
            select: { id: true, receiptId: true, confirmedAt: true, confidence: true },
          },
          settlementItems: {
            select: { settlementId: true, settlement: { select: { id: true, title: true, status: true } } },
          },
        },
        orderBy: [{ transactedAt: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.expenseTransaction.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async get(userId: string, id: string) {
    const tx = await this.prisma.expenseTransaction.findFirst({
      where: { id, userId },
      include: {
        source: true,
        matches: { include: { receipt: true } },
      },
    });
    if (!tx) throw new Error("거래를 찾을 수 없습니다.");
    return tx;
  }

  // v1.6.2 (2026-05-15): 계약 연결 시 CATEGORIZED, 미연결이면 PENDING
  private resolveStatus(contractId: string | null | undefined): TransactionStatus {
    return contractId ? "CATEGORIZED" : "PENDING";
  }

  async createManual(input: CreateTransactionInput) {
    const status = this.resolveStatus(input.contractId);
    return this.prisma.expenseTransaction.create({
      data: {
        userId: input.userId,
        sourceId: input.sourceId,
        statementId: null,
        isManual: true,
        transactedAt: input.transactedAt,
        merchantName: input.merchantName,
        amount: input.amount,
        currency: input.currency ?? "KRW",
        foreignAmount: null,
        paymentType: input.paymentType ?? null,
        installmentMonths: null,
        approvalNo: input.approvalNo ?? null,
        contractId: input.contractId ?? null,
        contractNumber: input.contractNumber ?? null,
        contractName: input.contractName ?? null,
        detail: input.detail ?? null,
        memo: input.memo ?? null,
        status,
        isCanceled: input.isCanceled ?? false,
      },
    });
  }

  async update(
    userId: string,
    id: string,
    data: {
      contractId?: string | null | undefined;
      contractNumber?: string | null | undefined;
      contractName?: string | null | undefined;
      detail?: string | null | undefined;
      memo?: string | null | undefined;
      status?: TransactionStatus | undefined;
      merchantName?: string | undefined;
      amount?: number | undefined;
    },
  ) {
    await this.get(userId, id);
    const updateData: any = {};
    if (data.contractId !== undefined) {
      updateData.contractId = data.contractId;
      updateData.contractNumber = data.contractNumber ?? null;
      updateData.contractName = data.contractName ?? null;
      if (data.status === undefined) {
        updateData.status = this.resolveStatus(data.contractId);
      }
    }
    if (data.detail !== undefined) updateData.detail = data.detail;
    if (data.memo !== undefined) updateData.memo = data.memo;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.merchantName !== undefined) updateData.merchantName = data.merchantName;
    if (data.amount !== undefined) updateData.amount = data.amount;

    return this.prisma.expenseTransaction.update({ where: { id }, data: updateData });
  }

  // 자동/수동 구분 없이 모두 삭제 허용 (2026-05-12, pre-prod 단계)
  async deleteManual(userId: string, id: string) {
    await this.get(userId, id);
    return this.prisma.expenseTransaction.delete({ where: { id } });
  }
}
