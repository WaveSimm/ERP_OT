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
};
export const TASK_STATUS_LABELS: Record<string, string> = {
  TODO: "예정", IN_PROGRESS: "진행중", ON_HOLD: "중단", DONE: "완료",
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
export type ColId = "status" | "dates" | "segProgress" | "progress" | "resources" | "note";
export const COL_CFG: Record<ColId, { label: string; width: string }> = {
  status:      { label: "상태",   width: "w-20" },
  dates:       { label: "기간",   width: "w-40" },
  segProgress: { label: "완료 구간", width: "w-24" },
  progress:    { label: "전체진행률", width: "w-28" },
  resources:   { label: "자원",   width: "w-24" },
  note:        { label: "비고",   width: "w-32" },
};
export const DEFAULT_COL_ORDER: ColId[] = ["status", "dates", "segProgress", "progress", "resources", "note"];

// 상위 태스크 rollup: 하위 태스크의 기간/진행률/상태/자원을 집계 (page.tsx에서 기계적 분리)
export function buildRolledUpTasks(taskList: any[]): any[] {
  if (taskList.length === 0) return [];

  // 트리 구성
  // 크리티컬(CPM) 폐기(2026-07-21): 래퍼 생성 시점에 isCritical을 끔 → _children(하위 태스크)까지 전 계층 반영.
  //   (예전엔 최종 반환 객체에만 껐는데, buildFlatItems가 _children으로 하위 행을 그려 하위만 빨갛게 남았음)
  const map = new Map(taskList.map((t: any) => [t.id, { ...t, isCritical: false, _children: [] as any[] }]));
  for (const t of map.values()) {
    if (t.parentId && map.has(t.parentId)) {
      map.get(t.parentId)!._children.push(t);
    }
  }

  // 하위 태스크의 모든 세그먼트 수집 (재귀)
  function collectAllSegments(task: any): any[] {
    return [...task.segments, ...task._children.flatMap((c: any) => collectAllSegments(c))];
  }

  // 하위 태스크의 모든 자원 수집 (재귀, 중복 제거)
  function collectAllResources(task: any): Map<string, any> {
    const map = new Map<string, any>();
    for (const seg of task.segments ?? []) {
      for (const a of seg.assignments ?? []) {
        if (a.resourceId && !map.has(a.resourceId)) map.set(a.resourceId, a);
      }
    }
    for (const child of task._children ?? []) {
      for (const [id, a] of collectAllResources(child)) {
        if (!map.has(id)) map.set(id, a);
      }
    }
    return map;
  }

  // Bottom-up rollup: 리프는 세그먼트 평균, 상위는 자식 평균으로 집계
  function rollup(task: any): void {
    const children: any[] = task._children;
    if (children.length === 0) {
      // 리프 태스크: 자신의 세그먼트 progressPercent 평균
      const segs: any[] = task.segments ?? [];
      if (segs.length > 0) {
        const avg = segs.reduce((sum: number, s: any) => sum + (s.progressPercent ?? 0), 0) / segs.length;
        task.overallProgress = Math.round(avg * 10) / 10;
      }
      return;
    }
    children.forEach(rollup); // 자식 먼저 처리

    // 날짜: 하위 태스크 세그먼트만 (부모 자신의 segments 제외)
    const allSegs = children.flatMap((c: any) => collectAllSegments(c));
    if (allSegs.length > 0) {
      const starts = allSegs.map((s: any) => s.startDate);
      const ends = allSegs.map((s: any) => s.endDate);
      task.effectiveStartDate = starts.reduce((a: string, b: string) => (a < b ? a : b));
      task.effectiveEndDate = ends.reduce((a: string, b: string) => (a > b ? a : b));
      // 상위 태스크 진행률은 항상 직계 자식 평균으로 계산 (수동 입력 불가)
      const avg = children.reduce((sum: number, c: any) => sum + c.overallProgress, 0) / children.length;
      task.overallProgress = Math.round(avg * 10) / 10;
    }

    // 상태 롤업: 부모 자신이 중단(ON_HOLD)이면 유지(중단은 위→아래 캐스케이드),
    //   그 외에는 자식 기준 자동(완료/진행중/예정).
    if (task.status !== "ON_HOLD") {
      const statuses = children.map((c: any) => c.status);
      if (statuses.every((s: string) => s === "DONE")) {
        task.status = "DONE";
      } else if (statuses.some((s: string) => s === "DONE" || s === "IN_PROGRESS")) {
        task.status = "IN_PROGRESS";
      } else {
        task.status = "TODO";
      }
    }

    // 자원: 모든 하위 자원 집계 (부모 자신 자원 포함)
    task._rolledUpResources = Array.from(collectAllResources(task).values());
  }

  for (const t of map.values()) {
    if (!t.parentId || !map.has(t.parentId)) rollup(t);
  }

  return taskList.map((t: any) => {
    const task = map.get(t.id) ?? t;
    // 크리티컬(CPM) 폐기(2026-07-21): 표시용 isCritical을 강제로 끔 → 목록·간트 빨간 표시 제거
    return { ...task, isCritical: false };
  });
}

// 계층 트리 구성 → flat display list (collapsed 접힘 반영)
export function buildFlatItems(taskList: any[], collapsed: Set<string>): { task: any; depth: number }[] {
  const map = new Map(taskList.map((t: any) => [t.id, t])); // rolledUpTasks already has _children
  const roots: any[] = taskList.filter((t: any) => !t.parentId || !map.has(t.parentId));
  const sortFn = (arr: any[]) => [...arr].sort((a: any, b: any) => a.sortOrder - b.sortOrder);
  const flatten = (nodes: any[], depth: number): { task: any; depth: number }[] => {
    const result: { task: any; depth: number }[] = [];
    for (const n of sortFn(nodes)) {
      result.push({ task: n, depth });
      if (n._children.length > 0 && !collapsed.has(n.id)) {
        result.push(...flatten(n._children, depth + 1));
      }
    }
    return result;
  };
  return flatten(roots, 0);
}
