// 정산서 Excel 출력 (V2 P4 — 기본형)
// 카테고리별 sheet + 거래 라인 + 합계.
// 영수증 이미지 embed는 V3 후보.

import ExcelJS from "exceljs";
import type { Prisma } from "@prisma/client";

type SettlementWithItems = Prisma.ExpenseSettlementGetPayload<{
  include: {
    items: {
      include: {
        transaction: {
          include: {
            category: true;
            source: true;
            matches: { include: { receipt: true } };
          };
        };
      };
    };
  };
}>;

export async function buildSettlementWorkbook(s: SettlementWithItems): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "expense-service";
  wb.created = new Date();

  // ── 요약 sheet ────────────────────────────────────
  const summary = wb.addWorksheet("요약");
  summary.columns = [
    { header: "항목", key: "label", width: 24 },
    { header: "내용", key: "value", width: 60 },
  ];
  summary.addRow({ label: "정산 제목", value: s.title });
  summary.addRow({
    label: "기간",
    value: s.periodStart && s.periodEnd ? `${formatDate(s.periodStart)} ~ ${formatDate(s.periodEnd)}` : "—",
  });
  summary.addRow({ label: "총 거래 수", value: s.totalCount ?? 0 });
  summary.addRow({ label: "총 금액", value: Number(s.totalAmount ?? 0) });
  summary.addRow({ label: "상태", value: STATUS_LABEL[s.status] ?? s.status });
  summary.getRow(1).font = { bold: true };

  // ── 카테고리별 sheet ───────────────────────────────
  const byCategory = new Map<string, typeof s.items>();
  for (const it of s.items) {
    const key = it.transaction.category?.sheetName ?? "기타";
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key)!.push(it);
  }

  for (const [sheetName, items] of byCategory) {
    const sh = wb.addWorksheet(sheetName.slice(0, 31));
    sh.columns = [
      { header: "거래일시", key: "transactedAt", width: 20 },
      { header: "가맹점", key: "merchantName", width: 30 },
      { header: "카테고리", key: "categoryName", width: 16 },
      { header: "상세 내역", key: "detail", width: 30 },
      { header: "결제수단", key: "sourceName", width: 18 },
      { header: "금액", key: "amount", width: 14 },
      { header: "메모", key: "memo", width: 36 },
      { header: "영수증", key: "receipt", width: 32 },
    ];
    sh.getRow(1).font = { bold: true };
    sh.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE9ECEF" } };

    let subtotal = 0;
    for (const it of items) {
      const t = it.transaction;
      const confirmed = t.matches.find((m) => m.confirmedAt !== null);
      const receiptInfo = confirmed
        ? `${confirmed.receipt.extractedMerchant ?? "?"} ${
            confirmed.receipt.extractedAmount
              ? Number(confirmed.receipt.extractedAmount).toLocaleString() + "원"
              : ""
          }`.trim()
        : "";
      sh.addRow({
        transactedAt: formatDateTime(t.transactedAt),
        merchantName: t.merchantName,
        categoryName: t.category?.name ?? "기타",
        detail: t.detail ?? "",
        sourceName: t.source.displayName ?? t.source.name,
        amount: Number(t.amount),
        memo: it.memoOverride ?? t.memo ?? "",
        receipt: receiptInfo,
      });
      subtotal += Number(t.amount);
    }

    // 합계 row
    const totalRow = sh.addRow({
      transactedAt: "",
      merchantName: "합계",
      categoryName: "",
      sourceName: "",
      amount: subtotal,
      memo: "",
      receipt: "",
    });
    totalRow.font = { bold: true };
    totalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF3CD" } };

    sh.getColumn("amount").numFmt = "#,##0";
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatDateTime(d: Date): string {
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "작성 중",
  SUBMITTED: "결재 진행 중",
  APPROVED: "결재 완료",
  RECEIVED: "재무팀 접수",
  PAID: "입금 완료",
  REJECTED: "반려",
};
