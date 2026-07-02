// projects/[id] 페이지 전용 유틸·상수·타입. page.tsx에서 기계적으로 분리(런타임 동작 불변).

export function toStr(d: Date) { return d.toISOString().slice(0, 10); }

/**
 * Backend dependency를 GanttChart flat 형식으로 변환.
 * "마일스톤-시점태스크-회귀" PDCA에서 mergeGanttData (Milestone 합성) 폐기.
 * Task↔Task 의존성만 처리.
 */
export function adaptGanttData(data: any): any {
  if (!data) return data;
  const flatDeps = (data.dependencies ?? []).map((d: any) => ({
    id: d.id,
    predecessorId: d.predecessorTaskId,
    successorId: d.successorTaskId,
    type: d.dependencyType ?? "FS",
    lagDays: d.lag ?? 0,
  }));
  return { ...data, dependencies: flatDeps };
}
export function ganttWeekRange(offsetWeeks: number) {
  const today = new Date();
  const dow = today.getDay();
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(today);
  mon.setDate(today.getDate() + diffToMon + offsetWeeks * 7);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  return { start: toStr(mon), end: toStr(sun) };
}
export function ganttMonthRange(offsetMonths: number) {
  const d = new Date();
  d.setMonth(d.getMonth() + offsetMonths);
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { start: toStr(start), end: toStr(end) };
}

export const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  PLANNING:    { label: "계획",   color: "bg-gray-100 text-gray-700" },
  IN_PROGRESS: { label: "진행중", color: "bg-blue-100 text-blue-700" },
  ON_HOLD:     { label: "보류",   color: "bg-yellow-100 text-yellow-700" },
  COMPLETED:   { label: "완료",   color: "bg-green-100 text-green-700" },
  CANCELLED:   { label: "취소",   color: "bg-red-100 text-red-700" },
};

export const TASK_STATUS_COLORS: Record<string, string> = {
  TODO: "bg-gray-100 text-gray-600",
  IN_PROGRESS: "bg-blue-100 text-blue-700",
  ON_HOLD: "bg-yellow-100 text-yellow-700",
  DONE: "bg-green-100 text-green-700",
  BLOCKED: "bg-red-100 text-red-700",
};
export const TASK_STATUS_LABELS: Record<string, string> = {
  TODO: "예정", IN_PROGRESS: "진행중", ON_HOLD: "보류", DONE: "완료", BLOCKED: "차단",
};

// 지연 판정: 미완료 + endDate가 오늘 이전
export function isOverdue(task: { status?: string; effectiveEndDate?: string | null }) {
  if (!task) return false;
  if (task.status === "DONE" || task.status === "CANCELLED") return false;
  if (!task.effectiveEndDate) return false;
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return task.effectiveEndDate < today;
}

// 자원 이름 → 아바타 배경색 (해시 기반)
export const AVATAR_COLORS = [
  "bg-blue-500", "bg-emerald-500", "bg-violet-500", "bg-orange-500",
  "bg-rose-500", "bg-cyan-500", "bg-amber-500", "bg-teal-500",
];
export function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

// ── 태스크 목록 컬럼 순서 ─────────────────────────────────────────────────────
export type ColId = "status" | "dates" | "progress" | "resources" | "note";
export const COL_CFG: Record<ColId, { label: string; width: string }> = {
  status:    { label: "상태",   width: "w-20" },
  dates:     { label: "기간",   width: "w-40" },
  progress:  { label: "진행률", width: "w-28" },
  resources: { label: "자원",   width: "w-24" },
  note:      { label: "비고",   width: "w-32" },
};
export const DEFAULT_COL_ORDER: ColId[] = ["status", "dates", "progress", "resources", "note"];
