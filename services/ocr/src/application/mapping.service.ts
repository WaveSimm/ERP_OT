import { TextBlock, BoundingBox } from "../infrastructure/engines/engine.interface.js";

interface TemplateFieldDef {
  key: string;
  label: string;
  aliases: string[];
  type: string; // FieldType enum
  required: boolean;
  erpFieldName: string | null;
}

export interface MappedField {
  fieldKey: string;
  ocrValue: string | null;
  parsedValue: string | null;
  confidence: number;
  boundingBox: BoundingBox | null;
}

interface ValueCandidate {
  text: string;
  confidence: number;
  boundingBox: BoundingBox;
  score: number; // 매칭 점수 (높을수록 좋음)
}

export class MappingService {
  /**
   * OCR 텍스트를 템플릿 필드에 매핑
   * Strategy:
   *   1차) 라벨 직접 탐색 → 근접 값 블록 찾기 (표 형식 지원)
   *   2차) 키-값 쌍 추출 (같은 줄 좌→우, 폴백)
   */
  mapFields(ocrTexts: TextBlock[], templateFields: TemplateFieldDef[]): MappedField[] {
    if (ocrTexts.length === 0) return templateFields.map((f) => this.emptyField(f.key));

    // 모든 라벨 텍스트 수집 (다른 라벨을 값으로 잡지 않기 위해)
    const allLabels = new Set<string>();
    for (const field of templateFields) {
      allLabels.add(field.label.toLowerCase());
      for (const alias of field.aliases) allLabels.add(alias.toLowerCase());
    }

    // 사용된 값 블록 추적 (중복 매핑 방지)
    const usedBlocks = new Set<number>();
    const mapped: MappedField[] = [];

    // 1차: 라벨 직접 탐색
    for (const field of templateFields) {
      const result = this.findByLabelProximity(field, ocrTexts, allLabels, usedBlocks);
      if (result) {
        mapped.push(result);
      } else {
        mapped.push(this.emptyField(field.key));
      }
    }

    // 2차: 미매핑 필드에 대해 키-값 쌍 폴백
    const pairs = this.extractKeyValuePairs(ocrTexts);
    for (let i = 0; i < mapped.length; i++) {
      if (mapped[i]!.ocrValue !== null) continue;
      const field = templateFields[i]!;
      const match = this.findMatchingPair(field, pairs);
      if (match) {
        mapped[i] = {
          fieldKey: field.key,
          ocrValue: match.text,
          parsedValue: this.parseValue(match.text, field.type),
          confidence: match.confidence,
          boundingBox: match.boundingBox,
        };
      }
    }

    return mapped;
  }

