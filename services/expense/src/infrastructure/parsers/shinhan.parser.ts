import * as XLSX from "xlsx";
import type { ParseResult, ParsedTransaction } from "../../domain/types";

/**
 * 신한카드 명세서 파서 (.xls OLE2 / .xlsx)
 *
 * 컬럼은 헤더 이름으로 매핑한다(고정 인덱스 X). 신한이 포맷에 컬럼을 추가해도
 * (예: 2026 포맷의 "업종"·"최초결제일자") 안전하게 동작.
 *
 * 신 포맷(13개) 예: 거래일 / 카드구분 / 이용카드 / 가맹점명 / 업종 / 승인번호 /
 *   금액 / 매입구분 / 이용구분 / 거래통화 / 최초결제일자 / 해외이용금액 / 취소상태
 * 구 포맷(11개): 거래일 / 카드구분 / 이용카드 / 가맹점명 / 승인번호 / 금액 /
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

  // R0 헤더로 컬럼 인덱스 매핑 (공백 제거 후 정확 일치).
  //   "금액"은 "해외이용금액"과 구분돼야 하므로 정확 일치 사용.
  const header = (rows[0] as unknown[] | undefined ?? []).map((c) => String(c ?? "").replace(/\s/g, ""));
  const col = (name: string) => header.indexOf(name);
  const idx = {
    date: col("거래일"),
    card: col("이용카드"),
    merchant: col("가맹점명"),
    approval: col("승인번호"),
    amount: col("금액"),
    purchase: col("매입구분"),
    payType: col("이용구분"),
    currency: col("거래통화"),
    foreign: col("해외이용금액"),
    cancel: col("취소상태"),
  };
  if (idx.amount < 0 || idx.date < 0 || idx.merchant < 0) {
    throw new Error(`신한카드 헤더 인식 실패 (금액/거래일/가맹점명): ${JSON.stringify(header)}`);
  }
  const at = (r: (string | number | null)[], i: number) => (i >= 0 ? r[i] : null);

  // R0 = header
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] as (string | number | null)[];
    if (!r || r.every((c) => c == null || c === "")) continue;

    try {
      const dateStr = String(at(r, idx.date) ?? "");
      const cardNumber = String(at(r, idx.card) ?? "").trim();
      const merchantName = String(at(r, idx.merchant) ?? "").trim();
      const approvalNo = String(at(r, idx.approval) ?? "").trim();
      const amountRaw = parseNumeric(at(r, idx.amount));
      const purchaseStatus = String(at(r, idx.purchase) ?? "");
      const paymentType = String(at(r, idx.payType) ?? "");
      const currency = String(at(r, idx.currency) ?? "").trim() || "KRW";
      const foreignAmountRaw = parseNumeric(at(r, idx.foreign));
      const cancelStatus = String(at(r, idx.cancel) ?? "");

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
    parserVersion: "shinhan-v2",
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
