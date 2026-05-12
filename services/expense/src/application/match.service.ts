// 거래 ↔ 영수증 매칭 (V1 알고리즘 이식)

import type { PrismaClient, ExpenseTransaction, ExpenseReceipt, MatchSource } from "@prisma/client";

const MATCH_THRESHOLD = 0.7;
const DAY_MS = 86_400_000;

/** 거래 ↔ 영수증 매칭 점수 (0~1). amount 60% + date 40% 가중. */
export function matchScore(
  txn: Pick<ExpenseTransaction, "amount" | "transactedAt">,
  receipt: Pick<ExpenseReceipt, "extractedAmount" | "extractedDate">,
): number {
  if (!receipt.extractedAmount || !receipt.extractedDate) return 0;

  const txnAmount = Number(txn.amount);
  const recAmount = Number(receipt.extractedAmount);
  const diff = Math.abs(txnAmount - recAmount);
  const ratio = txnAmount > 0 ? diff / txnAmount : 1;

  let amountScore = 0;
  if (diff === 0) amountScore = 1.0;
  else if (ratio <= 0.05) amountScore = 0.7;
  else if (ratio <= 0.1) amountScore = 0.3;

  const dayDiff = Math.abs(txn.transactedAt.getTime() - receipt.extractedDate.getTime()) / DAY_MS;
  let dateScore = 0;
  if (dayDiff < 1) dateScore = 1.0;
  else if (dayDiff <= 1) dateScore = 0.9;
  else if (dayDiff <= 4) dateScore = 1 - ((dayDiff - 1) / 3) * 0.4;

  return 0.6 * amountScore + 0.4 * dateScore;
}

export class MatchService {
  constructor(private readonly prisma: PrismaClient) {}

