import { ApprovalDocumentStatus } from "@prisma/client";

const TRANSITIONS: Record<ApprovalDocumentStatus, ApprovalDocumentStatus[]> = {
  DRAFT:              ["AGREEMENT_PENDING", "SUBMITTED"],
  AGREEMENT_PENDING:  ["SUBMITTED", "RETURNED"],
  SUBMITTED:          ["STEP_1_PENDING", "DRAFT"],
  STEP_1_PENDING:     ["STEP_2_PENDING", "APPROVED", "REJECTED", "DRAFT"],
  STEP_2_PENDING:     ["STEP_3_PENDING", "APPROVED", "REJECTED", "DRAFT"],
  STEP_3_PENDING:     ["APPROVED", "REJECTED", "DRAFT"],
  APPROVED:           [],
  REJECTED:           ["DRAFT"],
  RETURNED:           ["DRAFT"],
};

export function canTransition(from: ApprovalDocumentStatus, to: ApprovalDocumentStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function getAllowedTransitions(from: ApprovalDocumentStatus): ApprovalDocumentStatus[] {
  return TRANSITIONS[from] ?? [];
}

export function assertTransition(from: ApprovalDocumentStatus, to: ApprovalDocumentStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`결재 상태 전환 불가: ${from} → ${to}`);
  }
}

/** Determine next step status based on current status and step count */
export function getNextStepStatus(
  currentStatus: ApprovalDocumentStatus,
  stepCount: number,
): ApprovalDocumentStatus {
  if (currentStatus === "SUBMITTED" || currentStatus === "AGREEMENT_PENDING") return "STEP_1_PENDING";
  if (currentStatus === "STEP_1_PENDING" && stepCount >= 2) return "STEP_2_PENDING";
  if (currentStatus === "STEP_2_PENDING" && stepCount >= 3) return "STEP_3_PENDING";
  return "APPROVED";
}

/** Get current step order from status */
export function getCurrentStepOrder(status: ApprovalDocumentStatus): number | null {
  if (status === "STEP_1_PENDING") return 1;
  if (status === "STEP_2_PENDING") return 2;
  if (status === "STEP_3_PENDING") return 3;
  return null;
}
