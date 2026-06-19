import { describe, it, expect } from "vitest";
import { canTransition, getAllowedTransitions, assertTransition } from "./order.fsm";

// 해외발주 상태머신 안전망 — 전환 규칙은 발주 워크플로의 핵심 비즈니스 규칙.
// (런타임 prisma 무의존 — 순수 함수)

describe("order.fsm — 정상 전환", () => {
  it("DRAFT → PENDING_APPROVAL 허용", () => {
    expect(canTransition("DRAFT", "PENDING_APPROVAL")).toBe(true);
  });

  it("승인 흐름: PENDING_APPROVAL → APPROVED → ORDERED → PURCHASING → SHIPPED → CUSTOMS", () => {
    expect(canTransition("PENDING_APPROVAL", "APPROVED")).toBe(true);
    expect(canTransition("APPROVED", "ORDERED")).toBe(true);
    expect(canTransition("ORDERED", "PURCHASING")).toBe(true);
    expect(canTransition("PURCHASING", "SHIPPED")).toBe(true);
    expect(canTransition("SHIPPED", "CUSTOMS")).toBe(true);
  });

  it("CUSTOMS → PARTIALLY_RECEIVED / ARRIVED 둘 다 허용", () => {
    expect(canTransition("CUSTOMS", "PARTIALLY_RECEIVED")).toBe(true);
    expect(canTransition("CUSTOMS", "ARRIVED")).toBe(true);
  });

  it("PARTIALLY_RECEIVED → ARRIVED → CLOSED", () => {
    expect(canTransition("PARTIALLY_RECEIVED", "ARRIVED")).toBe(true);
    expect(canTransition("ARRIVED", "CLOSED")).toBe(true);
  });

  it("상신 취소: PENDING_APPROVAL → DRAFT 허용 (v1.6)", () => {
    expect(canTransition("PENDING_APPROVAL", "DRAFT")).toBe(true);
  });

  it("반려 후 재작성: REJECTED → DRAFT 허용", () => {
    expect(canTransition("PENDING_APPROVAL", "REJECTED")).toBe(true);
    expect(canTransition("REJECTED", "DRAFT")).toBe(true);
  });
});

describe("order.fsm — 금지 전환", () => {
  it("단계 건너뛰기 금지: ORDERED → SHIPPED (PURCHASING 거쳐야)", () => {
    expect(canTransition("ORDERED", "SHIPPED")).toBe(false);
  });

  it("승인 없이 발주 금지: DRAFT → ORDERED", () => {
    expect(canTransition("DRAFT", "ORDERED")).toBe(false);
  });

  it("종결 상태에서 전환 불가: CLOSED → 무엇이든", () => {
    expect(getAllowedTransitions("CLOSED")).toEqual([]);
    expect(canTransition("CLOSED", "DRAFT")).toBe(false);
  });

  it("SETTLEMENT은 legacy — CLOSED만 허용, 새 전환 차단", () => {
    expect(getAllowedTransitions("SETTLEMENT")).toEqual(["CLOSED"]);
  });
});

describe("order.fsm — assertTransition", () => {
  it("허용 전환은 throw 안 함", () => {
    expect(() => assertTransition("DRAFT", "PENDING_APPROVAL")).not.toThrow();
  });

  it("금지 전환은 허용목록 포함한 에러 throw", () => {
    expect(() => assertTransition("DRAFT", "CLOSED")).toThrow(/허용되지 않습니다/);
    expect(() => assertTransition("DRAFT", "CLOSED")).toThrow(/PENDING_APPROVAL/);
  });
});
