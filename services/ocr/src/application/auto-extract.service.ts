/**
 * Auto-Extract Service (개발 진단 전용)
 *
 * 템플릿 없이 OCR 텍스트에서 인식 가능한 모든 라벨-값 쌍을 추출.
 * 목적: OCR 엔진의 실제 인식률 평가 + 현업 요구 필드 탐색.
 *
 * 전략:
 *   1) 규칙 기반 KV 추출 (라벨:값, 파이프, 공간 정렬)
 *   2) 타입 감지 (날짜·금액·전화·이메일·식별자·텍스트)
 *   3) 공간 매칭: 같은 줄(label-right) + 바로 아래 줄(label-below)
 *   4) LLM 옵션 보완 (ANTHROPIC_API_KEY 설정 시)
 */
import type { OcrRawResult, BoundingBox } from "../infrastructure/engines/engine.interface.js";

export interface ExtractedKV {
  label: string;
  value: string;
  type: "date" | "money" | "phone" | "email" | "identifier" | "quantity" | "percent" | "text";
  currency?: string;
  unit?: string;
  confidence: number;
  source: "rule" | "llm";
  labelBBox?: BoundingBox;
  valueBBox?: BoundingBox;
}

export interface AutoExtractResult {
  kvPairs: ExtractedKV[];
  unmatchedText: string[];
  stats: {
    totalTextBlocks: number;
    matchedBlocks: number;
    ruleExtracted: number;
    llmExtracted: number;
    avgConfidence: number;
    processingMs: number;
  };
  documentTypeHint?: string;
  fullText: string; // 전체 텍스트 (원본 정렬)
}

// ─── 타입 감지 정규식 ─────────────────────────────────────────────────────────
const PATTERNS = {
  date: [
    /^\d{4}[-./]\d{1,2}[-./]\d{1,2}/,
    /^\d{1,2}[-./]\d{1,2}[-./]\d{2,4}/,
    /^\d{4}년\s*\d{1,2}월\s*\d{1,2}일/,
  ],
  money: [
    /^([₩$€¥￥]|USD|KRW|EUR|JPY|CNY)\s*[\d,]+(\.\d+)?/i,
    /^[\d,]+(\.\d+)?\s*(원|달러|엔|위안|USD|KRW|EUR|JPY|CNY)$/i,
    /^[\d,]+(\.\d+)?\s*$/, // 숫자만 (금액 컬럼 맥락으로 판단)
  ],
  phone: [
    /^(\+?82[-\s]?)?0?1[0-9][-\s]?\d{3,4}[-\s]?\d{4}$/,
    /^0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4}$/,
    /^\+?\d{1,3}[-\s]?\d{2,4}[-\s]?\d{3,4}[-\s]?\d{4}$/,
  ],
  email: [/^[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}$/],
  identifier: [
    /^[A-Z]{2,}-?\d{2,}-?\d{0,}/, // INV-2026-001, AS-2026-0387
    /^\d{3}-\d{2}-\d{5,}$/, // 사업자번호
  ],
  percent: [/^\d+(\.\d+)?\s*%$/],
  quantity: [/^\d+(\.\d+)?\s*(EA|PCS|개|건|대|kg|g|m|cm|mm|L|ml|㎡|㎥)$/i],
};

// ─── 노이즈 라벨 필터 (숫자/기호만/너무 짧은 라벨 제외) ──────────────────────
function isValidLabel(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2 || trimmed.length > 40) return false;
  if (/^[\d\s\-.,:;()[\]{}|/\\]+$/.test(trimmed)) return false; // 숫자/기호만
  if (/^(그리고|또는|및|그|이|저|의|를|을|은|는|가|이다|입니다)$/.test(trimmed)) return false; // 조사/부사
  return true;
}

type TypeInfo = { type: ExtractedKV["type"]; currency?: string; unit?: string };

function detectType(value: string): TypeInfo {
  const v = value.trim();
  if (!v) return { type: "text" };
  for (const p of PATTERNS.date) if (p.test(v)) return { type: "date" };
  for (const p of PATTERNS.email) if (p.test(v)) return { type: "email" };
  for (const p of PATTERNS.phone) if (p.test(v)) return { type: "phone" };
  for (const p of PATTERNS.percent) if (p.test(v)) return { type: "percent" };
  for (const p of PATTERNS.identifier) if (p.test(v)) return { type: "identifier" };

  const qtyMatch = v.match(/^(\d+(?:\.\d+)?)\s*(EA|PCS|개|건|대|kg|g|m|cm|mm|L|ml|㎡|㎥)$/i);
  if (qtyMatch && qtyMatch[2]) return { type: "quantity", unit: qtyMatch[2] };

  const moneyMatch = v.match(/^([₩$€¥￥]|USD|KRW|EUR|JPY|CNY)\s*([\d,]+(?:\.\d+)?)/i);
  if (moneyMatch && moneyMatch[1]) return { type: "money", currency: moneyMatch[1].toUpperCase() };

  const moneyKo = v.match(/^([\d,]+(?:\.\d+)?)\s*(원|달러|엔|위안)$/);
  if (moneyKo && moneyKo[2]) {
    const map: Record<string, string> = { 원: "KRW", 달러: "USD", 엔: "JPY", 위안: "CNY" };
    const cur = map[moneyKo[2]];
    if (cur) return { type: "money", currency: cur };
  }

  if (/^[\d,]+(\.\d+)?$/.test(v) && v.length > 3) {
    return { type: "money" }; // 콤마 있는 숫자는 보통 금액
  }

  return { type: "text" };
}

