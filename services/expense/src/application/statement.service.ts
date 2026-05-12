import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type { PrismaClient, SourceType } from "@prisma/client";
import { detectCardCompany, parseStatement } from "../infrastructure/parsers";
import type { ParsedTransaction } from "../domain/types";

export interface ImportStatementInput {
  userId: string;
  fileBuf: Buffer;
  fileName: string;
  /** 사용자가 명시한 sourceId. 없으면 자동 감지 + cardNumber 매칭 */
  sourceId?: string;
}

export interface ImportStatementResult {
  statementId: string;
  cardCompany: SourceType;
  parserVersion: string;
  totalRows: number;
  parsedRows: number;
  errorRows: number;
  insertedTransactions: number;
  skippedDuplicates: number;
  periodStart: Date | null;
  periodEnd: Date | null;
  errors: { row: number; reason: string }[];
}

export class StatementService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly uploadDir: string,
  ) {}

  async list(userId: string, params: { page?: number; limit?: number } = {}) {
    const { page = 1, limit = 50 } = params;
    const [items, total] = await Promise.all([
      this.prisma.expenseStatement.findMany({
        where: { userId },
        include: { source: { select: { id: true, name: true, type: true } } },
        orderBy: { parsedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.expenseStatement.count({ where: { userId } }),
    ]);
    return { items, total, page, limit };
  }

  async get(userId: string, id: string) {
    const stmt = await this.prisma.expenseStatement.findFirst({
      where: { id, userId },
      include: {
        source: true,
        transactions: { orderBy: { transactedAt: "asc" }, take: 500 },
      },
    });
    if (!stmt) throw new Error("명세서를 찾을 수 없습니다.");
    return stmt;
  }

  async import(input: ImportStatementInput): Promise<ImportStatementResult> {
    const { userId, fileBuf, fileName } = input;

    // 1. 카드사 감지
    const cardCompany = detectCardCompany(fileBuf, fileName);
    if (cardCompany === "CARD_OTHER") {
      throw new Error(`카드사를 감지할 수 없습니다: ${fileName}`);
    }

    // 2. 파싱
    const parsed = parseStatement(fileBuf, cardCompany);
    if (parsed.transactions.length === 0) {
      throw new Error(
        `파싱된 거래가 없습니다 (cardCompany=${cardCompany}, errors=${JSON.stringify(parsed.errors.slice(0, 3))})`,
      );
    }

    // 3. sourceId 결정
    const sourceId = await this.resolveSourceId(userId, cardCompany, parsed.transactions, input.sourceId);

    // 4. 파일 저장
    const statementId = "stmt_" + crypto.randomBytes(12).toString("hex");
    const ext = path.extname(fileName) || ".xls";
    const ym = new Date().toISOString().slice(0, 7);
    const storedDir = path.join(this.uploadDir, "statements", ym);
    await fs.mkdir(storedDir, { recursive: true });
    const storedFileName = `${statementId}${ext}`;
    const storedPath = path.join(storedDir, storedFileName);
    await fs.writeFile(storedPath, fileBuf);
    const fileUrl = `statements/${ym}/${storedFileName}`;

    // 5. 기간 추출
    const dates = parsed.transactions.map((t) => t.transactedAt.getTime());
    const periodStart = new Date(Math.min(...dates));
    const periodEnd = new Date(Math.max(...dates));

    // 6. statement INSERT + transactions createMany (idempotent via @@unique([sourceId, approvalNo]))
    const before = await this.prisma.expenseTransaction.count({ where: { sourceId } });
    await this.prisma.$transaction([
      this.prisma.expenseStatement.create({
        data: {
          id: statementId,
          userId,
          sourceId,
          originalFileName: fileName,
          fileUrl,
          parserVersion: parsed.parserVersion,
          periodStart,
          periodEnd,
          totalRows: parsed.totalRows,
          parsedRows: parsed.parsedRows,
          errorRows: parsed.errorRows,
        },
      }),
      this.prisma.expenseTransaction.createMany({
        data: parsed.transactions.map((t) => ({
          userId,
          sourceId,
          statementId,
          isManual: false,
          transactedAt: t.transactedAt,
          merchantName: t.merchantName,
          amount: t.amount,
          currency: t.currency,
          foreignAmount: t.foreignAmount ?? null,
          paymentType: t.paymentType ?? null,
          installmentMonths: t.installmentMonths ?? null,
          approvalNo: t.approvalNo ?? null,
          status: "PENDING" as const,
          isCanceled: t.isCanceled,
        })),
        skipDuplicates: true,
      }),
    ]);

    const after = await this.prisma.expenseTransaction.count({ where: { sourceId } });
    const inserted = after - before;
    const skipped = parsed.transactions.length - inserted;

    return {
      statementId,
      cardCompany,
      parserVersion: parsed.parserVersion,
      totalRows: parsed.totalRows,
      parsedRows: parsed.parsedRows,
      errorRows: parsed.errorRows,
      insertedTransactions: inserted,
      skippedDuplicates: skipped,
      periodStart,
      periodEnd,
      errors: parsed.errors,
    };
  }

  private async resolveSourceId(
    userId: string,
    cardCompany: SourceType,
    transactions: ParsedTransaction[],
    explicit?: string,
  ): Promise<string> {
    // 명시적 지정
    if (explicit) {
      const s = await this.prisma.expenseSource.findFirst({ where: { id: explicit, userId } });
      if (!s) throw new Error("지정한 source를 찾을 수 없습니다.");
      return s.id;
    }

    // cardNumber 매칭 시도 (V1 패턴)
    const cardNumbers = [...new Set(transactions.map((t) => t.cardNumber).filter((x): x is string => !!x))];
    if (cardNumbers.length === 1) {
      const matched = await this.prisma.expenseSource.findFirst({
        where: { userId, type: cardCompany, cardNumber: cardNumbers[0]!, active: true },
      });
      if (matched) return matched.id;
    }

    // type만으로 매칭 (active 1개만 있으면)
    const sameType = await this.prisma.expenseSource.findMany({
      where: { userId, type: cardCompany, active: true },
    });
    if (sameType.length === 1) return sameType[0]!.id;

    // 자동 생성 (cardNumber 있으면 함께)
    const newSource = await this.prisma.expenseSource.create({
      data: {
        userId,
        type: cardCompany,
        name: `${this.cardCompanyLabel(cardCompany)}${cardNumbers[0] ? ` (${cardNumbers[0]})` : ""}`,
        cardNumber: cardNumbers[0] ?? null,
        active: true,
      },
    });
    return newSource.id;
  }

  private cardCompanyLabel(t: SourceType): string {
    return {
      CARD_SHINHAN: "신한카드",
      CARD_HYUNDAI: "현대카드",
      CARD_KB: "국민카드",
      CARD_OTHER: "기타카드",
      CASH: "현금",
    }[t];
  }
}
