// 휴가/근태 순수 계산 로직 — prisma 런타임 무의존(도메인 계층).
// leave.service.ts 인라인 계산을 그대로 이동(behavior-preserving). 호출부는 위임만.
// CI 함정 회피: @prisma/client 런타임 값(enum) import 금지 — 문자열/자체 리터럴만 사용.

// 전자결재 select 옵션(한국어) → LeaveType enum 매핑
export const KOR_TO_LEAVE_TYPE: Record<string, string> = {
  // 현행 라벨 (v1.7)
  "연차(1일)": "ANNUAL",
  "반차(4H)": "HALF",
  "1/4연차(2H)": "QUARTER",
  "가정의날(1H)": "FAMILY_DAY",
  "가정의날(2H)": "FAMILY_DAY_2H",
  "경조사": "BEREAVEMENT",
  "병가": "SICK",
  "공가": "SPECIAL",
  // legacy 라벨 호환
  "연차": "ANNUAL",
  "반차": "HALF",
  "반차(오전)": "HALF",
  "반차(오후)": "HALF",
  "1/4연차": "QUARTER",
  "1/4차": "QUARTER",
  "가정의날": "FAMILY_DAY",
  "특별휴가": "SPECIAL",
};

export const VALID_ENUM = ["ANNUAL", "HALF", "QUARTER", "FAMILY_DAY", "FAMILY_DAY_2H", "BEREAVEMENT", "SICK", "SPECIAL"];

export function normalizeLeaveType(input: string): string {
  if (!input) return "ANNUAL";
  if (VALID_ENUM.includes(input)) return input;
  return KOR_TO_LEAVE_TYPE[input] ?? "ANNUAL";
}

// 시간 단위(부분) 휴가 — startTime만 받고 endTime은 type별 자동.
// 부분휴가(가정의날·반차·1/4연차)는 실제 근무한 날이므로 출퇴근 기록이 살아있어야 함(fdec6ff).
export const TIME_BASED_TYPES = ["HALF", "QUARTER", "FAMILY_DAY", "FAMILY_DAY_2H"];

// 부분휴가 여부 — true면 종일휴가가 아니라 그 날 실제 출퇴근이 있을 수 있음.
export function isPartialLeave(type: string): boolean {
  return TIME_BASED_TYPES.includes(type);
}

// type별 고정 시간(분). 모든 시간 단위 휴가는 startTime + duration 자동.
export const TYPE_DEFAULT_MINUTES: Record<string, number> = {
  HALF: 240,           // 반차 4시간
  QUARTER: 120,        // 1/4연차 2시간
  FAMILY_DAY: 60,      // 가정의날 1시간
  FAMILY_DAY_2H: 120,  // 가정의날 2시간
};

// "HH:mm" + 분 → "HH:mm" (자정 넘어가는 케이스는 24시간 클램프)
export function addMinutes(startTime: string, minutes: number): string {
  const [h, m] = startTime.split(":").map(Number);
  if ([h, m].some((n) => Number.isNaN(n))) return startTime;
  const total = (h! * 60 + m!) + minutes;
  const clamped = Math.min(total, 24 * 60 - 1); // 23:59 까지
  const hh = String(Math.floor(clamped / 60)).padStart(2, "0");
  const mm = String(clamped % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

// startTime/endTime "HH:mm" 차이를 분 단위로
export function diffMinutes(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return 0;
  return (eh! * 60 + em!) - (sh! * 60 + sm!);
}

// 분 → 일 (1h = 0.125일)
export function minutesToDays(minutes: number): number {
  if (minutes <= 0) return 0;
  return Math.round((minutes / 60) * 0.125 * 1000) / 1000;
}

// type 기준 + 시작시간 → 종료시간 자동 계산 (v1.6: 모든 시간 단위 휴가가 type 고정 duration)
export function resolveTimeRange(type: string, startTime?: string, _endTime?: string): { startTime?: string; endTime?: string; minutes: number } {
  if (!TIME_BASED_TYPES.includes(type)) return { minutes: 0 };
  const def = TYPE_DEFAULT_MINUTES[type] ?? 0;
  if (!startTime) return { minutes: def };
  return { startTime, endTime: addMinutes(startTime, def), minutes: def };
}

// 시간단위 휴가 소요시간(h): 반차4 / 1/4 2 / 가정의날 1·2
export function leaveDurationHours(type: string): number {
  return type === "HALF" ? 4 : type === "QUARTER" ? 2 : type === "FAMILY_DAY" ? 1 : type === "FAMILY_DAY_2H" ? 2 : 0;
}

// "HH:mm" + 시간 → "HH:mm" (24시간 wrap — addMinutes와 달리 클램프 아님)
export function addHours(hhmm: string, hours: number): string {
  const parts = hhmm.split(":").map(Number);
  const h = parts[0] ?? 0, m = parts[1] ?? 0;
  const total = h * 60 + m + Math.round(hours * 60);
  const nh = Math.floor(total / 60) % 24, nm = total % 60;
  return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`;
}

// 휴가 일수 계산: 반차 0.5, 1/4 0.25, 가정의날 0(별도 풀), 그 외 평일 카운트(start~end 포함)
export function calcLeaveDays(type: string, start: Date, end: Date): number {
  if (type === "HALF") return 0.5;
  if (type === "QUARTER") return 0.25;
  // 가정의날: 연차에서 차감하지 않음 — 월 4시간 별도 풀(getFamilyDayUsage)로 관리
  if (type === "FAMILY_DAY" || type === "FAMILY_DAY_2H") return 0;
  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

// 가정의날 월 경계(UTC 기준) — startDate가 UTC 자정으로 저장돼, KST 컨테이너의 new Date(y,m,1)(=전달 15:00Z)와
// 어긋나 월말(예: 6/30) 가정의날이 다음 달 사용량으로 누수되던 버그 수정(9e08947).
export function familyDayMonthRange(ref: Date): { start: Date; end: Date } {
  const y = ref.getFullYear(), m = ref.getMonth();
  return { start: new Date(Date.UTC(y, m, 1)), end: new Date(Date.UTC(y, m + 1, 1)) };
}

// 가정의날 사용 시간 합산 — FAMILY_DAY=1h, FAMILY_DAY_2H=2h.
export function sumFamilyDayHours(rows: Array<{ type: string }>): number {
  return rows.reduce((s, r) => s + (r.type === "FAMILY_DAY_2H" ? 2 : 1), 0);
}

// 연차대체 유효연도 목록 — 1~3월엔 작년분(올해 3월말까지 유효) 포함.
export function substituteYears(ref: Date): number[] {
  const y = ref.getFullYear();
  return ref.getMonth() <= 2 ? [y, y - 1] : [y];
}

// 연차대체 유효 여부 — 발생연도 다음해 4/1 00:00(로컬) 전까지 유효.
export function isSubstituteValid(balanceYear: number, ref: Date): boolean {
  const expiryExclusive = new Date(balanceYear + 1, 3, 1); // (발생연도+1) 4/1 00:00 — 그 전까지 유효
  return ref < expiryExclusive;
}
