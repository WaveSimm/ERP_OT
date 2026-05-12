import * as XLSX from "xlsx";
import type { ParseResult, ParsedTransaction } from "../../domain/types";

/**
 * 신한카드 명세서 파서 (.xls OLE2)
 *
 * 컬럼 (R0 헤더, 11개):
 *   거래일 / 카드구분 / 이용카드 / 가맹점명 / 승인번호 / 금액 /
 *   매입구분 / 이용구분 / 거래통화 / 해외이용금액 / 취소상태
 *
 * 거래일 형식: "2026.04.28 18:53"
 * 음수 금액 또는 취소상태="취소" → isCanceled=true
 */
export function parseShinhan(buf: Buffer): ParseResult {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]!];
  if (!ws) throw new Error("신한카드 sheet not found");

  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: null });
  const transactions: ParsedTransaction[] = [];
  const errors: { row: number; reason: string }[] = [];

  // R0 = header
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] as (string | number | null)[];
    if (!r || r.every((c) => c == null || c === "")) continue;

    try {
      const dateStr = String(r[0] ?? "");
      const cardNumber = String(r[2] ?? "").trim();
      const merchantName = String(r[3] ?? "").trim();
      const approvalNo = String(r[4] ?? "").trim();
      const amountRaw = parseNumeric(r[5]);
      const purchaseStatus = String(r[6] ?? "");
      const paymentType = String(r[7] ?? "");
      const currency = String(r[8] ?? "").trim() || "KRW";
      const foreignAmountRaw = parseNumeric(r[9]);
      const cancelStatus = String(r[10] ?? "");

      if (!dateStr || !merchantName) {
        errors.push({ row: i, reason: "missing date or merchant" });
        continue;
      }

      transactions.push({
        transactedAt: parseShinhanDate(dateStr),
        merchantName,
        amount: Math.abs(amountRaw ?? 0),
        currency,
        foreignAmount: foreignAmountRaw ?? null,
        paymentType: paymentType || null,
        installmentMonths: null,
        approvalNo: approvalNo || null,
        cardNumber: cardNumber || null,
        isCanceled: cancelStatus === "취소" || (amountRaw ?? 0) < 0 || purchaseStatus === "승인취소",
      });
    } catch (e) {
      errors.push({ row: i, reason: String(e) });
    }
  }

  return {
    cardCompany: "CARD_SHINHAN",
    parserVersion: "shinhan-v1",
    totalRows: rows.length - 1,
    parsedRows: transactions.length,
    errorRows: errors.length,
    transactions,
    errors,
  };
}

/** 콤마 포함된 문자열·숫자 모두 처리 */
function parseNumeric(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  const s = String(v).replace(/[, ]/g, "");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** "2026.04.28 18:53" → Date (KST) */
function parseShinhanDate(s: string): Date {
  // 패턴: YYYY.MM.DD HH:MM (24h)
  const m = s.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})\s+(\d{1,2}):(\d{1,2})/);
  if (!m) throw new Error(`invalid date: ${s}`);
  const [, y, mo, d, h, mi] = m;
  // KST timestamp 생성 (Asia/Seoul = +09:00)
  return new Date(`${y}-${mo!.padStart(2, "0")}-${d!.padStart(2, "0")}T${h!.padStart(2, "0")}:${mi!.padStart(2, "0")}:00+09:00`);
}