  /**
   * 라벨 블록을 찾고, 그 근처에서 값 블록을 탐색
   */
  private findByLabelProximity(
    field: TemplateFieldDef,
    texts: TextBlock[],
    allLabels: Set<string>,
    usedBlocks: Set<number>,
  ): MappedField | null {
    const labels = [field.label, ...field.aliases].map((l) => l.toLowerCase().trim());

    // 1. 라벨 블록 찾기
    const labelMatches: Array<{ index: number; block: TextBlock; matchLen: number }> = [];
    for (let i = 0; i < texts.length; i++) {
      // 앞뒤 숫자/특수문자 제거하여 라벨 텍스트 추출
      const blockText = texts[i]!.text
        .replace(/^[\d\s.:：]+/, "")   // 선행 숫자 제거 (예: "5부가가치세과" → "부가가치세과")
        .replace(/[:：\s\d]+$/g, "")   // 후행 숫자/구두점 제거
        .trim().toLowerCase();
      if (blockText.length === 0) continue;

      for (const label of labels) {
        // 정확 매칭
        if (blockText.includes(label) || label.includes(blockText)) {
          const matchLen = Math.min(blockText.length, label.length);
          if (matchLen >= 2) {
            labelMatches.push({ index: i, block: texts[i]!, matchLen });
          }
        }
        // 퍼지 매칭: 3글자 이상 라벨에서 1글자 오차 허용 (OCR 오인식 대응)
        // 예: "무역거래처" ↔ "우역거래처", "결제금액인도" ↔ "격제금액인도"
        else if (label.length >= 3 && blockText.length >= 3) {
          const fuzzyScore = this.fuzzyMatch(blockText, label);
          if (fuzzyScore >= 0.7) {
            labelMatches.push({ index: i, block: texts[i]!, matchLen: Math.floor(label.length * fuzzyScore) });
          }
        }
      }
    }

    if (labelMatches.length === 0) return null;

    // 가장 긴 매칭 우선
    labelMatches.sort((a, b) => b.matchLen - a.matchLen);

    // 2. 각 라벨 매치에 대해 값 후보 탐색
    for (const labelMatch of labelMatches) {
      const labelBlock = labelMatch.block;
      const candidates: ValueCandidate[] = [];

      for (let i = 0; i < texts.length; i++) {
        if (i === labelMatch.index) continue;
        if (usedBlocks.has(i)) continue;

        const candidate = texts[i]!;
        const candidateText = candidate.text.trim();

        // 빈 텍스트 / 1글자 무시
        if (candidateText.length <= 1 && !/\d/.test(candidateText)) continue;

        // 다른 라벨인 경우 값 후보에서 제외
        const candLower = candidateText
          .replace(/^[\d\s.:：]+/, "")
          .replace(/[:：\s\d]+$/g, "")
          .trim().toLowerCase();
        if (candLower.length >= 2 && this.isKnownLabel(candLower, allLabels)) continue;

        const score = this.proximityScore(labelBlock, candidate, field.type);
        if (score > 0) {
          candidates.push({
            text: candidateText,
            confidence: candidate.confidence,
            boundingBox: candidate.boundingBox,
            score,
          });
        }
      }

      if (candidates.length === 0) continue;

      // 최고 점수 후보 선택
      candidates.sort((a, b) => b.score - a.score);
      const best = candidates[0]!;

      // 값으로 적합한지 검증
      if (this.isValidValue(best.text, field.type)) {
        // 사용된 블록으로 등록
        const usedIdx = texts.findIndex(
          (t) => t.boundingBox.x === best.boundingBox.x && t.boundingBox.y === best.boundingBox.y,
        );
        if (usedIdx >= 0) usedBlocks.add(usedIdx);

        return {
          fieldKey: field.key,
          ocrValue: best.text,
          parsedValue: this.parseValue(best.text, field.type),
          confidence: best.confidence,
          boundingBox: best.boundingBox,
        };
      }
    }

    return null;
  }

  /**
   * 라벨 블록과 값 후보 간의 근접도 점수 계산
   * 높을수록 매칭 가능성 높음
   */
  private proximityScore(label: TextBlock, candidate: TextBlock, fieldType: string): number {
    const lb = label.boundingBox;
    const cb = candidate.boundingBox;

    const dx = cb.x - (lb.x + lb.width); // 라벨 우측 끝 → 후보 좌측
    const dy = cb.y - lb.y;

    // 후보가 라벨보다 왼쪽에 있으면 (다른 열) 점수 0
    if (cb.x < lb.x - 0.05) return 0;

    // 후보가 라벨보다 너무 먼 위에 있으면 점수 0
    if (dy < -0.01) return 0;

    // 너무 먼 아래 (3줄 이상) 면 점수 0
    if (dy > 0.05) return 0;

    // 너무 멀리 오른쪽이면 점수 0
    if (dx > 0.6) return 0;

    let score = 0;

    // ── 패턴 A: 같은 줄 우측 (label: value) ──
    if (Math.abs(dy) < 0.008) {
      if (dx > -0.02 && dx < 0.4) {
        score = 100 - Math.abs(dx) * 100;
      }
    }

    // ── 패턴 B: 바로 아래 (표 형식: 헤더 아래 값) ──
    if (dy > 0.005 && dy < 0.025) {
      const xOverlap = Math.abs(cb.x - lb.x);
      if (xOverlap < 0.15) {
        score = Math.max(score, 90 - xOverlap * 200 - dy * 500);
      }
    }

    // ── 패턴 C: 우하단 (표 형식: 라벨 우측 아래) ──
    if (dy > 0.003 && dy < 0.025 && dx > -0.05 && dx < 0.3) {
      const dist = Math.sqrt(dx * dx + dy * dy);
      score = Math.max(score, 80 - dist * 200);
    }

    // 타입별 보너스: 숫자 필드인데 숫자가 들어있으면 가산
    if ((fieldType === "NUMBER" || fieldType === "CURRENCY") && /\d/.test(candidate.text)) {
      score += 15;
    }
    if (fieldType === "DATE" && /\d{4}[\/\-.]?\d{2}[\/\-.]?\d{2}/.test(candidate.text)) {
      score += 20;
    }

    return score;
  }

