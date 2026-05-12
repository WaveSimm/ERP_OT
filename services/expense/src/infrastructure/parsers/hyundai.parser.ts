import { JSDOM } from "jsdom";
import type { ParseResult, ParsedTransaction } from "../../domain/types";

/**
 * 현대카드 명세서 파서 (HTML-as-xls)
 *
 * 컬럼 (헤더 row 위치 가변, 11개):
 *   승인일 / 승인시각 / 카드구분 / 카드종류 / 가맹점명 / 승인금액 /
 *   이용구분 / 할부개월 / 승인번호 / 취소일 / 승인구분
 *
 * 승인일 형식: "2026년 04월 27일"
 * 마지막 row 합계 (소계) → 배제
 */
export function parseHyundai(buf: Buffer): ParseResult {
  const html = buf.toString("utf-8");
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  const rows = Array.from(doc.querySelectorAll("table tr"));
  const transactions: ParsedTransaction[] = [];
  const errors: { row: number; reason: string }[] = [];
  let dataRowCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const cells = Array.from(rows[i]!.querySelectorAll("td, th")).map((c) => c.textContent?.trim() ?? "");
    if (cells.length < 11) continue; // 헤더/제목/소계 row 스킵

    // 데이터 row 패턴: 첫 칸이 "YYYY년 MM월 DD일" 형식
    const dateStr = cells[0]!;
    if (!/^\d{4}년\s*\d{1,2}월\s*\d{1,2}일$/.test(dateStr)) continue;

    dataRowCount++;
    try {
      const timeStr = cells[1] ?? "";
      const cardNumber = cells[3] ?? "";
      const merchantName = cells[4] ?? "";
      const amountStr = cells[5] ?? "0";
      const paymentType = cells[6] ?? "";
      const installmentRaw = cells[7] ?? "0";
      const approvalNo = cells[8] ?? "";
      const cancelDate = cells[9] ?? "";
      const status = cells[10] ?? "";

      // 합계/소계 row 배제 (가맹점명에 "소계"가 들어있거나 시각이 비어있으면)
      if (merchantName.includes("소계") || merchantName.includes("합계")) continue;

      const amount = Number(amountStr.replace(/[, ]/g, ""));
      if (!Number.isFinite(amount) || amount <= 0) {
        errors.push({ row: i, reason: `invalid amount: ${amountStr}` });
        continue;
      }

      transactions.push({
        transactedAt: parseHyundaiDate(dateStr, timeStr),
        merchantName,
        amount,
        currency: "KRW",
        foreignAmount: null,
        paymentType: paymentType || null,
        installmentMonths: installmentRaw ? Math.floor(Number(installmentRaw)) || null : null,
        approvalNo: approvalNo && approvalNo !== "-" ? approvalNo : null,
        cardNumber: cardNumber || null,
        isCanceled:
          status.includes("취소") ||
          Boolean(cancelDate && cancelDate !== "-" && /\d{4}년/.test(cancelDate)),
      });
    } catch (e) {
      errors.push({ row: i, reason: String(e) });
    }
  }

  return {
    cardCompany: "CARD_HYUNDAI",
    parserVersion: "hyundai-v1",
    totalRows: dataRowCount,
    parsedRows: transactions.length,
    errorRows: errors.length,
    transactions,
    errors,
  };
}

/** "2026년 04월 27일" + "19:01" → Date (KST) */
function parseHyundaiDate(dateStr: string, timeStr: string): Date {
  const dm = dateStr.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
  if (!dm) throw new Error(`invalid date: ${dateStr}`);
  const [, y, mo, d] = dm;
  const tm = timeStr.match(/(\d{1,2}):(\d{1,2})/);
  const h = tm ? tm[1] : "00";
  const mi = tm ? tm[2] : "00";
  return new Date(`${y}-${mo!.padStart(2, "0")}-${d!.padStart(2, "0")}T${h!.padStart(2, "0")}:${mi!.padStart(2, "0")}:00+09:00`);
}
