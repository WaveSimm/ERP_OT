/**
 * KASI 한국천문연구원 특일 정보 API 클라이언트
 * - 공공데이터포털: data.go.kr
 * - 엔드포인트: getRestDeInfo (월별 공휴일 조회)
 *
 * 회사달력 v1.2 — 한국 공휴일 자동 갱신용
 */

const KASI_BASE_URL =
  "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo";

const REQUEST_TIMEOUT_MS = 5000;
const RETRY_DELAY_MS = 500;

export class KasiClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 502,
  ) {
    super(message);
    this.name = "KasiClientError";
  }
}

/** KASI API의 단일 휴일 항목을 정규화한 형태 */
export interface KasiHoliday {
  /** YYYY-MM-DD */
  date: string;
  /** "신정", "설날", "대체공휴일" 등 */
  dateName: string;
  /** Y / N — 법정 공휴일 여부 (KASI 응답) */
  isHoliday: boolean;
  /** upsert key — `${locdate}-${dateName}` */
  externalId: string;
}

/** KASI 응답 raw 항목 */
interface KasiRawItem {
  dateKind: string; // "01" 등
  dateName: string;
  isHoliday: "Y" | "N";
  locdate: number; // 20260101
  seq: number;
}

interface KasiRawResponse {
  response: {
    header: { resultCode: string; resultMsg: string };
    body: {
      items: "" | { item: KasiRawItem | KasiRawItem[] };
      numOfRows: number;
      pageNo: number;
      totalCount: number;
    };
  };
}

function locdateToIso(locdate: number): string {
  const s = String(locdate);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

function buildExternalId(locdate: number, dateName: string): string {
  return `${locdate}-${dateName}`;
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class KasiClient {
  constructor(private readonly apiKey: string) {
    if (!apiKey) {
      throw new KasiClientError(
        "KASI_API_KEY_MISSING",
        "KASI_API_KEY 환경변수가 설정되지 않았습니다.",
        500,
      );
    }
  }

  /** 단일 월(1~12) 호출. 공휴일 없는 달은 빈 배열 반환. */
  async getHolidaysByMonth(year: number, month: number): Promise<KasiHoliday[]> {
    if (month < 1 || month > 12) {
      throw new KasiClientError("INVALID_MONTH", `month=${month} 범위 위반`, 400);
    }

    const url = new URL(KASI_BASE_URL);
    url.searchParams.set("serviceKey", this.apiKey);
    url.searchParams.set("solYear", String(year));
    url.searchParams.set("solMonth", String(month).padStart(2, "0"));
    url.searchParams.set("_type", "json");
    url.searchParams.set("numOfRows", "50");

    const raw = await this.callWithRetry(url.toString());
    return this.parseResponse(raw);
  }

  /** 1년치 (12개월) 호출. 부분 실패는 throw. */
  async getHolidaysByYear(year: number): Promise<KasiHoliday[]> {
    const months = Array.from({ length: 12 }, (_, i) => i + 1);
    const results = await Promise.all(months.map((m) => this.getHolidaysByMonth(year, m)));
    return results.flat();
  }

  private async callWithRetry(url: string): Promise<KasiRawResponse> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetchWithTimeout(url, REQUEST_TIMEOUT_MS);
        if (!res.ok) {
          throw new KasiClientError(
            "KASI_HTTP_ERROR",
            `KASI API HTTP ${res.status}`,
            502,
          );
        }
        const json = (await res.json()) as KasiRawResponse;
        const code = json?.response?.header?.resultCode;
        if (code !== "00") {
          throw new KasiClientError(
            "KASI_RESULT_ERROR",
            `KASI API resultCode=${code} msg=${json?.response?.header?.resultMsg ?? ""}`,
            502,
          );
        }
        return json;
      } catch (err) {
        lastError = err;
        if (attempt === 0) {
          await delay(RETRY_DELAY_MS);
        }
      }
    }
    if (lastError instanceof KasiClientError) throw lastError;
    throw new KasiClientError(
      "KASI_UNAVAILABLE",
      `KASI API 호출 실패: ${(lastError as Error)?.message ?? "unknown"}`,
      502,
    );
  }

  private parseResponse(raw: KasiRawResponse): KasiHoliday[] {
    const itemsField = raw.response.body.items;
    if (itemsField === "" || itemsField === undefined || itemsField === null) {
      return [];
    }
    const itemOrArray = itemsField.item;
    const items = Array.isArray(itemOrArray) ? itemOrArray : [itemOrArray];

    return items.map((it) => ({
      date: locdateToIso(it.locdate),
      dateName: it.dateName,
      isHoliday: it.isHoliday === "Y",
      externalId: buildExternalId(it.locdate, it.dateName),
    }));
  }
}