  /**
   * 퍼지 문자열 매칭 (OCR 오인식 보정)
   * 짧은 쪽 기준으로 일치 비율 반환 (0~1)
   */
  private fuzzyMatch(a: string, b: string): number {
    // a가 b를 포함하거나 그 반대면 1.0
    if (a.includes(b) || b.includes(a)) return 1.0;

    // 길이가 비슷한 경우 글자별 비교
    const shorter = a.length <= b.length ? a : b;
    const longer = a.length <= b.length ? b : a;

    // 길이 차이가 너무 크면 포기
    if (shorter.length < longer.length * 0.5) return 0;

    // 슬라이딩 윈도우: longer 안에서 shorter와 가장 잘 맞는 위치 찾기
    let bestMatch = 0;
    for (let offset = 0; offset <= longer.length - shorter.length; offset++) {
      let matches = 0;
      for (let i = 0; i < shorter.length; i++) {
        if (shorter[i] === longer[offset + i]) matches++;
      }
      bestMatch = Math.max(bestMatch, matches / shorter.length);
    }

    return bestMatch;
  }

  /**
   * 텍스트가 알려진 라벨인지 확인
   */
  private isKnownLabel(text: string, allLabels: Set<string>): boolean {
    for (const label of allLabels) {
      if (text.includes(label) || label.includes(text)) {
        if (Math.min(text.length, label.length) >= 2) return true;
      }
    }
    // 일반적인 문서 라벨 키워드
    const commonLabels = [
      "번호", "일자", "일시", "구분", "형태", "증명", "기관", "장소",
      "계획", "요건", "세율", "감면", "관세법",
    ];
    for (const cl of commonLabels) {
      if (text.includes(cl)) return true;
    }
    return false;
  }

  /**
   * 값으로 적합한지 기본 검증
   */
  private isValidValue(text: string, fieldType: string): boolean {
    if (!text || text.length === 0) return false;

    switch (fieldType) {
      case "NUMBER":
      case "CURRENCY": {
        // 숫자가 포함되어야 하고, 금액 형식이어야 함
        if (!/\d/.test(text)) return false;
        // HS코드/분류코드 패턴 제외: "1-97-1-01-5A" 같은 형식
        if (/^\d+-\d+-\d+/.test(text.trim())) return false;
        // 알파벳 코드가 너무 많으면 제외 (코드/ID 형식)
        const alphaCount = (text.match(/[a-zA-Z]/g) || []).length;
        const digitCount = (text.match(/\d/g) || []).length;
        if (alphaCount > digitCount && digitCount < 3) return false;
        return true;
      }
      case "DATE":
        // 날짜 형식: 연속 숫자 2개 이상 (최소 연-월 또는 월/일)
        // "Page 1 of 1" 같은 텍스트 제외
        return /\d{2,}/.test(text) || /\d+[\/\-.년월]\d+/.test(text);
      case "BIZ_NO":
        return /\d{3}/.test(text);
      default:
        return true;
    }
  }

  private emptyField(fieldKey: string): MappedField {
    return { fieldKey, ocrValue: null, parsedValue: null, confidence: 0, boundingBox: null };
  }

  /**
   * 문서 유형 자동 판별
   */
  detectDocumentType(ocrTexts: TextBlock[]): string | null {
    const fullText = ocrTexts.map((t) => t.text).join(" ");

    const rules: Array<{ code: string; keywords: string[]; weight: number }> = [
      { code: "IMPORT_DECLARATION", keywords: ["수입신고필증", "수입면장", "신고번호", "관세", "세관"], weight: 1 },
      { code: "TAX_INVOICE", keywords: ["세금계산서", "공급가액", "세액", "공급받는자", "공급자"], weight: 1 },
      { code: "QUOTATION", keywords: ["견적서", "견적번호", "유효기간", "견적금액"], weight: 1 },
      { code: "INVOICE", keywords: ["Invoice", "Invoice No", "Total Amount", "Bill To"], weight: 1 },
      { code: "DELIVERY_NOTE", keywords: ["거래명세서", "거래명세표", "명세서번호"], weight: 1 },
      { code: "PURCHASE_ORDER", keywords: ["발주서", "발주번호", "Purchase Order", "P.O."], weight: 1 },
    ];

    let bestCode: string | null = null;
    let bestScore = 0;

    for (const rule of rules) {
      const score = rule.keywords.reduce((sum, kw) => {
        return sum + (fullText.includes(kw) ? rule.weight : 0);
      }, 0);
      if (score > bestScore) {
        bestScore = score;
        bestCode = rule.code;
      }
    }

    return bestScore >= 1 ? bestCode : null;
  }

