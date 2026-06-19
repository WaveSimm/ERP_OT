import { RepairOrderStatus } from "@prisma/client";

/**
 * 수리(AS) 접수 상태 전이 규칙: 현재 상태 → 허용 다음 상태들.
 * (repair-order.service.ts 인라인 TRANSITIONS를 도메인 계층으로 추출 — order.fsm.ts와 동일 패턴)
 * Record<RepairOrderStatus, ...> 강타입 → enum 값 누락 시 컴파일 에러로 정합 보장.
 */
const TRANSITIONS: Record<RepairOrderStatus, RepairOrderStatus[]> = {
  RECEIVED:          ["INSPECTING_1ST", "CANCELLED"],
  INSPECTING_1ST:    ["QUOTED", "REPAIRING", "SHIPPED_TO_MFG", "COMPLETED", "NO_FAULT", "NO_REPAIR", "CANCELLED"],
  QUOTED:            ["APPROVED", "CANCELLED"],
  APPROVED:          ["REPAIRING", "SHIPPED_TO_MFG", "CANCELLED"],
  REPAIRING:         ["COMPLETED", "CANCELLED"],
  SHIPPED_TO_MFG:    ["RECEIVED_FROM_MFG", "CANCELLED"],
  RECEIVED_FROM_MFG: ["INSPECTING_2ND", "COMPLETED", "NO_FAULT", "NO_REPAIR", "CANCELLED"],
  INSPECTING_2ND:    ["COMPLETED", "NO_FAULT", "NO_REPAIR", "CANCELLED"],
  COMPLETED:         ["CLOSED"],
  NO_FAULT:          ["CLOSED"],
  NO_REPAIR:         ["CLOSED"],
  CLOSED:            [],
  CANCELLED:         [],
};

/** 전체 수리 상태 목록 (TRANSITIONS 키에서 도출 — prisma 런타임 enum 무의존). */
export const ALL_REPAIR_STATUSES = Object.keys(TRANSITIONS) as RepairOrderStatus[];

export function canTransition(from: RepairOrderStatus, to: RepairOrderStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function getAllowedTransitions(from: RepairOrderStatus): RepairOrderStatus[] {
  return TRANSITIONS[from] ?? [];
}

/**
 * UI 탭(상태 그룹) → 해당 그룹에 속한 상태들.
 * (repair-order.service.ts list() 인라인 groups를 도메인 계층으로 추출)
 * CANCELLED는 어느 탭에도 안 들어가는 별도 필터 — 의도적 제외.
 */
export const STATUS_GROUPS: Record<string, RepairOrderStatus[]> = {
  received:          ["RECEIVED"],
  inspecting:        ["INSPECTING_1ST", "INSPECTING_2ND"],
  repairing:         ["QUOTED", "APPROVED", "REPAIRING"],
  manufacturer:      ["SHIPPED_TO_MFG"],
  received_from_mfg: ["RECEIVED_FROM_MFG"],
  completed:         ["COMPLETED", "NO_FAULT", "NO_REPAIR", "CLOSED"],
};

/** 그룹명 → 상태 목록 (없는 그룹이면 undefined) */
export function getStatusesInGroup(group: string): RepairOrderStatus[] | undefined {
  return STATUS_GROUPS[group];
}

export function assertTransition(from: RepairOrderStatus, to: RepairOrderStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(
      `상태 전이가 허용되지 않습니다: ${from} → ${to}`
    );
  }
}
