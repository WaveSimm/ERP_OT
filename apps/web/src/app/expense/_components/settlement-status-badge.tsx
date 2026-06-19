// 경비 정산 상태 배지 (공유 프레젠테이션 컴포넌트)
// page.tsx 에서 분리 — Next.js page 파일은 default + 예약 export 만 허용하므로 임의 컴포넌트 export 불가.

export function SettlementStatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; cls: string }> = {
    DRAFT:     { label: "작성중",   cls: "bg-gray-100 text-gray-700" },
    SUBMITTED: { label: "결재중",   cls: "bg-blue-100 text-blue-700" },
    APPROVED:  { label: "승인",     cls: "bg-emerald-100 text-emerald-700" },
    RECEIVED:  { label: "재무팀접수", cls: "bg-cyan-100 text-cyan-700" },
    PAID:      { label: "💰 입금",  cls: "bg-green-100 text-green-700" },
    REJECTED:  { label: "반려",     cls: "bg-red-100 text-red-700" },
  };
  const c = config[status] ?? { label: status, cls: "bg-gray-100" };
  return <span className={`px-2 py-0.5 text-xs font-medium rounded ${c.cls}`}>{c.label}</span>;
}