  /**
   * 키-값 쌍 추출 (폴백용 — 같은 줄 좌→우)
   */
  private extractKeyValuePairs(texts: TextBlock[]): ValueCandidate[] {
    const pairs: ValueCandidate[] = [];
    if (texts.length === 0) return pairs;

    const lineThreshold = 0.008; // 정규화 좌표 기준 0.8% (기존 2%에서 축소)
    const lines: TextBlock[][] = [];
    const sorted = [...texts].sort((a, b) => a.boundingBox.y - b.boundingBox.y);

    let currentLine: TextBlock[] = [sorted[0]!];
    for (let i = 1; i < sorted.length; i++) {
      const block = sorted[i]!;
      const prevY = currentLine[0]!.boundingBox.y;
      if (Math.abs(block.boundingBox.y - prevY) < lineThreshold) {
        currentLine.push(block);
      } else {
        lines.push(currentLine.sort((a, b) => a.boundingBox.x - b.boundingBox.x));
        currentLine = [block];
      }
    }
    lines.push(currentLine.sort((a, b) => a.boundingBox.x - b.boundingBox.x));

    for (const line of lines) {
      for (let i = 0; i < line.length - 1; i++) {
        const keyBlock = line[i]!;
        const valueBlock = line[i + 1]!;

        const keyText = keyBlock.text.replace(/[:：\s]+$/, "").trim();
        if (keyText.length >= 2 && keyText.length <= 20) {
          pairs.push({
            text: valueBlock.text.trim(),
            confidence: valueBlock.confidence,
            boundingBox: valueBlock.boundingBox,
            score: 50, // 폴백 점수
          });
        }
      }
    }

    return pairs;
  }

  /**
   * 템플릿 필드와 매칭되는 키-값 쌍 찾기 (폴백)
   */
  private findMatchingPair(field: TemplateFieldDef, pairs: ValueCandidate[]): ValueCandidate | null {
    // 폴백은 사용하지 않음 — 1차 라벨 탐색으로 충분
    return null;
  }

  /**
   * 타입별 값 변환
   */
  private parseValue(raw: string | undefined | null, type: string): string | null {
    if (!raw) return null;

    switch (type) {
      case "NUMBER":
      case "CURRENCY":
        return this.parseNumber(raw);
      case "DATE":
        return this.parseDate(raw);
      case "BIZ_NO":
        return this.parseBizNo(raw);
      default:
        return raw.trim();
    }
  }

  private parseNumber(raw: string): string {
    const cleaned = raw.replace(/[,\s원₩$€£\u00a5]/g, "");
    const match = cleaned.match(/-?[\d.]+/);
    return match ? match[0] : raw.trim();
  }

  private parseDate(raw: string): string {
    let cleaned = raw.replace(/[년월]/g, "-").replace(/[일\s]/g, "").trim();
    cleaned = cleaned.replace(/\./g, "-");
    cleaned = cleaned.replace(/\//g, "-");

    const match = cleaned.match(/^(\d{2})-(\d{1,2})-(\d{1,2})$/);
    if (match) {
      const year = parseInt(match[1]!) + 2000;
      return `${year}-${match[2]!.padStart(2, "0")}-${match[3]!.padStart(2, "0")}`;
    }

    const fullMatch = cleaned.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (fullMatch) {
      return `${fullMatch[1]!}-${fullMatch[2]!.padStart(2, "0")}-${fullMatch[3]!.padStart(2, "0")}`;
    }

    return raw.trim();
  }

  private parseBizNo(raw: string): string {
    const digits = raw.replace(/\D/g, "");
    if (digits.length === 10) {
      return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
    }
    return raw.trim();
  }
}
