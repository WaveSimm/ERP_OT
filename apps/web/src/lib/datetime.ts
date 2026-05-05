/**
 * datetime — 날짜·시간 표시 helper
 *
 * 모든 날짜·시간 표시는 이 helper를 사용해야 합니다.
 *
 * **이유**:
 * - 24시간 표시 강제 (`hour12: false`)
 * - 형식 통일 ("YYYY-MM-DD HH:mm")
 * - locale 변경 시 한 곳에서 처리
 *
 * **사용법**:
 * ```ts
 * import { fmtDateTime24, fmtTime24, fmtDate } from "@/lib/datetime";
 *
 * fmtDateTime24(order.createdAt);     // "2026-05-04 14:30"
 * fmtTime24(entry.startTime);          // "09:30"
 * fmtDate(leave.startDate);            // "2026-05-09"
 * ```
 */

type Input = string | number | Date | null | undefined;

function toDate(v: Input): Date | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * "YYYY-MM-DD" — 날짜만
 */
export function fmtDate(value: Input): string {
  const d = toDate(value);
  if (!d) return "—";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * "HH:mm" 24h — 시간만
 *
 * 입력이 "HH:mm" string이면 그대로 통과 (이미 24h 가정).
 * Date 또는 ISO string이면 시·분 추출.
 */
export function fmtTime24(value: Input): string {
  if (typeof value === "string" && /^\d{1,2}:\d{2}/.test(value)) {
    // "HH:mm" 또는 "HH:mm:ss" → 앞 5자리 ("HH:mm")
    const [h, m] = value.split(":");
    return `${pad2(Number(h))}:${pad2(Number(m))}`;
  }
  const d = toDate(value);
  if (!d) return "—";
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * "YYYY-MM-DD HH:mm" 24h — 날짜+시간 함께
 *
 * options.short: "MM-DD HH:mm" (월/일만, 보통 같은 해 표시 시)
 */
export function fmtDateTime24(value: Input, options?: { short?: boolean }): string {
  const d = toDate(value);
  if (!d) return "—";
  const date = options?.short
    ? `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
    : `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return `${date} ${time}`;
}