// ─── 분리자 기반 인라인 KV 추출 ("라벨: 값", "라벨 | 값") ───────────────────
const INLINE_SEPARATORS = [
  /^(.+?)\s*[:：]\s*(.+)$/,
  /^(.+?)\s*[|｜]\s*(.+)$/,
  /^(.+?)\s{2,}(.+)$/, // 2칸 이상 공백 (표 컬럼)
];

function extractInline(text: string): Array<{ label: string; value: string }> {
  const results: Array<{ label: string; value: string }> = [];
  for (const pattern of INLINE_SEPARATORS) {
    const m = text.match(pattern);
    if (m) {
      const label = m[1]!.trim();
      const value = m[2]!.trim();
      if (isValidLabel(label) && value.length > 0) {
        results.push({ label, value });
        return results; // 첫 매칭만 사용
      }
    }
  }
  return results;
}

// ─── 공간 매칭: 라벨 블록 바로 오른쪽/아래 값 블록 탐색 ──────────────────────
interface Block {
  text: string;
  bbox: BoundingBox; // {x, y, width, height}
  conf: number;
}

function bboxesOverlap1D(a0: number, a1: number, b0: number, b1: number): number {
  const ov = Math.min(a1, b1) - Math.max(a0, b0);
  const len = Math.min(a1 - a0, b1 - b0);
  return len > 0 ? ov / len : 0;
}

function findSpatialValue(labelBlock: Block, candidates: Block[], usedIdx: Set<number>): { block: Block; idx: number } | null {
  const lx0 = labelBlock.bbox.x;
  const ly0 = labelBlock.bbox.y;
  const lx1 = lx0 + labelBlock.bbox.width;
  const ly1 = ly0 + labelBlock.bbox.height;
  const labelCenterY = (ly0 + ly1) / 2;
  const labelHeight = labelBlock.bbox.height;

  // 1. 같은 줄 오른쪽 (vertical overlap > 50%)
  let best: { block: Block; idx: number; dist: number } | null = null;
  for (let i = 0; i < candidates.length; i++) {
    if (usedIdx.has(i)) continue;
    const c = candidates[i]!;
    const cx0 = c.bbox.x;
    const cy0 = c.bbox.y;
    const cx1 = cx0 + c.bbox.width;
    const cy1 = cy0 + c.bbox.height;
    const yOverlap = bboxesOverlap1D(ly0, ly1, cy0, cy1);
    if (yOverlap > 0.5 && cx0 > lx1) {
      const dist = cx0 - lx1;
      if (dist < labelHeight * 15 && (!best || dist < best.dist)) {
        best = { block: c, idx: i, dist };
      }
    }
  }
  if (best) return best;

  // 2. 바로 아래 줄 (horizontal overlap > 30%, vertical gap < 2.5x label height)
  for (let i = 0; i < candidates.length; i++) {
    if (usedIdx.has(i)) continue;
    const c = candidates[i]!;
    const cx0 = c.bbox.x;
    const cy0 = c.bbox.y;
    const cx1 = cx0 + c.bbox.width;
    const cCenterY = cy0 + c.bbox.height / 2;
    const xOverlap = bboxesOverlap1D(lx0, lx1, cx0, cx1);
    const gap = cCenterY - labelCenterY;
    if (xOverlap > 0.3 && gap > labelHeight * 0.3 && gap < labelHeight * 2.5) {
      const dist = gap;
      if (!best || dist < best.dist) {
        best = { block: c, idx: i, dist };
      }
    }
  }
  return best;
}

