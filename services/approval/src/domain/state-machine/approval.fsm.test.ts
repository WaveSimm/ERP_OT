import { describe, it, expect } from "vitest";
import type { ApprovalDocumentStatus } from "@prisma/client";
import {
  canTransition,
  getAllowedTransitions,
  assertTransition,
  getNextStepStatus,
  getCurrentStepOrder,
} from "./approval.fsm";

// 문자열 → enum 캐스트(타입 전용 import 라 런타임엔 순수 문자열 — prisma client 런타임 의존 없음).
const S = (s: string) => s as ApprovalDocumentStatus;

describe("approval FSM — canTransition", () => {
  it("허용된 전이는 true", () => {
    expect(canTransition(S("DRAFT"), S("SUBMITTED"))).toBe(true);
    expect(canTransition(S("DRAFT"), S("AGREEMENT_PENDING"))).toBe(true);
    expect(canTransition(S("STEP_1_PENDING"), S("STEP_2_PENDING"))).toBe(true);
    expect(canTransition(S("STEP_3_PENDING"), S("APPROVED"))).toBe(true);
    expect(canTransition(S("REJECTED"), S("DRAFT"))).toBe(true);
  });

  it("허용되지 않은 전이는 false", () => {
    expect(canTransition(S("DRAFT"), S("APPROVED"))).toBe(false);   // 단계 건너뜀 금지
    expect(canTransition(S("APPROVED"), S("DRAFT"))).toBe(false);   // 종료상태에서 전이 없음
    expect(canTransition(S("APPROVED"), S("REJECTED"))).toBe(false);
    expect(canTransition(S("UNKNOWN_STATE"), S("DRAFT"))).toBe(false); // 미정의 상태
  });
});

describe("approval FSM — getAllowedTransitions", () => {
  it("DRAFT 의 허용 전이", () => {
    expect(getAllowedTransitions(S("DRAFT"))).toEqual(["AGREEMENT_PENDING", "SUBMITTED"]);
  });
  it("APPROVED(종료) 는 전이 없음", () => {
    expect(getAllowedTransitions(S("APPROVED"))).toEqual([]);
  });
});

describe("approval FSM — assertTransition", () => {
  it("허용 전이는 throw 안 함", () => {
    expect(() => assertTransition(S("DRAFT"), S("SUBMITTED"))).not.toThrow();
  });
  it("불허 전이는 throw", () => {
    expect(() => assertTransition(S("DRAFT"), S("APPROVED"))).toThrow(/전환 불가/);
  });
});

describe("approval FSM — getNextStepStatus", () => {
  it("제출 → 1단계", () => {
    expect(getNextStepStatus(S("SUBMITTED"), 3)).toBe("STEP_1_PENDING");
    expect(getNextStepStatus(S("AGREEMENT_PENDING"), 1)).toBe("STEP_1_PENDING");
  });
  it("1단계 + 다단계 → 2단계 / 단일단계 → 승인", () => {
    expect(getNextStepStatus(S("STEP_1_PENDING"), 2)).toBe("STEP_2_PENDING");
    expect(getNextStepStatus(S("STEP_1_PENDING"), 1)).toBe("APPROVED");
  });
  it("마지막 단계 → 승인", () => {
    expect(getNextStepStatus(S("STEP_3_PENDING"), 3)).toBe("APPROVED");
  });
});

describe("approval FSM — getCurrentStepOrder", () => {
  it("단계 상태 → 순번", () => {
    expect(getCurrentStepOrder(S("STEP_1_PENDING"))).toBe(1);
    expect(getCurrentStepOrder(S("STEP_2_PENDING"))).toBe(2);
    expect(getCurrentStepOrder(S("STEP_3_PENDING"))).toBe(3);
  });
  it("비단계 상태 → null", () => {
    expect(getCurrentStepOrder(S("DRAFT"))).toBeNull();
    expect(getCurrentStepOrder(S("APPROVED"))).toBeNull();
  });
});
