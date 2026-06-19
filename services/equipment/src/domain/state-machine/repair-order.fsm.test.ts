import { describe, it, expect } from "vitest";
import {
  canTransition, getAllowedTransitions, assertTransition,
  STATUS_GROUPS, getStatusesInGroup, ALL_REPAIR_STATUSES,
} from "./repair-order.fsm";
// NOTE: prisma 런타임 enum(RepairOrderStatus) import 금지 — CI Test 단계는 공유 @prisma/client가
//   마지막 generate 서비스 것으로 덮여 equipment enum이 없을 수 있음(clobber). fsm 자체 ALL_REPAIR_STATUSES 사용.

// 수리(AS) 접수 상태머신 안전망 — AS production의 핵심 워크플로 규칙.
// repair-order.service.ts 인라인 TRANSITIONS를 도메인 계층으로 추출하며 함께 도입.
// (런타임 prisma 무의존 — 순수 함수)

describe("repair-order.fsm — 정상 전환", () => {
  it("접수 → 1차점검: RECEIVED → INSPECTING_1ST", () => {
    expect(canTransition("RECEIVED", "INSPECTING_1ST")).toBe(true);
  });

  it("1차점검에서 다양한 분기 허용(견적/수리/제조사발송/완료/무결함/수리안함)", () => {
    for (const to of ["QUOTED", "REPAIRING", "SHIPPED_TO_MFG", "COMPLETED", "NO_FAULT", "NO_REPAIR"] as const) {
      expect(canTransition("INSPECTING_1ST", to)).toBe(true);
    }
  });

  it("견적 흐름: QUOTED → APPROVED → REPAIRING → COMPLETED → CLOSED", () => {
    expect(canTransition("QUOTED", "APPROVED")).toBe(true);
    expect(canTransition("APPROVED", "REPAIRING")).toBe(true);
    expect(canTransition("REPAIRING", "COMPLETED")).toBe(true);
    expect(canTransition("COMPLETED", "CLOSED")).toBe(true);
  });

  it("제조사 수리 흐름: SHIPPED_TO_MFG → RECEIVED_FROM_MFG → INSPECTING_2ND", () => {
    expect(canTransition("SHIPPED_TO_MFG", "RECEIVED_FROM_MFG")).toBe(true);
    expect(canTransition("RECEIVED_FROM_MFG", "INSPECTING_2ND")).toBe(true);
  });

  it("종결 분기 NO_FAULT / NO_REPAIR → CLOSED", () => {
    expect(canTransition("NO_FAULT", "CLOSED")).toBe(true);
    expect(canTransition("NO_REPAIR", "CLOSED")).toBe(true);
  });

  it("대부분 상태에서 CANCELLED 가능(종결 상태 제외)", () => {
    expect(canTransition("RECEIVED", "CANCELLED")).toBe(true);
    expect(canTransition("REPAIRING", "CANCELLED")).toBe(true);
  });
});

describe("repair-order.fsm — 금지 전환", () => {
  it("점검 없이 완료 금지: RECEIVED → COMPLETED", () => {
    expect(canTransition("RECEIVED", "COMPLETED")).toBe(false);
  });

  it("종결 상태에서 전환 불가: CLOSED / CANCELLED → 무엇이든", () => {
    expect(getAllowedTransitions("CLOSED")).toEqual([]);
    expect(getAllowedTransitions("CANCELLED")).toEqual([]);
    expect(canTransition("CLOSED", "RECEIVED")).toBe(false);
    expect(canTransition("CANCELLED", "RECEIVED")).toBe(false);
  });

  it("종결된 건 취소 불가: COMPLETED → CANCELLED", () => {
    expect(canTransition("COMPLETED", "CANCELLED")).toBe(false);
  });
});

describe("repair-order.fsm — assertTransition", () => {
  it("허용 전환은 throw 안 함", () => {
    expect(() => assertTransition("RECEIVED", "INSPECTING_1ST")).not.toThrow();
  });

  it("금지 전환은 에러 throw", () => {
    expect(() => assertTransition("RECEIVED", "COMPLETED")).toThrow(/허용되지 않습니다/);
  });
});

describe("repair-order.fsm — STATUS_GROUPS (UI 탭 필터)", () => {
  it("그룹명으로 상태목록 조회", () => {
    expect(getStatusesInGroup("inspecting")).toEqual(["INSPECTING_1ST", "INSPECTING_2ND"]);
    expect(getStatusesInGroup("completed")).toContain("CLOSED");
  });

  it("없는 그룹은 undefined (필터 미적용 → 전체 조회로 안전 폴백)", () => {
    expect(getStatusesInGroup("__nope__")).toBeUndefined();
  });

  // 회귀 방지 핵심: 새 상태 추가 시 그룹 누락되면 UI 탭에서 안 보이는 버그 → 여기서 잡힘.
  it("CANCELLED를 제외한 모든 상태가 정확히 한 그룹에 속한다", () => {
    const allStatuses = ALL_REPAIR_STATUSES.filter((s) => s !== "CANCELLED");
    const grouped = Object.values(STATUS_GROUPS).flat();
    // 누락 없음
    for (const s of allStatuses) {
      expect(grouped).toContain(s);
    }
    // 중복 없음 (한 상태가 두 그룹에 속하지 않음)
    expect(grouped.length).toBe(new Set(grouped).size);
    // 그룹에 든 상태 수 = 전체(CANCELLED 제외)
    expect(grouped.length).toBe(allStatuses.length);
  });
});
