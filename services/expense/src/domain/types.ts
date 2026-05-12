// 경비정산 도메인 공용 타입

import type { SourceType } from "@prisma/client";

export interface ParsedTransaction {
  transactedAt: Date;
  merchantName: string;
  amount: number;
  currency: string;
  foreignAmount: number | null;
  paymentType: string | null;
  installmentMonths: number | null;
  approvalNo: string | null;
  cardNumber: string | null;
  isCanceled: boolean;
}

export interface ParseResult {
  cardCompany: SourceType;
  parserVersion: string;
  totalRows: number;
  parsedRows: number;
  errorRows: number;
  transactions: ParsedTransaction[];
  errors: { row: number; reason: string }[];
}

export type CardParser = (buf: Buffer) => ParseResult;
