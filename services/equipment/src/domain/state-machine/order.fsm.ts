import { OrderStatus } from "@prisma/client";

/** Allowed transitions: current status → next statuses */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  DRAFT:              ["PENDING_APPROVAL"],
  // v1.6 (2026-05-14): 상신 취소 (PENDING_APPROVAL → DRAFT) 허용
  PENDING_APPROVAL:   ["APPROVED", "REJECTED", "DRAFT"],
  APPROVED:           ["ORDERED"],
  REJECTED:           ["DRAFT"],
  // v1.6 (2026-05-14): 제작중 단계 제거. ORDERED → PURCHASING → SHIPPED 강제 (직행 금지)
  ORDERED:            ["PURCHASING"],
  IN_PRODUCTION:      ["SHIPPED"],  // legacy 호환
  PURCHASING:         ["SHIPPED"],
  SHIPPED:            ["CUSTOMS"],
  CUSTOMS:            ["PARTIALLY_RECEIVED", "ARRIVED"],
  PARTIALLY_RECEIVED: ["ARRIVED"],
  // v1.6 (2026-05-14): SETTLEMENT 진입 차단 — 송금은 OrderPayment로 별도 관리, 상태 변경 없음
  ARRIVED:            ["CLOSED"],
  SETTLEMENT:         ["CLOSED"],  // legacy 호환만, 새 전환 불가
  CLOSED:             [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function getAllowedTransitions(from: OrderStatus): OrderStatus[] {
  return TRANSITIONS[from] ?? [];
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(
      `상태 전환이 허용되지 않습니다: ${from} → ${to}. 허용: [${getAllowedTransitions(from).join(", ")}]`
    );
  }
}
