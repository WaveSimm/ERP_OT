import { OrderStatus } from "@prisma/client";

/** Allowed transitions: current status → next statuses */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  DRAFT:              ["PENDING_APPROVAL"],
  PENDING_APPROVAL:   ["APPROVED", "REJECTED"],
  APPROVED:           ["ORDERED"],
  REJECTED:           ["DRAFT"],
  ORDERED:            ["IN_PRODUCTION", "SHIPPED"],
  IN_PRODUCTION:      ["SHIPPED"],
  SHIPPED:            ["CUSTOMS"],
  CUSTOMS:            ["PARTIALLY_RECEIVED", "ARRIVED"],
  PARTIALLY_RECEIVED: ["ARRIVED"],
  ARRIVED:            ["CLOSED"],
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