export class AutoExtractService {
  /**
   * 규칙 기반 자동 KV 추출
   */
  extractByRules(ocr: OcrRawResult): AutoExtractResult {
    const started = Date.now();
    const texts = ocr.texts || [];
    const blocks: Block[] = texts.map((t: any) => ({
      text: (t.text || "").trim(),
      bbox: t.boundingBox || { x: 0, y: 0, width: 0, height: 0 },
      conf: t.confidence ?? 0.9,
    }));

    const kvPairs: ExtractedKV[] = [];
    const matchedBlockIdx = new Set<number>();
    const usedAsValue = new Set<number>();

    // A. 인라인 KV 추출 (한 블록 안에 "라벨: 값")
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i]!;
      if (!block.text) continue;
      const inlineMatches = extractInline(block.text);
      for (const { label, value } of inlineMatches) {
        const typeInfo = detectType(value);
        const kv: ExtractedKV = {
          label,
          value,
          type: typeInfo.type,
          confidence: block.conf,
          source: "rule",
          labelBBox: block.bbox,
          valueBBox: block.bbox,
        };
        if (typeInfo.currency) kv.currency = typeInfo.currency;
        if (typeInfo.unit) kv.unit = typeInfo.unit;
        kvPairs.push(kv);
        matchedBlockIdx.add(i);
      }
    }

    // B. 공간 매칭 KV (라벨만 있는 블록 → 오른쪽/아래 블록이 값)
    for (let i = 0; i < blocks.length; i++) {
      if (matchedBlockIdx.has(i) || usedAsValue.has(i)) continue;
      const block = blocks[i]!;
      if (!isValidLabel(block.text)) continue;

      // 라벨로 끝나는 패턴 감지 (~:, ~명, ~일, ~번호, ~액, ~량, ~자 등)
      const looksLikeLabel =
        /[:：]$/.test(block.text) ||
        /(명|일자|일|번호|번|액|량|자|율|비|수|부|처|처명|사항|원|금액|비용|시간|기한)$/.test(block.text);

      const cleanLabel = block.text.replace(/[:：]\s*$/, "").trim();

      if (looksLikeLabel) {
        const match = findSpatialValue(block, blocks, new Set([...matchedBlockIdx, ...usedAsValue, i]));
        if (match && match.block.text) {
          const typeInfo = detectType(match.block.text);
          const kv: ExtractedKV = {
            label: cleanLabel,
            value: match.block.text,
            type: typeInfo.type,
            confidence: Math.min(block.conf, match.block.conf) * 0.9,
            source: "rule",
            labelBBox: block.bbox,
            valueBBox: match.block.bbox,
          };
          if (typeInfo.currency) kv.currency = typeInfo.currency;
          if (typeInfo.unit) kv.unit = typeInfo.unit;
          kvPairs.push(kv);
          matchedBlockIdx.add(i);
          usedAsValue.add(match.idx);
        }
      }
    }

    // 미매칭 텍스트 수집
    const unmatched: string[] = [];
    for (let i = 0; i < blocks.length; i++) {
      if (!matchedBlockIdx.has(i) && !usedAsValue.has(i)) {
        const t = blocks[i]!.text;
        if (t && t.length > 1) unmatched.push(t);
      }
    }

    // 문서 유형 힌트 추론 (키워드 기반)
    const fullText = blocks.map(b => b.text).join("\n");
    const documentTypeHint = inferDocumentType(fullText, kvPairs);

    const avgConf = kvPairs.length > 0
      ? kvPairs.reduce((s, k) => s + k.confidence, 0) / kvPairs.length
      : 0;

    const result: AutoExtractResult = {
      kvPairs,
      unmatchedText: unmatched,
      stats: {
        totalTextBlocks: blocks.length,
        matchedBlocks: matchedBlockIdx.size + usedAsValue.size,
        ruleExtracted: kvPairs.length,
        llmExtracted: 0,
        avgConfidence: Number(avgConf.toFixed(3)),
        processingMs: Date.now() - started,
      },
      fullText,
    };
    if (documentTypeHint) result.documentTypeHint = documentTypeHint;
    return result;
  }

  /**
   * LLM 보완 추출 — ERP 전체에서 비활성화 (2026-05-11).
   * Claude Vision/Anthropic 사용 금지 정책. 향후 재활성화 시 git history에서 복구.
   */
  async enhanceWithLLM(ruleResult: AutoExtractResult): Promise<AutoExtractResult> {
    return ruleResult;
  }
}

// ─── 문서 유형 힌트 추론 ─────────────────────────────────────────────────────
function inferDocumentType(fullText: string, kvs: ExtractedKV[]): string | undefined {
  const text = fullText.toLowerCase();
  const labels = kvs.map(k => k.label.toLowerCase()).join(" ");

  const hits: Record<string, number> = {};
  const score = (key: string, patterns: string[]) => {
    hits[key] = patterns.filter(p => text.includes(p) || labels.includes(p)).length;
  };

  score("invoice", ["invoice", "인보이스", "송장", "amount", "금액", "qty"]);
  score("contract", ["계약", "contract", "을", "갑", "체결", "당사자"]);
  score("purchase_order", ["발주", "purchase order", "po no", "주문번호"]);
  score("customs", ["관세", "customs", "hs code", "수입신고"]);
  score("receipt", ["영수", "receipt", "결제", "카드"]);
  score("quotation", ["견적", "quotation", "quote"]);
  score("report", ["보고서", "report", "검수", "점검"]);

  const [topKey, topScore] = Object.entries(hits).sort((a, b) => b[1] - a[1])[0] || ["", 0];
  return topScore > 0 ? topKey : undefined;
}
