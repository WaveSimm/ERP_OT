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

export function canTransition(from: RepairOrderStatus, to: RepairOrderStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function getAllowedTransitions(from: RepairOrderStatus): RepairOrderStatus[] {
  return TRANSITIONS[from] ?? [];
}

export function assertTransition(from: RepairOrderStatus, to: RepairOrderStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(
      `상태 전이가 허용되지 않습니다: ${from} → ${to}`
    );
  }
}
