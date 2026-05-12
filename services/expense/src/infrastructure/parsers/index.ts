import * as XLSX from "xlsx";
import type { SourceType } from "@prisma/client";
import type { ParseResult } from "../../domain/types";
import { parseShinhan } from "./shinhan.parser";
import { parseHyundai } from "./hyundai.parser";
import { parseKB } from "./kb.parser";

export { parseShinhan, parseHyundai, parseKB };

/**
 * 카드사 자동 감지 (파일 컨텐츠 우선, 파일명은 보조)
 *
 * - HTML magic → 현대카드
 * - OLE2 + sheet "Sheet0" + 헤더 "거래일" → 신한카드
 * - OLE2 + sheet "sheet 1" + 메타 "조회기간" → KB국민카드
 * - 영문 파일명 hint → fallback
 */
export function detectCardCompany(buf: Buffer, fileName: string): SourceType {
  // 1차: HTML detection (현대카드)
  const headStr = buf.subarray(0, 8).toString("utf-8");
  if (
    headStr.startsWith("\r\n") ||
    headStr.startsWith("<htm") ||
    headStr.startsWith("<HTM") ||
    headStr.startsWith("<!DO") ||
    headStr.startsWith("<?xm")
  ) {
    return "CARD_HYUNDAI";
  }

  // 2차: OLE2 .xls — 시트명·헤더로 구분
  const head = buf.subarray(0, 4);
  if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) {
    try {
      const wb = XLSX.read(buf, { type: "buffer", cellDates: false, sheetRows: 8 });
      const sheetName = wb.SheetNames[0] ?? "";
      const ws = wb.Sheets[sheetName];

      if (sheetName === "sheet 1") {
        // KB 패턴: R1에 "조회기간" 또는 R6에 "이용일"
        const r1 = ws ? String(ws["A2"]?.v ?? ws["A1"]?.v ?? "") : "";
        const r6 = ws ? String(ws["A7"]?.v ?? "") : "";
        if (r1.includes("조회기간") || r6.includes("이용일")) return "CARD_KB";
      }

      if (sheetName === "Sheet0") {
        // 신한 패턴: R0에 "거래일"
        const r0 = ws ? String(ws["A1"]?.v ?? "") : "";
        if (r0.includes("거래일")) return "CARD_SHINHAN";
      }

      // sheet 이름이 인지된 패턴이 아니면 fallback
    } catch {
      // 파일 손상 등 — fallback
    }
  }

  // 3차: 영문 파일명 hint (한글이면 인코딩 mojibake로 매칭 안 될 가능성)
  const lower = fileName.toLowerCase();
  if (/shinhancard|shinhan/.test(lower)) return "CARD_SHINHAN";
  if (/hyundaicard|hyundai/.test(lower)) return "CARD_HYUNDAI";
  if (/\bkb\b|kookmin|kbcard/.test(lower)) return "CARD_KB";

  return "CARD_OTHER";
}

/** 카드사별 파서 디스패처 */
export function parseStatement(buf: Buffer, cardCompany: SourceType): ParseResult {
  switch (cardCompany) {
    case "CARD_SHINHAN":
      return parseShinhan(buf);
    case "CARD_HYUNDAI":
      return parseHyundai(buf);
    case "CARD_KB":
      return parseKB(buf);
    default:
      throw new Error(`Unsupported card company for parsing: ${cardCompany}`);
  }
}