  /** 영수증에 대한 자동 매칭 후보 생성 (사용자 confirm 대기 상태) */
  async suggestMatchesForReceipt(receiptId: string): Promise<number> {
    const receipt = await this.prisma.expenseReceipt.findUnique({ where: { id: receiptId } });
    if (!receipt || receipt.ocrStatus !== "DONE" || !receipt.extractedAmount || !receipt.extractedDate) {
      return 0;
    }

    const dateMin = new Date(receipt.extractedDate.getTime() - 4 * DAY_MS);
    const dateMax = new Date(receipt.extractedDate.getTime() + 4 * DAY_MS);

    const candidates = await this.prisma.expenseTransaction.findMany({
      where: {
        userId: receipt.userId,
        transactedAt: { gte: dateMin, lte: dateMax },
        isCanceled: false,
        matches: { none: {} },
      },
    });

    const scored = candidates
      .map((t) => ({ txn: t, score: matchScore(t, receipt) }))
      .filter((x) => x.score >= MATCH_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    let created = 0;
    for (const { txn, score } of scored) {
      try {
        await this.prisma.transactionReceiptMatch.create({
          data: {
            transactionId: txn.id,
            receiptId: receipt.id,
            source: "AUTO",
            confidence: score,
            confirmedAt: null,
          },
        });
        created++;
      } catch {
        /* unique 위반 무시 */
      }
    }
    return created;
  }

  /** 거래에 대한 자동 매칭 후보 생성 (역방향 — 거래 등록 후 호출) */
  async suggestMatchesForTransaction(transactionId: string): Promise<number> {
    const txn = await this.prisma.expenseTransaction.findUnique({ where: { id: transactionId } });
    if (!txn || txn.isCanceled) return 0;

    const dateMin = new Date(txn.transactedAt.getTime() - 4 * DAY_MS);
    const dateMax = new Date(txn.transactedAt.getTime() + 4 * DAY_MS);

    const candidates = await this.prisma.expenseReceipt.findMany({
      where: {
        userId: txn.userId,
        ocrStatus: "DONE",
        extractedDate: { gte: dateMin, lte: dateMax },
        matches: { none: {} },
      },
    });

    const scored = candidates
      .map((r) => ({ receipt: r, score: matchScore(txn, r) }))
      .filter((x) => x.score >= MATCH_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    let created = 0;
    for (const { receipt, score } of scored) {
      try {
        await this.prisma.transactionReceiptMatch.create({
          data: {
            transactionId: txn.id,
            receiptId: receipt.id,
            source: "AUTO",
            confidence: score,
            confirmedAt: null,
          },
        });
        created++;
      } catch {
        /* ignore */
      }
    }
    return created;
  }

  /** 사용자 본인의 매칭만 — receiptId/transactionId로 필터 */
  async listMatches(userId: string, params: { transactionId?: string; receiptId?: string; confirmed?: boolean }) {
    const where: any = {
      OR: [
        { transaction: { userId } },
        { receipt: { userId } },
      ],
    };
    if (params.transactionId) where.transactionId = params.transactionId;
    if (params.receiptId) where.receiptId = params.receiptId;
    if (params.confirmed === true) where.confirmedAt = { not: null };
    if (params.confirmed === false) where.confirmedAt = null;

    return this.prisma.transactionReceiptMatch.findMany({
      where,
      include: {
        transaction: { select: { id: true, transactedAt: true, merchantName: true, amount: true, userId: true } },
        receipt: { select: { id: true, fileUrl: true, extractedAmount: true, extractedMerchant: true, extractedDate: true, userId: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * 1:1 규칙 검증 — 영수증 1장 = 거래 1건.
   * 영수증/거래 어느 쪽이든 이미 다른 확정 매칭이 있으면 throw.
   */
  private async assertNoExistingConfirmedMatch(
    receiptId: string,
    transactionId: string,
    excludeMatchId?: string,
  ) {
    const existing = await this.prisma.transactionReceiptMatch.findFirst({
      where: {
        confirmedAt: { not: null },
        OR: [{ receiptId }, { transactionId }],
        ...(excludeMatchId && { id: { not: excludeMatchId } }),
      },
      select: { id: true, receiptId: true, transactionId: true },
    });
    if (existing) {
      const conflictKind = existing.receiptId === receiptId ? "영수증" : "거래";
      throw new Error(
        `${conflictKind}이(가) 이미 다른 ${conflictKind === "영수증" ? "거래" : "영수증"}에 확정 매칭되어 있습니다. 기존 매칭을 먼저 해제하세요.`,
      );
    }
  }

  /**
   * 매칭이 확정되면 영수증의 추출 정보(가맹점/일시/금액)를 거래 명세 자료에 맞춰 동기화.
   * 명세 데이터가 OCR 추출보다 정확하므로 매칭 시점에 영수증을 명세 기준으로 정렬한다.
   */
  private async syncReceiptFromTransaction(receiptId: string, transactionId: string) {
    const txn = await this.prisma.expenseTransaction.findUnique({
      where: { id: transactionId },
      select: { merchantName: true, transactedAt: true, amount: true },
    });
    if (!txn) return;
    await this.prisma.expenseReceipt.update({
      where: { id: receiptId },
      data: {
        extractedMerchant: txn.merchantName,
        extractedDate: txn.transactedAt,
        extractedAmount: txn.amount,
      },
    });
  }

  /** 수동 매칭 생성 */
  async createManual(userId: string, transactionId: string, receiptId: string) {
    // 본인 데이터 확인
    const txn = await this.prisma.expenseTransaction.findFirst({ where: { id: transactionId, userId } });
    if (!txn) throw new Error("거래를 찾을 수 없습니다.");
    const receipt = await this.prisma.expenseReceipt.findFirst({ where: { id: receiptId, userId } });
    if (!receipt) throw new Error("영수증을 찾을 수 없습니다.");

    // 1:1 규칙 — 영수증/거래 한쪽이라도 이미 확정 매칭이 있으면 차단
    await this.assertNoExistingConfirmedMatch(receiptId, transactionId);

    const match = await this.prisma.transactionReceiptMatch.create({
      data: {
        transactionId,
        receiptId,
        source: "MANUAL",
        confidence: null,
        confirmedAt: new Date(),
        confirmedByUserId: userId,
      },
    });
    // 명세 → 영수증 동기화 (수동 매칭은 즉시 확정)
    await this.syncReceiptFromTransaction(receiptId, transactionId);
    return match;
  }

  /** 매칭 confirm (AUTO 매칭의 사용자 승인) */
  async confirm(userId: string, id: string) {
    const m = await this.prisma.transactionReceiptMatch.findUnique({
      where: { id },
      include: { transaction: { select: { userId: true } } },
    });
    if (!m || m.transaction.userId !== userId) throw new Error("매칭을 찾을 수 없습니다.");

    // 1:1 규칙 — 같은 영수증/거래에 이미 다른 확정 매칭이 있으면 차단
    await this.assertNoExistingConfirmedMatch(m.receiptId, m.transactionId, id);

    const updated = await this.prisma.transactionReceiptMatch.update({
      where: { id },
      data: { confirmedAt: new Date(), confirmedByUserId: userId },
    });
    // 명세 → 영수증 동기화 (확정 시점)
    await this.syncReceiptFromTransaction(m.receiptId, m.transactionId);
    return updated;
  }

  /** 매칭 해제 */
  async remove(userId: string, id: string) {
    const m = await this.prisma.transactionReceiptMatch.findUnique({
      where: { id },
      include: { transaction: { select: { userId: true } } },
    });
    if (!m || m.transaction.userId !== userId) throw new Error("매칭을 찾을 수 없습니다.");
    await this.prisma.transactionReceiptMatch.delete({ where: { id } });
  }
}
