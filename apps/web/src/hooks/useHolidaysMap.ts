"use client";

import { useEffect, useState } from "react";
import { calendarApi } from "@/lib/api";

export type HolidayMap = Map<string, string>;

interface UseHolidaysMapOptions {
  /** YYYY-MM-DD. 기본: 올해 1월 1일 */
  from?: string;
  /** YYYY-MM-DD. 기본: 내년 12월 31일 */
  to?: string;
}

/**
 * 회사달력의 공휴일·자체 휴일을 일자별 Map으로 반환.
 * - PUBLIC_HOLIDAY + COMPANY_HOLIDAY 만 휴일로 간주
 * - 다중일 항목은 일자별로 펼쳐서 등록
 *
 * 회사달력 v1.2 — KASI 자동 갱신된 한국 공휴일 포함
 */
export function useHolidaysMap(opts: UseHolidaysMapOptions = {}): HolidayMap {
  const [map, setMap] = useState<HolidayMap>(() => new Map());

  const year = new Date().getFullYear();
  const from = opts.from ?? `${year}-01-01`;
  const to = opts.to ?? `${year + 1}-12-31`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const items = await calendarApi.list({ from, to });
        if (cancelled) return;
        const next = new Map<string, string>();
        for (const e of items as Array<{ type: string; title: string; startDate: string; endDate: string }>) {
          if (e.type !== "PUBLIC_HOLIDAY" && e.type !== "COMPANY_HOLIDAY") continue;
          const start = new Date(e.startDate);
          const end = new Date(e.endDate);
          const cur = new Date(start);
          while (cur <= end) {
            next.set(cur.toISOString().slice(0, 10), e.title);
            cur.setUTCDate(cur.getUTCDate() + 1);
          }
        }
        setMap(next);
      } catch {
        // 휴일 fetch 실패해도 페이지 정상 동작 — 빈 Map 유지
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  return map;
}
