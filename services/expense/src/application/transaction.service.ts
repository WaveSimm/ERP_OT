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

  async createManual(input: CreateTransactionInput) {
    // 2026-06-12: 상태 기준이 '정산분류(정산묶음 배정)'로 변경됨. 생성 시점엔 미배정 → 미정산분류(PENDING).
    const status: TransactionStatus = "PENDING";
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
      // 사업(계약)은 메타데이터 — 상태(정산분류)와 무관. status는 정산묶음 배정으로만 결정.
      updateData.contractId = data.contractId;
      updateData.contractNumber = data.contractNumber ?? null;
      updateData.contractName = data.contractName ?? null;
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

  /**
   * 일괄 삭제 — 본인(userId) 소유 거래만 한 번에 제거. 프런트의 동시 N요청(rate-limit 폭주) 대체.
   * 정산묶음(settlement)에 포함된 거래도 삭제 가능: 정산항목을 먼저 해제하고(FK Restrict 회피),
   * 영향받은 정산묶음의 합계(totalCount/totalAmount/period)를 재계산한다. (영수증 매칭은 onDelete:Cascade)
   */
  async deleteManyManual(userId: string, ids: string[]) {
    const owned = await this.prisma.expenseTransaction.findMany({
      where: { id: { in: ids }, userId },
      select: { id: true },
    });
    const ownedIds = owned.map((o) => o.id);
    if (ownedIds.length === 0) return { deleted: 0, releasedFromSettlements: 0 };

    // 합계 재계산이 필요한 정산묶음 수집
    const affected = await this.prisma.expenseSettlementItem.findMany({
      where: { transactionId: { in: ownedIds } },
      select: { settlementId: true },
    });
    const settlementIds = [...new Set(affected.map((a) => a.settlementId))];

    // 원자적: 정산항목 해제 → 거래 삭제
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.expenseSettlementItem.deleteMany({ where: { transactionId: { in: ownedIds } } });
      return tx.expenseTransaction.deleteMany({ where: { id: { in: ownedIds } } });
    });

    // 영향 정산묶음 합계 재계산 (남은 항목 기준)
    for (const sId of settlementIds) {
      const items = await this.prisma.expenseSettlementItem.findMany({
        where: { settlementId: sId },
        include: { transaction: true },
      });
      if (items.length === 0) {
        await this.prisma.expenseSettlement.update({
          where: { id: sId },
          data: { totalCount: 0, totalAmount: 0, periodStart: null, periodEnd: null },
        });
      } else {
        const amounts = items.map((it) => Number(it.transaction.amount));
        const dates = items.map((it) => it.transaction.transactedAt.getTime());
        await this.prisma.expenseSettlement.update({
          where: { id: sId },
          data: {
            totalCount: items.length,
            totalAmount: amounts.reduce((s, n) => s + n, 0),
            periodStart: new Date(Math.min(...dates)),
            periodEnd: new Date(Math.max(...dates)),
          },
        });
      }
    }

    return { deleted: result.count, releasedFromSettlements: settlementIds.length };
  }
}
