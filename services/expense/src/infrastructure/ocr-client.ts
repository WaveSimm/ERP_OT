// ocr-service (port 3007) HTTP wrapper.
// /api/v1/ocr/scan/raw — 엔진 직접 호출, DB 저장 없이 raw 결과만 받음.

export interface OcrTextBlock {
  text: string;
  confidence: number;
  bounding_box?: unknown;
}

export interface OcrScanRawResponse {
  engineId: string;
  texts: OcrTextBlock[];
  image_width?: number;
  image_height?: number;
  processing_time_ms?: number;
  extraction_method?: string;
}

export interface NormalizedReceipt {
  amount: number | null;
  merchantName: string | null;
  transactedAt: Date | null;
  fullText: string;
  previewText: string;
}

export class OcrClient {
  constructor(
    private readonly ocrServiceUrl: string,
    private readonly internalToken: string,
  ) {}

  async scanRaw(buffer: Buffer, fileName: string, engineId = "clova-ocr"): Promise<OcrScanRawResponse> {
    const fd = new FormData();
    const blob = new Blob([new Uint8Array(buffer)]);
    fd.append("file", blob, fileName);
    fd.append("engineId", engineId);

    const url = `${this.ocrServiceUrl}/api/v1/ocr/scan/raw`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "x-internal-token": this.internalToken },
      body: fd,
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`ocr-service ${res.status}: ${txt.slice(0, 200)}`);
    }
    return (await res.json()) as OcrScanRawResponse;
  }
}

// V1의 normalizeReceiptOcr 이식 — texts → 영수증 의미 추출
export function normalizeReceiptOcr(raw: OcrScanRawResponse): NormalizedReceipt {
  const texts = raw.texts ?? [];
  const fullText = texts.map((t) => t.text).join("\n");
  const oneLine = texts.map((t) => t.text).join(" ");

  // ── 금액 추출 ────────────────────────────────────
  let amount: number | null = null;
  const amountPatterns = [
    /(?:총\s*영수\s*금액|합계\s*금액|결제\s*금액|승인\s*금액|총\s*금액|받은\s*금액|판매\s*금액|합계|총액|TOTAL|Amount)[\s:￦원]*([0-9,]+)/i,
    /([0-9,]+)\s*원/,
  ];
  for (const re of amountPatterns) {
    const m = oneLine.match(re);
    if (m) {
      const v = parseInt(m[1]!.replace(/,/g, ""), 10);
      if (Number.isFinite(v) && v >= 100) {
        amount = v;
        break;
      }
    }
  }
  if (amount === null) {
    const allNums = [...oneLine.matchAll(/([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,})/g)]
      .map((m) => parseInt(m[1]!.replace(/,/g, ""), 10))
      .filter((n) => Number.isFinite(n) && n >= 1000 && n < 100_000_000);
    if (allNums.length > 0) {
      amount = Math.max(...allNums);
    }
  }

  // ── 가맹점명 추출 ────────────────────────────────
  let merchantName: string | null = null;
  const merchantKeywordPatterns = [
    /(?:사업자|상호|가맹점|판매처|매장|업소|점포)\s*[:：]?\s*([^\n0-9][^\n]{1,30})/,
    /\bMERCHANT\b\s*[:：]?\s*([^\n]{2,30})/i,
  ];
  for (const re of merchantKeywordPatterns) {
    const m = fullText.match(re);
    if (m) {
      const cand = m[1]!.trim().replace(/\s+/g, " ");
      if (cand.length >= 2) {
        merchantName = cand;
        break;
      }
    }
  }
  if (!merchantName) {
    const excludeWords = /^(영수증|Receipt|TAX|INVOICE|결제|승인|카드|일자|번호|시간|총|합계|매출)/i;
    const candidate = texts
      .filter((t) => t.confidence > 0.7)
      .filter((t) => !/^[0-9,.\s:.\-/]+$/.test(t.text))
      .filter((t) => !excludeWords.test(t.text.trim()))
      .find((t) => t.text.trim().length >= 2);
    if (candidate) merchantName = candidate.text.trim().replace(/\s+/g, " ");
  }

  // ── 날짜 추출 ────────────────────────────────────
  let transactedAt: Date | null = null;
  const datePatterns = [
    /(20\d{2})[-./\s년]+(\d{1,2})[-./\s월]+(\d{1,2})[일\s]*(?:(\d{1,2}):(\d{1,2}))?/,
    /(\d{1,2})[-./](\d{1,2})\s+(\d{1,2}):(\d{1,2})/,
  ];
  for (const re of datePatterns) {
    const m = oneLine.match(re);
    if (!m) continue;
    try {
      let candidate: Date;
      if (m[0].length > 10) {
        const y = m[1]!.length === 4 ? m[1] : new Date().getFullYear().toString();
        const mo = (m[1]!.length === 4 ? m[2] : m[1])!.padStart(2, "0");
        const d = (m[1]!.length === 4 ? m[3] : m[2])!.padStart(2, "0");
        const h = (m[4] ?? m[3] ?? "00").padStart(2, "0");
        const mi = (m[5] ?? m[4] ?? "00").padStart(2, "0");
        candidate = new Date(`${y}-${mo}-${d}T${h}:${mi}:00+09:00`);
      } else {
        const y = new Date().getFullYear();
        const mo = m[1]!.padStart(2, "0");
        const d = m[2]!.padStart(2, "0");
        candidate = new Date(`${y}-${mo}-${d}T00:00:00+09:00`);
      }
      if (
        !isNaN(candidate.getTime()) &&
        candidate.getUTCFullYear() >= 2000 &&
        candidate.getUTCFullYear() <= 2100
      ) {
        transactedAt = candidate;
        break;
      }
    } catch {
      // ignore
    }
  }

  const datePart = transactedAt
    ? `${transactedAt.getMonth() + 1}/${transactedAt.getDate()}`
    : "";
  const amountPart = amount ? `${amount.toLocaleString()}원` : "";
  const previewText = [merchantName ?? "?", datePart, amountPart].filter(Boolean).join(" ").trim();

  return { amount, merchantName, transactedAt, fullText, previewText };
}
