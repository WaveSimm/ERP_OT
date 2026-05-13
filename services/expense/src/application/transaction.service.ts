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
  categoryId?: string;
  detail?: string;
  memo?: string;
  isCanceled?: boolean;
}

export interface ListTransactionParams {
  status?: TransactionStatus;
  categoryId?: string;
  sourceId?: string;
  from?: Date;
  to?: Date;
  page?: number;
  limit?: number;
}

export class TransactionService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(userId: string, params: ListTransactionParams = {}) {
    const { status, categoryId, sourceId, from, to, page = 1, limit = 100 } = params;
    const where: any = { userId };
    if (status) where.status = status;
    if (categoryId) where.categoryId = categoryId;
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
          source: { select: { id: true, name: true, displayName: true, type: true } },
          category: { select: { id: true, code: true, name: true } },
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
        category: true,
        matches: { include: { receipt: true } },
      },
    });
    if (!tx) throw new Error("거래를 찾을 수 없습니다.");
    return tx;
  }

  // PERSONAL 카테고리 자동 EXCLUDED 처리 — code 조회
  private async resolveStatusForCategory(categoryId: string | null): Promise<TransactionStatus> {
    if (!categoryId) return "PENDING";
    const cat = await this.prisma.expenseCategory.findUnique({
      where: { id: categoryId },
      select: { code: true },
    });
    if (cat?.code === "PERSONAL") return "EXCLUDED";
    return "CATEGORIZED";
  }

  async createManual(input: CreateTransactionInput) {
    const status = await this.resolveStatusForCategory(input.categoryId ?? null);
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
        categoryId: input.categoryId ?? null,
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
      categoryId?: string | null | undefined;
      detail?: string | null | undefined;
      memo?: string | null | undefined;
      status?: TransactionStatus | undefined;
      merchantName?: string | undefined;
      amount?: number | undefined;
    },
  ) {
    await this.get(userId, id);
    const updateData: any = {};
    if (data.categoryId !== undefined) {
      updateData.categoryId = data.categoryId;
      if (data.status === undefined) {
        // PERSONAL 카테고리면 EXCLUDED, 그 외 카테고리는 CATEGORIZED, 카테고리 없으면 PENDING
        updateData.status = await this.resolveStatusForCategory(data.categoryId);
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
