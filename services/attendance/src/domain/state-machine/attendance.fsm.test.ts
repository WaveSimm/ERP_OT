import { describe, it, expect } from "vitest";
import { transition, canTransition } from "./attendance.fsm";

// 출퇴근 상태머신 안전망 — 출근/휴게/퇴근 전이는 근태 기록의 핵심 규칙.
// (런타임 prisma 무의존 — 순수 함수)

describe("attendance.fsm — 정상 전환", () => {
  it("하루 흐름: NOT_STARTED → CHECKED_IN → CHECKED_OUT", () => {
    expect(transition("NOT_STARTED", "CHECK_IN")).toBe("CHECKED_IN");
    expect(transition("CHECKED_IN", "CHECK_OUT")).toBe("CHECKED_OUT");
  });

  it("휴게 왕복: CHECKED_IN → ON_BREAK → CHECKED_IN", () => {
    expect(transition("CHECKED_IN", "BREAK_OUT")).toBe("ON_BREAK");
    expect(transition("ON_BREAK", "BREAK_IN")).toBe("CHECKED_IN");
  });

  it("canTransition 허용 케이스", () => {
    expect(canTransition("NOT_STARTED", "CHECK_IN")).toBe(true);
    expect(canTransition("CHECKED_IN", "CHECK_OUT")).toBe(true);
    expect(canTransition("CHECKED_IN", "BREAK_OUT")).toBe(true);
    expect(canTransition("ON_BREAK", "BREAK_IN")).toBe(true);
  });
});

describe("attendance.fsm — 금지 전환", () => {
  it("출근 전 퇴근 금지: NOT_STARTED → CHECK_OUT", () => {
    expect(canTransition("NOT_STARTED", "CHECK_OUT")).toBe(false);
    expect(() => transition("NOT_STARTED", "CHECK_OUT")).toThrow(/허용되지 않습니다/);
  });

  it("이중 출근 금지: CHECKED_IN → CHECK_IN", () => {
    expect(canTransition("CHECKED_IN", "CHECK_IN")).toBe(false);
  });

  it("휴게 중 퇴근 금지: ON_BREAK → CHECK_OUT (BREAK_IN 먼저)", () => {
    expect(canTransition("ON_BREAK", "CHECK_OUT")).toBe(false);
  });

  it("휴게 중 중복 휴게 금지: ON_BREAK → BREAK_OUT", () => {
    expect(canTransition("ON_BREAK", "BREAK_OUT")).toBe(false);
  });

  it("종료 상태에서 전환 불가: CHECKED_OUT → 무엇이든", () => {
    expect(canTransition("CHECKED_OUT", "CHECK_IN")).toBe(false);
    expect(canTransition("CHECKED_OUT", "BREAK_OUT")).toBe(false);
    expect(canTransition("CHECKED_OUT", "CHECK_OUT")).toBe(false);
    expect(() => transition("CHECKED_OUT", "CHECK_IN")).toThrow();
  });

  it("휴게 재진입 없이 재출근 금지: CHECKED_IN → BREAK_IN", () => {
    expect(canTransition("CHECKED_IN", "BREAK_IN")).toBe(false);
  });
});
