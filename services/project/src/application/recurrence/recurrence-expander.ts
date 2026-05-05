/**
 * 공용자산예약 (2026-05-05)
 * 반복 패턴 → 인스턴스 배열 전개 (조회 시점 가상 전개).
 *
 * recurrence JSON:
 *   { freq: "DAILY"|"WEEKLY"|"MONTHLY",
 *     interval?: 1,                       // 매 N (기본 1)
 *     byWeekday?: ["MON","WED",...],     // WEEKLY 한정
 *     until?: "YYYY-MM-DD",              // 종료일
 *     count?: int,                       // 횟수
 *   }
 *
 * 정책:
 * - until / count 둘 중 하나 필수 (DTO에서 검증)
 * - byWeekday는 WEEKLY 한정. 미지정 시 anchor 요일 기준
 * - DAILY/MONTHLY는 anchor의 월/일/시각 기준
 * - 인스턴스의 (startAt, endAt) 모두 같은 길이로 평행 이동
 */

export interface Recurrence {
  freq: "DAILY" | "WEEKLY" | "MONTHLY";
  interval?: number;
  byWeekday?: Array<"MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN">;
  until?: string; // YYYY-MM-DD
  count?: number;
}

export interface InstanceWindow {
  startAt: Date;
  endAt: Date;
}

const WEEKDAY_TO_INDEX: Record<string, number> = {
  SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6,
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

function addMonths(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCMonth(r.getUTCMonth() + n);
  return r;
}

/**
 * 반복 패턴 + anchor 인스턴스 (parent의 startAt/endAt) → 조회 윈도우 안의 모든 인스턴스.
 *
 * @param rec 반복 패턴
 * @param anchor parent의 startAt / endAt (시리즈 첫 인스턴스)
 * @param windowFrom 조회 시작 (이 시각 이후 인스턴스만 포함)
 * @param windowTo 조회 끝 (이 시각 이전 인스턴스만 포함)
 * @param maxInstances 안전 한계 (기본 1000)
 * @returns 인스턴스 배열 (startAt 오름차순)
 */
export function expand(
  rec: Recurrence,
  anchor: InstanceWindow,
  windowFrom: Date,
  windowTo: Date,
  maxInstances = 1000,
): InstanceWindow[] {
  const result: InstanceWindow[] = [];
  const interval = Math.max(1, rec.interval ?? 1);
  const duration = anchor.endAt.getTime() - anchor.startAt.getTime();

  // until / count 종료 조건
  const untilDate = rec.until ? new Date(rec.until + "T23:59:59.999Z") : null;
  const maxCount = rec.count ?? Infinity;

  if (rec.freq === "DAILY") {
    let current = new Date(anchor.startAt);
    let emitted = 0;
    while (emitted < maxCount && current <= windowTo && (!untilDate || current <= untilDate) && result.length < maxInstances) {
      if (current.getTime() + duration >= windowFrom.getTime()) {
        result.push({ startAt: new Date(current), endAt: new Date(current.getTime() + duration) });
      }
      current = addDays(current, interval);
      emitted++;
    }
    return result;
  }

  if (rec.freq === "WEEKLY") {
    const targetDays =
      rec.byWeekday && rec.byWeekday.length > 0
        ? rec.byWeekday.map((w) => WEEKDAY_TO_INDEX[w]!).sort((a, b) => a - b)
        : [anchor.startAt.getUTCDay()];

    // anchor가 속한 주의 일요일 자정으로 정렬
    const anchorMidnight = new Date(Date.UTC(
      anchor.startAt.getUTCFullYear(),
      anchor.startAt.getUTCMonth(),
      anchor.startAt.getUTCDate(),
    ));
    const anchorWeekStart = addDays(anchorMidnight, -anchorMidnight.getUTCDay());

    // 인스턴스 시각 패턴 (시:분:초 + 밀리초)
    const hh = anchor.startAt.getUTCHours();
    const mm = anchor.startAt.getUTCMinutes();
    const ss = anchor.startAt.getUTCSeconds();
    const ms = anchor.startAt.getUTCMilliseconds();

    let weekStart = anchorWeekStart;
    let weekIdx = 0;
    let emitted = 0;

    while (emitted < maxCount && weekStart <= windowTo && (!untilDate || weekStart <= untilDate) && result.length < maxInstances) {
      if (weekIdx % interval === 0) {
        for (const dow of targetDays) {
          const day = addDays(weekStart, dow);
          const inst = new Date(Date.UTC(
            day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(),
            hh, mm, ss, ms,
          ));
          if (inst < anchor.startAt) continue; // anchor 이전은 스킵
          if (untilDate && inst > untilDate) break;
          if (emitted >= maxCount) break;
          if (inst.getTime() + duration >= windowFrom.getTime() && inst <= windowTo) {
            result.push({ startAt: new Date(inst), endAt: new Date(inst.getTime() + duration) });
          }
          emitted++;
        }
      }
      weekStart = addDays(weekStart, 7);
      weekIdx++;
    }
    return result;
  }

  if (rec.freq === "MONTHLY") {
    let current = new Date(anchor.startAt);
    let emitted = 0;
    while (emitted < maxCount && current <= windowTo && (!untilDate || current <= untilDate) && result.length < maxInstances) {
      if (current.getTime() + duration >= windowFrom.getTime()) {
        result.push({ startAt: new Date(current), endAt: new Date(current.getTime() + duration) });
      }
      current = addMonths(current, interval);
      emitted++;
    }
    return result;
  }

  return result;
}

/**
 * 두 시간 윈도우의 겹침 여부.
 * 인접(endAt === otherStartAt)은 겹침 아님.
 */
export function overlaps(a: InstanceWindow, b: InstanceWindow): boolean {
  return a.startAt < b.endAt && b.startAt < a.endAt;
}

/**
 * recurrence를 사용자 친화 라벨로 변환 (한국어).
 */
export function recurrenceLabel(rec: Recurrence | null | undefined): string {
  if (!rec) return "";
  const interval = rec.interval ?? 1;
  const intervalText = interval > 1 ? ` ${interval}` : "";
  const untilText = rec.until ? ` (~${rec.until})` : rec.count ? ` (${rec.count}회)` : "";

  if (rec.freq === "DAILY") return `매${intervalText}일${untilText}`;
  if (rec.freq === "MONTHLY") return `매${intervalText}월${untilText}`;
  if (rec.freq === "WEEKLY") {
    const dayMap: Record<string, string> = { MON: "월", TUE: "화", WED: "수", THU: "목", FRI: "금", SAT: "토", SUN: "일" };
    const days = (rec.byWeekday ?? []).map((w) => dayMap[w]).filter(Boolean).join(",");
    return `매${intervalText}주${days ? ` ${days}` : ""}${untilText}`;
  }
  return "";
}
