import { describe, it, expect } from "vitest";
import {
  normalizeLeaveType,
  isPartialLeave,
  TIME_BASED_TYPES,
  addMinutes,
  addHours,
  diffMinutes,
  minutesToDays,
  resolveTimeRange,
  leaveDurationHours,
  calcLeaveDays,
  familyDayMonthRange,
  sumFamilyDayHours,
  substituteYears,
  isSubstituteValid,
} from "./leave-calc";

// 휴가/근태 순수 계산 안전망 — 시범 릴리즈 기간 버그 최다 지점.
// prisma 런타임 무의존(문자열/자체 리터럴만). 회귀 고정: 9e08947, fdec6ff.

describe("familyDayMonthRange — 9e08947 회귀(월말 가정의날 누수)", () => {
  // 로컬 컴포넌트로 ref를 구성해 실행 TZ에 무관하게 검증(getMonth/getFullYear는 로컬).
  const june = new Date(2026, 5, 15);  // 2026-06
  const july = new Date(2026, 6, 15);  // 2026-07

  it("월 경계를 UTC 자정으로 정렬한다", () => {
    const r = familyDayMonthRange(june);
    expect(r.start.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  // 6/30 가정의날은 startDate가 UTC 자정(2026-06-30T00:00:00Z)으로 저장된다.
  const leave630 = new Date(Date.UTC(2026, 5, 30));

  it("월말(6/30) 가정의날은 6월 사용량에 집계된다(다음달로 누수 금지)", () => {
    const { start, end } = familyDayMonthRange(june);
    expect(leave630 >= start && leave630 < end).toBe(true);
  });

  it("6/30 가정의날은 7월 사용량에 잡히지 않는다", () => {
    const { start, end } = familyDayMonthRange(july);
    expect(leave630 >= start && leave630 < end).toBe(false);
  });

  it("월초(7/1) 가정의날은 7월에만 집계된다", () => {
    const leave701 = new Date(Date.UTC(2026, 6, 1));
    const jun = familyDayMonthRange(june);
    const jul = familyDayMonthRange(july);
    expect(leave701 >= jun.start && leave701 < jun.end).toBe(false);
    expect(leave701 >= jul.start && leave701 < jul.end).toBe(true);
  });

  it("12월 → 다음 해 1월로 end가 넘어간다", () => {
    const dec = familyDayMonthRange(new Date(2026, 11, 10));
    expect(dec.start.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(dec.end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("sumFamilyDayHours — 가정의날 사용 시간 합산", () => {
  it("FAMILY_DAY=1h, FAMILY_DAY_2H=2h 합산", () => {
    expect(sumFamilyDayHours([{ type: "FAMILY_DAY" }])).toBe(1);
    expect(sumFamilyDayHours([{ type: "FAMILY_DAY_2H" }])).toBe(2);
    expect(sumFamilyDayHours([{ type: "FAMILY_DAY" }, { type: "FAMILY_DAY_2H" }])).toBe(3);
  });
  it("빈 목록은 0", () => {
    expect(sumFamilyDayHours([])).toBe(0);
  });
});

describe("isPartialLeave — fdec6ff 회귀(부분휴가 날 출퇴근 유지)", () => {
  // 부분휴가(가정의날·반차·1/4연차)는 실제 근무한 날 → true여야 캡스 동기화가 출퇴근을 스킵하지 않음.
  it("부분휴가는 true", () => {
    expect(isPartialLeave("HALF")).toBe(true);
    expect(isPartialLeave("QUARTER")).toBe(true);
    expect(isPartialLeave("FAMILY_DAY")).toBe(true);
    expect(isPartialLeave("FAMILY_DAY_2H")).toBe(true);
  });
  it("종일휴가는 false(출퇴근 없음)", () => {
    expect(isPartialLeave("ANNUAL")).toBe(false);
    expect(isPartialLeave("SICK")).toBe(false);
    expect(isPartialLeave("BEREAVEMENT")).toBe(false);
    expect(isPartialLeave("SPECIAL")).toBe(false);
    expect(isPartialLeave("SUBSTITUTE")).toBe(false);
  });
  it("TIME_BASED_TYPES와 일치", () => {
    expect(TIME_BASED_TYPES).toEqual(["HALF", "QUARTER", "FAMILY_DAY", "FAMILY_DAY_2H"]);
  });
});

describe("calcLeaveDays — 휴가 일수 계산", () => {
  it("반차 0.5 / 1/4연차 0.25", () => {
    const d = new Date(2026, 5, 1);
    expect(calcLeaveDays("HALF", d, d)).toBe(0.5);
    expect(calcLeaveDays("QUARTER", d, d)).toBe(0.25);
  });
  it("가정의날은 연차 차감 없음(0)", () => {
    const d = new Date(2026, 5, 1);
    expect(calcLeaveDays("FAMILY_DAY", d, d)).toBe(0);
    expect(calcLeaveDays("FAMILY_DAY_2H", d, d)).toBe(0);
  });
  it("연차: 평일만 카운트(주말 제외)", () => {
    // 2026-06-01은 월요일. 월~금(6/1~6/5)=5일.
    expect(calcLeaveDays("ANNUAL", new Date(2026, 5, 1), new Date(2026, 5, 5))).toBe(5);
    // 월~일(6/1~6/7): 토·일 제외 → 여전히 5일.
    expect(calcLeaveDays("ANNUAL", new Date(2026, 5, 1), new Date(2026, 5, 7))).toBe(5);
    // 단일 평일(월)=1.
    expect(calcLeaveDays("ANNUAL", new Date(2026, 5, 1), new Date(2026, 5, 1))).toBe(1);
    // 토·일만(6/6~6/7)=0.
    expect(calcLeaveDays("ANNUAL", new Date(2026, 5, 6), new Date(2026, 5, 7))).toBe(0);
  });
});

describe("resolveTimeRange — 시간단위 휴가 시각 자동 계산", () => {
  it("반차(HALF): startTime + 240분", () => {
    expect(resolveTimeRange("HALF", "13:30")).toEqual({ startTime: "13:30", endTime: "17:30", minutes: 240 });
  });
  it("가정의날 1H: +60분", () => {
    expect(resolveTimeRange("FAMILY_DAY", "17:30")).toEqual({ startTime: "17:30", endTime: "18:30", minutes: 60 });
  });
  it("가정의날 2H: +120분", () => {
    expect(resolveTimeRange("FAMILY_DAY_2H", "16:30")).toEqual({ startTime: "16:30", endTime: "18:30", minutes: 120 });
  });
  it("startTime 없으면 default minutes만", () => {
    expect(resolveTimeRange("HALF")).toEqual({ minutes: 240 });
  });
  it("시간단위 아닌 타입은 minutes 0", () => {
    expect(resolveTimeRange("ANNUAL", "09:00")).toEqual({ minutes: 0 });
  });
});

describe("minutesToDays — 분 → 일(1h=0.125일)", () => {
  it("240분=0.5일, 120분=0.25일, 60분=0.125일", () => {
    expect(minutesToDays(240)).toBe(0.5);
    expect(minutesToDays(120)).toBe(0.25);
    expect(minutesToDays(60)).toBe(0.125);
  });
  it("0 이하는 0", () => {
    expect(minutesToDays(0)).toBe(0);
    expect(minutesToDays(-30)).toBe(0);
  });
});

describe("leaveDurationHours — 시간단위 소요시간", () => {
  it("HALF 4 / QUARTER 2 / FAMILY_DAY 1 / FAMILY_DAY_2H 2 / 그외 0", () => {
    expect(leaveDurationHours("HALF")).toBe(4);
    expect(leaveDurationHours("QUARTER")).toBe(2);
    expect(leaveDurationHours("FAMILY_DAY")).toBe(1);
    expect(leaveDurationHours("FAMILY_DAY_2H")).toBe(2);
    expect(leaveDurationHours("ANNUAL")).toBe(0);
  });
});

describe("addMinutes / addHours — HH:mm 시각 연산", () => {
  it("addMinutes 정상 가산", () => {
    expect(addMinutes("13:30", 240)).toBe("17:30");
  });
  it("addMinutes: 자정 초과는 23:59로 클램프", () => {
    expect(addMinutes("23:30", 240)).toBe("23:59");
  });
  it("addMinutes: 잘못된 입력은 원본 반환", () => {
    expect(addMinutes("bad", 60)).toBe("bad");
  });
  it("addHours: 정상 가산", () => {
    expect(addHours("13:30", 4)).toBe("17:30");
  });
  it("addHours: 24시간 wrap(클램프 아님)", () => {
    expect(addHours("23:30", 1)).toBe("00:30");
  });
});

describe("diffMinutes — HH:mm 차이(분)", () => {
  it("종료-시작 분 차이", () => {
    expect(diffMinutes("13:30", "17:30")).toBe(240);
    expect(diffMinutes("09:00", "09:00")).toBe(0);
  });
  it("잘못된 입력은 0", () => {
    expect(diffMinutes("bad", "17:30")).toBe(0);
  });
});

describe("normalizeLeaveType — 한국어 라벨 → enum", () => {
  it("현행 라벨 매핑", () => {
    expect(normalizeLeaveType("연차(1일)")).toBe("ANNUAL");
    expect(normalizeLeaveType("반차(4H)")).toBe("HALF");
    expect(normalizeLeaveType("1/4연차(2H)")).toBe("QUARTER");
    expect(normalizeLeaveType("가정의날(1H)")).toBe("FAMILY_DAY");
    expect(normalizeLeaveType("가정의날(2H)")).toBe("FAMILY_DAY_2H");
  });
  it("legacy 라벨 호환", () => {
    expect(normalizeLeaveType("반차(오전)")).toBe("HALF");
    expect(normalizeLeaveType("1/4차")).toBe("QUARTER");
    expect(normalizeLeaveType("가정의날")).toBe("FAMILY_DAY");
  });
  it("이미 enum이면 그대로", () => {
    expect(normalizeLeaveType("ANNUAL")).toBe("ANNUAL");
    expect(normalizeLeaveType("FAMILY_DAY_2H")).toBe("FAMILY_DAY_2H");
  });
  it("빈 문자열·미지 라벨은 ANNUAL 폴백", () => {
    expect(normalizeLeaveType("")).toBe("ANNUAL");
    expect(normalizeLeaveType("알수없음")).toBe("ANNUAL");
  });
});

describe("연차대체 유효기간 — substituteYears / isSubstituteValid", () => {
  it("1~3월엔 작년분 포함", () => {
    expect(substituteYears(new Date(2026, 0, 15))).toEqual([2026, 2025]); // 1월
    expect(substituteYears(new Date(2026, 2, 31))).toEqual([2026, 2025]); // 3월
  });
  it("4월 이후는 올해분만", () => {
    expect(substituteYears(new Date(2026, 3, 1))).toEqual([2026]);  // 4월
    expect(substituteYears(new Date(2026, 5, 15))).toEqual([2026]); // 6월
  });
  it("2025년 발생분은 2026-03-31까지 유효, 2026-04-01엔 만료", () => {
    expect(isSubstituteValid(2025, new Date(2026, 2, 31))).toBe(true);  // 3/31 유효
    expect(isSubstituteValid(2025, new Date(2026, 3, 1))).toBe(false);  // 4/1 만료
  });
  it("당해 발생분은 다음해 3월말까지 유효", () => {
    expect(isSubstituteValid(2026, new Date(2026, 5, 15))).toBe(true);
    expect(isSubstituteValid(2026, new Date(2027, 3, 1))).toBe(false);
  });
});
