// 자원-모델-분리 PDCA Phase 3b-2 (2026-05-04)
// 직원 상태 표시 배지

export type EmployeeStatus = "ACTIVE" | "RETIRED" | "SUSPENDED";

interface Props {
  status: EmployeeStatus;
  size?: "sm" | "md";
}

const STATUS_CONFIG: Record<EmployeeStatus, { label: string; cls: string }> = {
  ACTIVE: { label: "현직", cls: "bg-green-50 text-green-700 border-green-200" },
  RETIRED: { label: "퇴직", cls: "bg-gray-100 text-gray-500 border-gray-200" },
  SUSPENDED: { label: "정지", cls: "bg-orange-50 text-orange-700 border-orange-200" },
};

export function UserStatusBadge({ status, size = "sm" }: Props) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.ACTIVE;
  const sz = size === "md" ? "px-2 py-0.5 text-xs" : "px-1.5 py-0.5 text-[11px]";
  return (
    <span className={`inline-flex items-center rounded border font-medium ${sz} ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}
