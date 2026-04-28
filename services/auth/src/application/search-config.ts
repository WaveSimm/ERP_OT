/**
 * 검색개선 PDCA — 하이브리드 검색 가중치/컷오프 설정
 * 환경변수로만 조정. startup 시 1회 검증.
 */

function readFloatEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;
  const v = parseFloat(raw);
  if (Number.isNaN(v) || v < 0 || v > 1) {
    throw new Error(`[search-config] ${name} must be float in [0,1], got: ${raw}`);
  }
  return v;
}

export interface SearchConfig {
  embedWeight: number;
  keywordWeight: number;
  minScore: number;
  titleExactBonus: number;
  contentExactBonus: number;
  titleTrgmWeight: number;
  contentTrgmWeight: number;
  /** ILIKE 정확 매칭 시 추가되는 절대 보너스 (가중치 곱셈 X). bge-m3 점수 분포가 좁은 환경에서 정확 매칭 글이 명확히 상위에 오도록 함. */
  keywordMatchBonus: number;
}

export const searchConfig: SearchConfig = {
  embedWeight:        readFloatEnv("SEARCH_EMBED_WEIGHT", 0.6),
  keywordWeight:      readFloatEnv("SEARCH_KEYWORD_WEIGHT", 0.4),
  minScore:           readFloatEnv("SEARCH_MIN_SCORE", 0.35),
  titleExactBonus:    readFloatEnv("SEARCH_TITLE_EXACT_BONUS", 0.30),
  contentExactBonus:  readFloatEnv("SEARCH_CONTENT_EXACT_BONUS", 0.15),
  titleTrgmWeight:    readFloatEnv("SEARCH_TITLE_TRGM_WEIGHT", 0.20),
  contentTrgmWeight:  readFloatEnv("SEARCH_CONTENT_TRGM_WEIGHT", 0.10),
  keywordMatchBonus:  readFloatEnv("SEARCH_KEYWORD_MATCH_BONUS", 0.20),
};

const sumWeights = searchConfig.embedWeight + searchConfig.keywordWeight;
if (Math.abs(sumWeights - 1.0) > 0.001) {
  throw new Error(
    `[search-config] SEARCH_EMBED_WEIGHT + SEARCH_KEYWORD_WEIGHT must equal 1.0 (got ${sumWeights})`,
  );
}
