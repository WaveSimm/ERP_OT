import * as XLSX from "xlsx";
import type { ParseResult, ParsedTransaction } from "../../domain/types";

/**
 * KB국민카드 명세서 파서 (.xls OLE2)
 *
 * 헤더 R6 (R0~R5는 메타: 조회기간, 카드번호, 통계 등)
 * R7~ 데이터, 14개 컬럼:
 *   이용일 / 이용시간 / 이용고객명 / 이용카드명 / 이용하신곳 /
 *   국내이용금액(원) / 해외이용금액($) / 결제방법 / 가맹점정보 /
 *   할인금액 / 적립포인트 / 상태 / 결제예정일 / 승인번호
 *
 * 이용일: "2026-03-31" / 이용시간: "17:09" 별도 컬럼
 * 음수 금액 또는 상태="취소" → isCanceled=true
 */
export function parseKB(buf: Buffer): ParseResult {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]!];
  if (!ws) throw new Error("KB sheet not found");

  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: null });
  const transactions: ParsedTransaction[] = [];
  const errors: { row: number; reason: string }[] = [];

  // R6 = column header (메타 R0~R5 스킵), R7~ = 데이터
  // 단, 안전하게 데이터 row 패턴 (col 0이 YYYY-MM-DD)을 찾아 시작
  let startRow = 7;
  for (let i = 6; i < Math.min(rows.length, 12); i++) {
    const r = rows[i] as unknown[];
    if (typeof r?.[0] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r[0])) {
      startRow = i;
      break;
    }
  }

  let dataRowCount = 0;
  for (let i = startRow; i < rows.length; i++) {
    const r = rows[i] as (string | number | null)[];
    if (!r || !r[0]) continue;
    if (typeof r[0] !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r[0])) break;

    dataRowCount++;
    try {
      const dateStr = String(r[0]);
      const timeStr = String(r[1] ?? "00:00");
      const cardNumber = String(r[3] ?? "").trim();
      const merchantName = String(r[4] ?? "").trim();
      const krwAmount = parseNumeric(r[5]) ?? 0;
      const usdAmount = parseNumeric(r[6]) ?? 0;
      const paymentType = String(r[7] ?? "");
      const status = String(r[11] ?? "");
      const approvalNo = String(r[13] ?? "").trim();

      if (!merchantName) {
        errors.push({ row: i, reason: "missing merchant" });
        continue;
      }

      const isOverseas = usdAmount > 0;
      const amount = isOverseas ? Math.round(krwAmount) : Math.abs(krwAmount);

      transactions.push({
        transactedAt: parseKBDate(dateStr, timeStr),
        merchantName,
        amount,
        currency: isOverseas ? "USD" : "KRW",
        foreignAmount: isOverseas ? usdAmount : null,
        paymentType: paymentType || null,
        installmentMonths: null,
        approvalNo: approvalNo || null,
        cardNumber: cardNumber || null,
        isCanceled: status.includes("취소") || krwAmount < 0,
      });
    } catch (e) {
      errors.push({ row: i, reason: String(e) });
    }
  }

  return {
    cardCompany: "CARD_KB",
    parserVersion: "kb-v1",
    totalRows: dataRowCount,
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

/** "2026-03-31" + "17:09" → Date (KST) */
function parseKBDate(dateStr: string, timeStr: string): Date {
  const tm = timeStr.match(/(\d{1,2}):(\d{1,2})/);
  const h = tm ? tm[1] : "00";
  const mi = tm ? tm[2] : "00";
  return new Date(`${dateStr}T${h!.padStart(2, "0")}:${mi!.padStart(2, "0")}:00+09:00`);
}
