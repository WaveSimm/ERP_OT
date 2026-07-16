"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { dashboardApi, folderApi, workLogApi, projectApi } from "@/lib/api";
import { Table, THead, Th, TBody, Tr, Td, TableEmpty } from "@/components/ui/Table";
import type { Folder, Task } from "@/lib/api/types";
import { DateInput } from "@/components/ui/DateInput";
import { fmtTime24 } from "@/lib/datetime";
import TaskDrawer from "@/components/TaskDrawer";


// ─── 타입 ─────────────────────────────────────────────────────────────────────

interface GlobalSummary {
  totalProjects: number;
  statusCount: { onTrack: number; warning: number; critical: number; completed: number; onHold: number };
  issueCount: { critical: number; warning: number; info: number };
  thisWeekEvents: { starting: number; ending: number; milestones: number };
}

interface ProjectRow {
  id: string;
  name: string;
  status: string;
  ragStatus: "GREEN" | "AMBER" | "RED";
  overallProgress: number;
  plannedBudget?: number;
  actualBudget?: number;
  budgetUsagePercent?: number;
  isCriticalPathDelayed: boolean;
  issueCount: { critical: number; warning: number; info: number };
  weeklyTimeline: TimelineEvent[];
  isPinned: boolean;
  lastUpdatedAt: string;
}

interface TimelineEvent {
  date: string;
  type: "SEGMENT_START" | "SEGMENT_END" | "SEGMENT_ACTIVE" | "MILESTONE";
  taskId: string;
  taskName: string;
  segmentId?: string;
  segmentName?: string;
  progressPercent?: number;
  isDelayed: boolean;
  delayDays?: number;
  isCriticalPath: boolean;
  assignees?: { id: string; name: string }[];
}

interface DashboardGroup {
  id: string;
  name: string;
  type: string;
  color?: string;
  rollup: {
    totalProjects: number;
    weightedProgress: number;
    issueCount: { critical: number; warning: number; info: number };
    statusCount: { onTrack: number; warning: number; critical: number };
  };
  projects: ProjectRow[];
}

interface DashboardData {
  date: string;
  globalSummary: GlobalSummary;
  groups: DashboardGroup[];
  ungroupedProjects: ProjectRow[];
  cachedAt: string;
}

// ─── 상수 ─────────────────────────────────────────────────────────────────────

const RAG_COLOR: Record<string, string> = {
  GREEN: "bg-green-500",
  AMBER: "bg-yellow-400",
  RED: "bg-red-500",
};

const RAG_RING: Record<string, string> = {
  GREEN: "ring-green-300",
  AMBER: "ring-yellow-300",
  RED: "ring-red-300",
};

const RAG_TEXT: Record<string, string> = {
  GREEN: "text-green-700 dark:text-green-400",
  AMBER: "text-yellow-700 dark:text-yellow-400",
  RED: "text-red-700 dark:text-red-400",
};

const ISSUE_FILTER_OPTIONS = [
  { value: "ALL", label: "전체" },
  { value: "CRITICAL", label: "위험" },
  { value: "WARNING", label: "경고" },
  { value: "INFO", label: "정보" },
];

function fmtDate(iso: string) {
  return iso.slice(0, 10);
}

// 날짜 문자열 오프셋 (YYYY-MM-DD, UTC 기준 — 날짜 비교 전용)
function shiftDate(dateStr: string, days: number): string {
  return new Date(new Date(dateStr).getTime() + days * 86400000).toISOString().slice(0, 10);
}

// 태스크의 표시용 기간 [최소 시작 ~ 최대 종료] ("MM-DD ~ MM-DD")
function taskRange(t: Task): { start: string; end: string } | null {
  const segs = (t.segments ?? []).filter((s) => s.startDate && s.endDate);
  if (segs.length > 0) {
    let s = segs[0]!.startDate.slice(0, 10);
    let e = segs[0]!.endDate.slice(0, 10);
    for (const seg of segs) {
      if (seg.startDate.slice(0, 10) < s) s = seg.startDate.slice(0, 10);
      if (seg.endDate.slice(0, 10) > e) e = seg.endDate.slice(0, 10);
    }
    return { start: s, end: e };
  }
  if (t.effectiveStartDate && t.effectiveEndDate) {
    return { start: t.effectiveStartDate.slice(0, 10), end: t.effectiveEndDate.slice(0, 10) };
  }
  return null;
}

// 태스크가 [winStart, winEnd] 기간과 겹치는지
function overlapsWindow(t: Task, winStart: string, winEnd: string): boolean {
  const r = taskRange(t);
  if (!r) return false;
  return r.start <= winEnd && r.end >= winStart;
}

interface TaskTreeRow { task: Task; depth: number; isLeaf: boolean; }

// ±7일 기간과 겹치는 '리프(최하위)' 태스크 + 그 조상만 포함한 WBS 트리(flatten).
// 상위 태스크는 이름만, 리프에만 기간/진행률을 보여주기 위한 구조.
// 필터 기준은 리프 자신의 기간 (단독 태스크도 리프로 취급).
function buildTaskTreeRows(tasks: Task[], winStart: string, winEnd: string): TaskTreeRow[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const childrenOf = new Map<string, Task[]>();
  const roots: Task[] = [];
  for (const t of tasks) {
    if (t.parentId && byId.has(t.parentId)) {
      (childrenOf.get(t.parentId) ?? childrenOf.set(t.parentId, []).get(t.parentId)!).push(t);
    } else {
      roots.push(t);
    }
  }
  const sortFn = (a: Task, b: Task) => a.sortOrder - b.sortOrder;
  roots.sort(sortFn);
  for (const arr of childrenOf.values()) arr.sort(sortFn);
  const isLeaf = (t: Task) => !(childrenOf.get(t.id)?.length);

  // 리프이면서 기간이 ±7일에 겹치는 것 + 그 조상들 포함
  const include = new Set<string>();
  for (const t of tasks) {
    if (isLeaf(t) && overlapsWindow(t, winStart, winEnd)) {
      include.add(t.id);
      let cur: Task | undefined = t;
      while (cur?.parentId && byId.has(cur.parentId)) {
        include.add(cur.parentId);
        cur = byId.get(cur.parentId);
      }
    }
  }

  const rows: TaskTreeRow[] = [];
  const walk = (nodes: Task[], depth: number) => {
    for (const n of nodes) {
      if (!include.has(n.id)) continue;
      const leaf = isLeaf(n);
      rows.push({ task: n, depth, isLeaf: leaf });
      if (!leaf) walk(childrenOf.get(n.id) ?? [], depth + 1);
    }
  };
  walk(roots, 0);
  return rows;
}


// ─── SVG 미니 타임라인 ────────────────────────────────────────────────────────

// 자원 아바타 색상 (간트/태스크의 ResourcePickerPopover와 동일 규칙)
const AVATAR_COLORS = [
  "bg-blue-500", "bg-emerald-500", "bg-violet-500", "bg-orange-500",
  "bg-rose-500", "bg-cyan-500", "bg-amber-500", "bg-teal-500",
];
function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

function MiniTimeline({ events, centerDate }: { events: TimelineEvent[]; centerDate: string }) {
  const DAYS = 15; // -7 ~ +7
  const W = 240;
  const DAY_W = W / DAYS;
  const center = new Date(centerDate);
  const winStart = shiftDate(centerDate, -7);
  const winEnd = shiftDate(centerDate, 7);

  function xForDate(dateStr: string) {
    const off = Math.round((new Date(dateStr).getTime() - center.getTime()) / 86400000);
    return ((off + 7) / DAYS) * W;
  }

  const milestones = events.filter((e) => e.type === "MILESTONE");

  // 백엔드는 세그먼트를 START/END/ACTIVE 점으로 쪼개 보냄 → segmentId로 묶어
  // 실제 기간(±7일 창 경계로 클램프)을 복원해 막대 하나로 렌더.
  const segGroups = new Map<string, TimelineEvent[]>();
  for (const e of events) {
    if (e.type === "MILESTONE") continue;
    const key = e.segmentId ?? `${e.taskId}:${e.date}`;
    const arr = segGroups.get(key);
    if (arr) arr.push(e);
    else segGroups.set(key, [e]);
  }

  const bars = Array.from(segGroups.values()).map((group) => {
    const startEv = group.find((e) => e.type === "SEGMENT_START");
    const endEv = group.find((e) => e.type === "SEGMENT_END");
    const activeEv = group.find((e) => e.type === "SEGMENT_ACTIVE");
    const rep = startEv ?? endEv ?? activeEv ?? group[0]!;
    // START 없으면 창 이전 시작, END 없으면 창 이후 종료 → 창 경계로 클램프
    const cs = activeEv ? winStart : startEv ? startEv.date.slice(0, 10) : winStart;
    const ce = activeEv ? winEnd : endEv ? endEv.date.slice(0, 10) : winEnd;
    const x1 = Math.max(0, xForDate(cs));
    const x2 = Math.min(W, xForDate(ce) + DAY_W); // 종료일 포함
    const color = rep.isDelayed ? "#EF4444" : rep.isCriticalPath ? "#F97316" : "#22C55E";
    return { x1, x2: Math.max(x2, x1 + 2), color, e: rep };
  });

  // 레인 패킹: 가로로 안 겹치는 막대는 같은 줄에, 겹치면 아래 줄로
  bars.sort((a, b) => a.x1 - b.x1);
  const MAX_LANES = 5;
  const laneEnds: number[] = [];
  const placed = bars.map((b) => {
    let lane = laneEnds.findIndex((end) => b.x1 >= end - 0.5);
    if (lane === -1) {
      if (laneEnds.length < MAX_LANES) {
        lane = laneEnds.length;
        laneEnds.push(b.x2);
      } else {
        lane = MAX_LANES - 1; // 초과분은 마지막 줄에 겹쳐 표시(투명도로 밀도 구분)
        laneEnds[lane] = Math.max(laneEnds[lane]!, b.x2);
      }
    } else {
      laneEnds[lane] = b.x2;
    }
    return { ...b, lane };
  });

  const laneCount = Math.max(1, laneEnds.length);
  const BAR_H = 6;
  const GAP = 3;
  const TOP = milestones.length > 0 ? 11 : 5; // 마일스톤 다이아몬드용 상단 여백
  const H = Math.max(24, TOP + laneCount * (BAR_H + GAP) + 3);

  return (
    <svg width={W} height={H} className="overflow-visible">
      {/* 배경 그리드 */}
      {Array.from({ length: DAYS + 1 }, (_, i) => (
        <line key={i} x1={i * DAY_W} y1={0} x2={i * DAY_W} y2={H} stroke="#94a3b8" strokeWidth={0.5} strokeOpacity={0.25} />
      ))}
      {/* 오늘 강조선 */}
      <line x1={xForDate(centerDate)} y1={0} x2={xForDate(centerDate)} y2={H} stroke="#F97316" strokeWidth={1.5} strokeDasharray="3,2" />
      {/* 실제 기간 막대 */}
      {placed.map((b, i) => (
        <rect
          key={i}
          x={b.x1}
          y={TOP + b.lane * (BAR_H + GAP)}
          width={Math.max(2, b.x2 - b.x1)}
          height={BAR_H}
          rx="2"
          fill={b.color}
          opacity={0.75}
        >
          <title>{b.e.taskName}{b.e.segmentName ? ` / ${b.e.segmentName}` : ""}{b.e.progressPercent != null ? ` (${b.e.progressPercent}%)` : ""}</title>
        </rect>
      ))}
      {/* 마일스톤 다이아몬드 (상단 띠) */}
      {milestones.map((e, i) => {
        const d = e.date.slice(0, 10);
        if (d < winStart || d > winEnd) return null;
        const x = xForDate(d);
        const color = e.isDelayed ? "#EF4444" : "#8B5CF6";
        return (
          <g key={`m${i}`} transform={`translate(${x}, 5)`}>
            <polygon points="0,-4 4,0 0,4 -4,0" fill={color} />
            <title>{e.taskName} (마일스톤){e.isDelayed ? ` — ${e.delayDays}일 지연` : ""}</title>
          </g>
        );
      })}
    </svg>
  );
}

// ─── 태스크 미니 타임라인 (±7일, 세그먼트 바) ────────────────────────────────
function TaskMiniTimeline({ task, centerDate }: { task: Task; centerDate: string }) {
  const DAYS = 15;
  const W = 240; // 프로젝트 MiniTimeline과 동일 너비
  const H = 28;
  const DAY_W = W / DAYS;
  const center = new Date(centerDate);
  const winStart = shiftDate(centerDate, -7);
  const winEnd = shiftDate(centerDate, 7);

  function xForDate(dateStr: string) {
    const off = Math.round((new Date(dateStr).getTime() - center.getTime()) / 86400000);
    return ((off + 7) / DAYS) * W;
  }

  const segs = (task.segments ?? []).filter((s) => s.startDate && s.endDate);

  // 마일스톤: 다이아몬드
  if (task.isMilestone && segs[0]) {
    const d = segs[0].startDate.slice(0, 10);
    const inWin = d >= winStart && d <= winEnd;
    const x = xForDate(d);
    const delayed = d < centerDate && (segs[0].progressPercent ?? 0) < 100;
    return (
      <svg width={W} height={H} className="overflow-visible">
        {Array.from({ length: DAYS + 1 }, (_, i) => (
          <line key={i} x1={i * DAY_W} y1={0} x2={i * DAY_W} y2={H} stroke="#94a3b8" strokeWidth={0.5} strokeOpacity={0.25} />
        ))}
        <line x1={xForDate(centerDate)} y1={0} x2={xForDate(centerDate)} y2={H} stroke="#F97316" strokeWidth={1.2} strokeDasharray="3,2" />
        {inWin && (
          <g transform={`translate(${x}, ${H / 2})`}>
            <polygon points="0,-6 6,0 0,6 -6,0" fill={delayed ? "#EF4444" : "#8B5CF6"} />
            <title>{task.name} (마일스톤)</title>
          </g>
        )}
      </svg>
    );
  }

  const bars = segs
    .map((s, i) => {
      const s0 = s.startDate.slice(0, 10);
      const e0 = s.endDate.slice(0, 10);
      if (e0 < winStart || s0 > winEnd) return null;
      const cs = s0 < winStart ? winStart : s0;
      const ce = e0 > winEnd ? winEnd : e0;
      const x1 = Math.max(0, xForDate(cs));
      const x2 = Math.min(W, xForDate(ce) + DAY_W); // 종료일 포함
      const delayed = e0 < centerDate && (s.progressPercent ?? 0) < 100;
      const color = delayed ? "#EF4444" : task.isCritical ? "#F97316" : "#22C55E";
      return (
        <rect key={i} x={x1} y={10} width={Math.max(2, x2 - x1)} height={9} rx="2" fill={color} opacity={0.85}>
          <title>{s.name} ({s.progressPercent ?? 0}%)</title>
        </rect>
      );
    })
    .filter(Boolean);

  return (
    <svg width={W} height={H} className="overflow-visible">
      {Array.from({ length: DAYS + 1 }, (_, i) => (
        <line key={i} x1={i * DAY_W} y1={0} x2={i * DAY_W} y2={H} stroke="#94a3b8" strokeWidth={0.5} strokeOpacity={0.25} />
      ))}
      <line x1={xForDate(centerDate)} y1={0} x2={xForDate(centerDate)} y2={H} stroke="#F97316" strokeWidth={1.2} strokeDasharray="3,2" />
      {bars}
    </svg>
  );
}

// ─── 이슈 팝업 ────────────────────────────────────────────────────────────────

function IssuePopup({ projectId, projectName, category, onClose }: { projectId: string; projectName?: string; category?: string; onClose: () => void }) {
  const [issues, setIssues] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCat, setActiveCat] = useState<string | undefined>(category);

  useEffect(() => {
    dashboardApi.getProjectIssues(projectId)
      .then(setIssues)
      .catch(() => setIssues([]))
      .finally(() => setLoading(false));
  }, [projectId]);

  // 카테고리별 태스크 개수 (상단 전환 탭용 — 팝업 태스크 수와 일치)
  const catCounts: Record<string, number> = {};
  for (const i of issues) { const b = issueBucket(i); catCounts[b] = (catCounts[b] ?? 0) + issueTaskCount(i); }
  const availableCats = ISSUE_BADGE_BUCKETS.filter((b) => (catCounts[b.key] ?? 0) > 0);
  const totalTasks = Object.values(catCounts).reduce((a, b) => a + b, 0);

  // 선택된 카테고리만 (activeCat 없으면 전체)
  const shown = activeCat ? issues.filter((i) => issueBucket(i) === activeCat) : issues;

  // 이슈 → 태스크 단위로 평탄화. 백엔드가 태스크명을 최대 3개까지만 주므로 초과분은 "외 N개".
  const taskRows: { key: string; name: string; id?: string; title: string; cat: string; delayDays?: number; staleDays?: number; endDate?: string; milestoneDate?: string; muted?: boolean }[] = [];
  for (const iss of shown) {
    const bkt = issueBucket(iss);
    const tasks = issueTasks(iss);
    const totalCnt = issueTaskCount(iss);
    if (tasks.length === 0) {
      taskRows.push({ key: iss.id, name: "-", title: iss.title, cat: bkt });
    } else {
      tasks.forEach((tk, i) => taskRows.push({ key: `${iss.id}:${i}`, name: tk.name, id: tk.id, title: iss.title, cat: bkt, delayDays: tk.delayDays, staleDays: tk.staleDays, endDate: tk.endDate, milestoneDate: tk.milestoneDate }));
      const extra = Math.max(0, totalCnt - tasks.length);
      if (extra > 0) taskRows.push({ key: `${iss.id}:more`, name: `외 ${extra}개`, title: iss.title, cat: bkt, muted: true });
    }
  }

  const catMeta = (key: string) => ISSUE_BADGE_BUCKETS.find((b) => b.key === key);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700/60">
          <div className="flex items-baseline gap-4 min-w-0">
            <h3 className="font-semibold text-gray-900 shrink-0">이슈 상세</h3>
            {projectName && (
              <Link href={`/projects/${projectId}`} onClick={onClose} className="text-[13px] text-gray-400 hover:text-gray-600 hover:underline truncate">{projectName}</Link>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none shrink-0">×</button>
        </div>
        {/* 카테고리 전환 탭 */}
        {!loading && availableCats.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-5 py-2.5 border-b border-gray-200 dark:border-gray-700/60">
            <button onClick={() => setActiveCat(undefined)}
              className={`text-xs px-2.5 py-0.5 rounded-full font-medium transition-all ${!activeCat ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-500 opacity-70 hover:opacity-100"}`}>
              전체 {totalTasks}
            </button>
            {availableCats.map((b) => (
              <button key={b.key} onClick={() => setActiveCat(b.key)}
                className={`text-xs px-2.5 py-0.5 rounded-full font-medium transition-all ${b.cls} ${activeCat === b.key ? "opacity-100 font-semibold shadow-sm" : "opacity-45 hover:opacity-75"}`}>
                {b.label} {catCounts[b.key]}
              </button>
            ))}
          </div>
        )}
        <div className="overflow-y-auto flex-1 px-5 py-4">
          {loading ? (
            <p className="text-sm text-gray-400 text-center py-8">로딩 중...</p>
          ) : (
            <Table fixed columnDividers>
              <colgroup>
                <col style={{ width: "84px" }} />
                <col style={{ width: "42%" }} />
                <col />
              </colgroup>
              <THead>
                <Th align="center">분류</Th>
                <Th align="center">태스크명</Th>
                <Th align="center">이슈 내용</Th>
              </THead>
              <TBody>
                {taskRows.length === 0 ? (
                  <TableEmpty colSpan={3}>해당 태스크가 없습니다.</TableEmpty>
                ) : taskRows.map((t) => {
                  const meta = catMeta(t.cat);
                  return (
                    <Tr key={t.key}>
                      <Td align="center">
                        {meta && (
                          <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap ${meta.cls}`}>{meta.label}</span>
                        )}
                      </Td>
                      <Td truncate title={t.name}>
                        {t.id ? (
                          <Link href={`/projects/${projectId}?taskId=${t.id}`} onClick={onClose}
                            className="text-gray-900 dark:text-gray-100 font-medium hover:underline">{t.name}</Link>
                        ) : (
                          <span className={t.muted ? "text-gray-400" : "text-gray-800"}>{t.name}</span>
                        )}
                      </Td>
                      <Td truncate className={t.cat === "MANUAL" ? "text-red-600 dark:text-red-400 font-bold" : "text-gray-900 dark:text-gray-100"}>
                        {renderIssueContent(t)}
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 프로젝트 행 ──────────────────────────────────────────────────────────────

function ProjectRow({ row, date, onPin }: { row: ProjectRow; date: string; onPin: (id: string) => void }) {
  // null=닫힘, "__all__"=전체, 그 외=해당 카테고리만
  const [popupCat, setPopupCat] = useState<string | null>(null);
  const totalIssues = row.issueCount.critical + row.issueCount.warning + row.issueCount.info;
  const issueCat = useContext(IssueCatContext).get(row.id);

  return (
    <>
      {popupCat !== null && <IssuePopup projectId={row.id} projectName={row.name} category={popupCat === "__all__" ? undefined : popupCat} onClose={() => setPopupCat(null)} />}
      <tr className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50 transition-colors">
        {/* RAG + 핀 */}
        <td className="px-3 py-2.5 w-10">
          <div className="flex items-center gap-1.5">
            <span className={`inline-block w-2.5 h-2.5 rounded-full ${RAG_COLOR[row.ragStatus]}`} />
            <button
              onClick={() => onPin(row.id)}
              className={`text-xs leading-none ${row.isPinned ? "text-yellow-500" : "text-gray-300 hover:text-gray-400"}`}
              title={row.isPinned ? "즐겨찾기 해제" : "즐겨찾기"}
            >
              ★
            </button>
          </div>
        </td>

        {/* 프로젝트명 — 남은 폭(반응형), 길면 말줄임 */}
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <Link href={`/projects/${row.id}`} className="text-sm font-medium text-blue-700 dark:text-blue-300 hover:underline truncate" title={row.name}>
              {row.name}
            </Link>
            {row.isCriticalPathDelayed && (
              <span className="shrink-0 text-xs text-red-600 dark:text-red-400 font-medium">CP지연</span>
            )}
          </div>
          <div className="text-xs text-gray-400 mt-0.5">{fmtDate(row.lastUpdatedAt)} 업데이트</div>
        </td>

        {/* 진행률 */}
        <td className="px-3 py-2.5 w-28">
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-gray-200 rounded-full h-1.5 overflow-hidden">
              <div
                className={`h-1.5 rounded-full transition-all ${row.ragStatus === "RED" ? "bg-red-500" : row.ragStatus === "AMBER" ? "bg-yellow-400" : "bg-green-500"}`}
                style={{ width: `${row.overallProgress}%` }}
              />
            </div>
            <span className="text-xs text-gray-600 w-7 text-right">{row.overallProgress}%</span>
          </div>
        </td>


        {/* 이슈 — 카테고리 배지 각각 클릭 → 그 카테고리 태스크만. 로딩 전엔 심각도 숫자 배지 폴백 */}
        <td className="px-3 py-2.5 whitespace-nowrap">
          {totalIssues > 0 ? (
            issueCat ? (
              <div className="flex items-center gap-1 text-xs">
                <IssueCatBadges counts={issueCat} onSelect={setPopupCat} />
              </div>
            ) : (
              <button onClick={() => setPopupCat("__all__")} className="flex items-center gap-1 text-xs">
                {row.issueCount.critical > 0 && (
                  <span className="bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-medium">{row.issueCount.critical}</span>
                )}
                {row.issueCount.warning > 0 && (
                  <span className="bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded">{row.issueCount.warning}</span>
                )}
                {row.issueCount.info > 0 && (
                  <span className="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">{row.issueCount.info}</span>
                )}
              </button>
            )
          ) : (
            <span className="text-xs text-gray-300">-</span>
          )}
        </td>

        {/* 미니 타임라인 */}
        <td className="px-3 py-1.5 w-[270px]">
          <MiniTimeline events={row.weeklyTimeline} centerDate={date} />
        </td>
      </tr>
    </>
  );
}

// ─── 폴더별 프로젝트 (펼침 + ±7일 태스크) ────────────────────────────────────

// 프로젝트 행 — 폴더 뷰용. 펼치면 ±7일 태스크 목록(수동이슈 강조) 표시.
function FolderProjectRow({ row, date, onPin, onSelectTask, ownerName }: { row: ProjectRow; date: string; onPin: (id: string) => void; onSelectTask: (task: Task, projectId: string) => void; ownerName?: string }) {
  const [expanded, setExpanded] = useState(false); // 기본 접힘 — 사용자가 하나씩 펼침
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [issueTaskIds, setIssueTaskIds] = useState<Set<string>>(new Set());
  // 태스크별 미해결 이슈 내용 / 최근 비고 내용 (중간 컬럼용)
  const [issueByTask, setIssueByTask] = useState<Map<string, string>>(new Map());
  const [noteByTask, setNoteByTask] = useState<Map<string, string>>(new Map());
  const [loadingTasks, setLoadingTasks] = useState(false);
  // null=닫힘, "__all__"=전체, 그 외=해당 카테고리만
  const [popupCat, setPopupCat] = useState<string | null>(null);
  const headerRowRef = useRef<HTMLTableRowElement>(null);

  // 접을 때 해당 프로젝트(헤더 행) 위치로 스크롤 복귀 — 태스크를 펼쳐 아래로 내려간 뒤 접어도 위치 유지
  const collapse = () => {
    setExpanded(false);
    requestAnimationFrame(() => headerRowRef.current?.scrollIntoView({ block: "start", behavior: "auto" }));
  };

  const winStart = shiftDate(date, -7);
  const winEnd = shiftDate(date, 7);
  const totalIssues = row.issueCount.critical + row.issueCount.warning + row.issueCount.info;
  const issueCat = useContext(IssueCatContext).get(row.id);

  useEffect(() => {
    if (!expanded || tasks !== null) return;
    let cancelled = false;
    setLoadingTasks(true);
    Promise.all([
      projectApi.gantt(row.id).then((g: any) => (g?.tasks ?? []) as Task[]).catch(() => [] as Task[]),
      dashboardApi.getProjectIssues(row.id).catch(() => [] as any[]),
      workLogApi.listByProject(row.id, { limit: 500 }).catch(() => ({ items: [] as any[], nextCursor: null })),
    ])
      .then(([ts, iss, wl]) => {
        if (cancelled) return;
        setTasks(ts ?? []);
        const ids = new Set<string>();
        const issueMap = new Map<string, string>();
        for (const i of iss ?? []) {
          if (i.category === "MANUAL_ISSUE" && i.taskId) {
            ids.add(i.taskId);
            // issue-detector가 createdAt desc로 반환 → taskId별 최초=가장 최근
            if (!issueMap.has(i.taskId)) issueMap.set(i.taskId, i.description || i.title || "");
          }
        }
        setIssueTaskIds(ids);
        setIssueByTask(issueMap);
        // 비고: listByProject는 workedAt desc 정렬 → taskId별 최초=가장 최근
        const noteMap = new Map<string, string>();
        for (const w of (wl?.items ?? [])) {
          if (w.taskId && !noteMap.has(w.taskId)) noteMap.set(w.taskId, w.content);
        }
        setNoteByTask(noteMap);
      })
      .finally(() => !cancelled && setLoadingTasks(false));
    return () => { cancelled = true; };
  }, [expanded, tasks, row.id]);

  // ±7일에 걸리는 리프 태스크 + 조상을 트리로 (상위는 이름만, 리프에만 기간)
  const treeRows = buildTaskTreeRows(tasks ?? [], winStart, winEnd);

  return (
    <>
      {popupCat !== null && <IssuePopup projectId={row.id} projectName={row.name} category={popupCat === "__all__" ? undefined : popupCat} onClose={() => setPopupCat(null)} />}

      <tr ref={headerRowRef} className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50 transition-colors scroll-mt-16">
        <td className="px-3 py-2.5 w-10">
          <div className="flex items-center gap-1.5">
            <span className={`inline-block w-2.5 h-2.5 rounded-full ${RAG_COLOR[row.ragStatus]}`} />
            <button
              onClick={() => onPin(row.id)}
              className={`text-xs leading-none ${row.isPinned ? "text-yellow-500" : "text-gray-300 hover:text-gray-400"}`}
              title={row.isPinned ? "즐겨찾기 해제" : "즐겨찾기"}
            >
              ★
            </button>
          </div>
        </td>

        {/* 프로젝트명 + 펼침 토글 */}
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <button
              onClick={() => (expanded ? collapse() : setExpanded(true))}
              className="text-gray-400 hover:text-gray-600 text-xs w-4 shrink-0"
              title={expanded ? "태스크 접기" : "태스크 펼치기"}
            >
              {expanded ? "▼" : "▶"}
            </button>
            <Link href={`/projects/${row.id}`} className="text-sm font-medium text-blue-700 dark:text-blue-300 hover:underline truncate" title={row.name}>
              {row.name}
            </Link>
            {row.isCriticalPathDelayed && (
              <span className="shrink-0 text-xs text-red-600 dark:text-red-400 font-medium">CP지연</span>
            )}
          </div>
          <div className="text-xs text-gray-400 mt-0.5 pl-5">{fmtDate(row.lastUpdatedAt)} 업데이트</div>
        </td>

        {/* 소유자 — 프로젝트명과 타임라인 사이 */}
        <td className="px-3 py-2.5 w-[120px] text-xs text-gray-500">
          <span className="truncate block">
            {ownerName ? <span title={`프로젝트 소유자: ${ownerName}`}>{ownerName}</span> : <span className="text-gray-300">-</span>}
          </span>
        </td>

        {/* 미니 타임라인 */}
        <td className="px-3 py-1.5 w-[260px]">
          <MiniTimeline events={row.weeklyTimeline} centerDate={date} />
        </td>

        {/* 자원 — 접힌 행에선 비움(펼치면 태스크별 담당자 표시) */}
        <td className="px-3 py-2.5 w-[160px] text-xs text-gray-300">-</td>

        {/* 진행률 — 타임라인 옆 (간격 넓힘) */}
        <td className="pl-10 pr-3 py-2.5 w-28">
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-gray-200 rounded-full h-1.5 overflow-hidden">
              <div
                className={`h-1.5 rounded-full transition-all ${row.ragStatus === "RED" ? "bg-red-500" : row.ragStatus === "AMBER" ? "bg-yellow-400" : "bg-green-500"}`}
                style={{ width: `${row.overallProgress}%` }}
              />
            </div>
            <span className="text-xs text-gray-600 w-7 text-right">{row.overallProgress}%</span>
          </div>
        </td>

        {/* 이슈 — 카테고리 배지(지연/이슈/정체/예정/마일스톤). 로딩 전엔 심각도 숫자 배지 폴백 */}
        <td className="pl-10 pr-3 py-2.5 whitespace-nowrap">
          {totalIssues > 0 ? (
            issueCat ? (
              <div className="flex items-center gap-1 text-xs">
                <IssueCatBadges counts={issueCat} onSelect={setPopupCat} />
              </div>
            ) : (
              <button onClick={() => setPopupCat("__all__")} className="flex items-center gap-1 text-xs">
                {row.issueCount.critical > 0 && (
                  <span className="bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-medium">{row.issueCount.critical}</span>
                )}
                {row.issueCount.warning > 0 && (
                  <span className="bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded">{row.issueCount.warning}</span>
                )}
                {row.issueCount.info > 0 && (
                  <span className="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">{row.issueCount.info}</span>
                )}
              </button>
            )
          ) : (
            <span className="text-xs text-gray-300">-</span>
          )}
        </td>

        {/* 여백 — 남는 가로를 오른쪽 끝에서 흡수 */}
        <td />
      </tr>

      {/* 펼침: ±7일 태스크 */}
      {expanded && (
        <tr className="border-b border-gray-100 last:border-b-0 bg-gray-50/50">
          <td />
          <td colSpan={7} className="px-3 py-2">
            {loadingTasks && <span className="text-xs text-gray-400">태스크 불러오는 중…</span>}
            {!loadingTasks && treeRows.length === 0 && (
              <span className="text-xs text-gray-400">전주·이번주(±7일)에 해당하는 태스크가 없습니다.</span>
            )}
            {!loadingTasks && treeRows.length > 0 && (
              <ul className="space-y-0.5">
                {treeRows.map(({ task: t, depth, isLeaf }) => {
                  const hasIssue = issueTaskIds.has(t.id);
                  const issueText = issueByTask.get(t.id);
                  const noteText = noteByTask.get(t.id);
                  // 태스크 자원(담당자) 이름 — gantt 데이터의 resourceName 그대로 사용
                  const assigneeNames = isLeaf
                    ? Array.from(new Set(
                        (t.segments ?? []).flatMap((s: any) => (s.assignments ?? []).map((a: any) => a.resourceName as string).filter(Boolean)),
                      ))
                    : [];
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => onSelectTask(t, row.id)}
                        className={`w-full text-left flex items-center gap-3 text-sm rounded px-2 py-1.5 border transition-colors ${
                          hasIssue
                            ? "bg-red-50 border-red-300 text-red-800 dark:bg-red-500/10 hover:bg-red-100"
                            : isLeaf
                            ? "bg-white border-gray-100 text-gray-700 hover:bg-blue-50"
                            : "bg-gray-50 border-transparent text-gray-800 hover:bg-blue-50"
                        }`}
                      >
                        {/* 이름 존 — 고정폭(320px). 트리 들여쓰기는 내부 padding으로 처리해
                            깊이와 무관하게 뒤따르는 타임라인 위치를 고정 */}
                        <span
                          className="w-[400px] shrink-0 flex items-center gap-1 overflow-hidden"
                          style={{ paddingLeft: depth * 18 }}
                        >
                          {isLeaf && depth > 0 && <span className="text-gray-300 shrink-0">└</span>}
                          {t.isMilestone && <span className="text-purple-600 shrink-0" title="마일스톤">◆</span>}
                          {!isLeaf && <span className="text-gray-300 shrink-0">▸</span>}
                          <span className={`truncate min-w-0 ${!isLeaf ? "font-semibold" : hasIssue ? "font-semibold" : "font-medium"}`}>{t.name}</span>
                        </span>
                        {isLeaf && (
                          <>
                            {/* 태스크명 → 타임라인 → 자원 → 비고 → 이슈. 타임라인은 프로젝트 행과 동일 위치 */}
                            <span className="shrink-0 w-[260px]">
                              <TaskMiniTimeline task={t} centerDate={date} />
                            </span>
                            {/* 자원(담당자) — 아바타 스택(간트와 동일), 최대 3 + +N */}
                            <span className="shrink-0 w-[160px] flex items-center">
                              {assigneeNames.length > 0 ? (
                                <>
                                  {assigneeNames.slice(0, 4).map((name, idx) => (
                                    <span
                                      key={name}
                                      title={name}
                                      className={`w-6 h-6 rounded-full ${avatarColor(name)} flex items-center justify-center text-white text-[9px] font-bold ring-2 ring-white shrink-0`}
                                      style={{ marginLeft: idx === 0 ? 0 : -8, zIndex: 4 - idx }}
                                    >
                                      {name.slice(0, 2)}
                                    </span>
                                  ))}
                                  {assigneeNames.length > 4 && (
                                    <span
                                      className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-[8px] font-bold ring-2 ring-white shrink-0"
                                      style={{ marginLeft: -8, zIndex: 0 }}
                                      title={assigneeNames.slice(4).join(", ")}
                                    >
                                      +{assigneeNames.length - 4}
                                    </span>
                                  )}
                                </>
                              ) : (
                                <span className="text-gray-300 text-sm">-</span>
                              )}
                            </span>
                            {/* 비고 컬럼 */}
                            <span className="flex-1 min-w-0 truncate">
                              {noteText
                                ? <span className="text-gray-500" title={noteText}>{noteText}</span>
                                : <span className="text-gray-300">-</span>}
                            </span>
                            {/* 이슈 컬럼 */}
                            <span className="flex-1 min-w-0 truncate">
                              {issueText
                                ? <span className="text-red-600 font-medium" title={issueText}>{issueText}</span>
                                : <span className="text-gray-300">-</span>}
                            </span>
                          </>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {/* 하단 접기 — 위로 스크롤하지 않고 바로 접기 */}
            {!loadingTasks && (
              <div className="mt-2 flex justify-center">
                <button
                  type="button"
                  onClick={collapse}
                  className="text-xs text-gray-400 hover:text-gray-600 px-3 py-1 rounded hover:bg-gray-100 transition-colors"
                >
                  ▲ 접기
                </button>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// 폴더 섹션 (부서 폴더 등) — 프로젝트 표 아코디언
function FolderSection({ name, isDept, rows, date, onPin, onSelectTask, ownerByProject, open, onToggle }: { name: string; isDept: boolean; rows: ProjectRow[]; date: string; onPin: (id: string) => void; onSelectTask: (task: Task, projectId: string) => void; ownerByProject: Map<string, string>; open: boolean; onToggle: () => void }) {
  return (
    <div>
      <button
        className="w-full flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-left transition-colors"
        onClick={onToggle}
      >
        <span className="text-gray-400 text-xs w-4">{open ? "▼" : "▶"}</span>
        {isDept && <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded shrink-0">부서</span>}
        <span className="font-semibold text-gray-800 flex-1">{name}</span>
        <span className="text-xs text-gray-500">{rows.length}개 프로젝트</span>
      </button>
      {open && (
        <div className="mt-1 rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full table-fixed">
            <thead>
              <tr className="bg-gray-50 text-xs font-medium text-gray-600 border-b border-gray-200">
                <th className="px-3 py-1.5 text-left w-10"></th>
                <th className="px-3 py-1.5 text-left w-[280px]">프로젝트</th>
                <th className="px-3 py-1.5 text-left w-[120px]">소유자</th>
                <th className="px-3 py-1.5 text-left w-[260px]">타임라인 (±7일)</th>
                <th className="px-3 py-1.5 text-left w-[160px]">자원</th>
                <th className="pl-10 pr-3 py-1.5 text-left w-28">진행률</th>
                <th className="pl-10 pr-3 py-1.5 text-left w-24">이슈</th>
                <th className="px-3 py-1.5 text-left"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <FolderProjectRow key={p.id} row={p} date={date} onPin={onPin} onSelectTask={onSelectTask} ownerName={ownerByProject.get(p.id)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// 폴더(부서 자동 구조) 기준으로 프로젝트를 그룹핑해 렌더
function FolderProjectsView({ folders, projects, date, onPin, onSelectTask, ownerByProject }: { folders: Folder[]; projects: ProjectRow[]; date: string; onPin: (id: string) => void; onSelectTask: (task: Task, projectId: string) => void; ownerByProject: Map<string, string> }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const byId = new Map(projects.map((p) => [p.id, p]));
  // 어느 폴더에든 담긴 프로젝트 (미분류 계산용) — 여러 폴더에 중복 표시는 허용(자동+수동 모두 반영)
  const seen = new Set<string>();

  // folderApi.list()는 sortOrder(부서 순서) 오름차순 정렬 상태로 반환됨
  const sections = folders
    .filter((f) => f.parentId === null)
    .map((f) => {
      const rows: ProjectRow[] = [];
      const localSeen = new Set<string>();
      for (const item of f.projects ?? []) {
        // 전사 대시보드는 mandatory(부서 자동 분류)만 — 팀장이 수동 추가한 즐겨찾기(auto=false)는 제외
        if (item.auto !== true) continue;
        if (localSeen.has(item.projectId)) continue; // 같은 폴더 내 중복만 제거
        const r = byId.get(item.projectId);
        if (r) {
          rows.push(r);
          localSeen.add(item.projectId);
          seen.add(item.projectId);
        }
      }
      return { folder: f, rows };
    })
    .filter((s) => s.rows.length > 0);

  const unfiled = projects.filter((p) => !seen.has(p.id));

  // 부서 폴더 전체 접기/펼치기
  const allKeys = [...sections.map((s) => s.folder.id), ...(unfiled.length > 0 ? ["__unfiled__"] : [])];
  const allCollapsed = allKeys.length > 0 && allKeys.every((k) => collapsed.has(k));
  const toggleOne = (key: string) => setCollapsed((prev) => {
    const n = new Set(prev);
    if (n.has(key)) n.delete(key); else n.add(key);
    return n;
  });
  const toggleAll = () => setCollapsed(allCollapsed ? new Set() : new Set(allKeys));

  return (
    <div className="space-y-3">
      {allKeys.length > 0 && (
        <div className="flex justify-end">
          <button
            onClick={toggleAll}
            className="text-xs px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-gray-600"
          >
            {allCollapsed ? "전체 펼치기" : "전체 접기"}
          </button>
        </div>
      )}
      {sections.map((s) => (
        <FolderSection
          key={s.folder.id}
          name={s.folder.name}
          isDept={!!s.folder.departmentId}
          rows={s.rows}
          date={date}
          onPin={onPin}
          onSelectTask={onSelectTask}
          ownerByProject={ownerByProject}
          open={!collapsed.has(s.folder.id)}
          onToggle={() => toggleOne(s.folder.id)}
        />
      ))}
      {unfiled.length > 0 && (
        <FolderSection name="미분류" isDept={false} rows={unfiled} date={date} onPin={onPin} onSelectTask={onSelectTask} ownerByProject={ownerByProject} open={!collapsed.has("__unfiled__")} onToggle={() => toggleOne("__unfiled__")} />
      )}
    </div>
  );
}

// ─── 그룹 Accordion ───────────────────────────────────────────────────────────

function GroupAccordion({ group, date, onPin }: { group: DashboardGroup; date: string; onPin: (id: string) => void }) {
  const [open, setOpen] = useState(true);
  const ic = group.rollup.issueCount;
  const sc = group.rollup.statusCount;

  return (
    <div className="mb-3">
      <button
        className="w-full flex items-center gap-3 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-left transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="text-gray-400 text-xs w-4">{open ? "▼" : "▶"}</span>
        {group.color && (
          <span className="inline-block w-3 h-3 rounded-full flex-shrink-0" style={{ background: group.color }} />
        )}
        <span className="font-semibold text-gray-800 flex-1">{group.name}</span>
        <span className="text-xs text-gray-500">{group.rollup.totalProjects}개 프로젝트</span>
        <span className="text-xs text-gray-500">진행률 {group.rollup.weightedProgress}%</span>
        {ic.critical > 0 && <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">{ic.critical}건 위험</span>}
        {ic.warning > 0 && <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded">{ic.warning}건 경고</span>}
        <span className="text-xs text-green-600 dark:text-green-400">{sc.onTrack} 정상</span>
        {sc.warning > 0 && <span className="text-xs text-yellow-600 dark:text-yellow-400">{sc.warning} 경고</span>}
        {sc.critical > 0 && <span className="text-xs text-red-600 dark:text-red-400">{sc.critical} 위험</span>}
      </button>
      {open && group.projects.length > 0 && (
        <div className="mt-1 rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full table-fixed">
            <thead>
              <tr className="bg-gray-50 text-xs font-medium text-gray-600 border-b border-gray-200">
                <th className="px-3 py-1.5 text-left w-10"></th>
                <th className="px-3 py-1.5 text-left">프로젝트</th>
                <th className="px-3 py-1.5 text-left w-28">진행률</th>
                <th className="px-3 py-1.5 text-left w-24">이슈</th>
                <th className="px-3 py-1.5 text-left w-[270px]">타임라인 (±7일)</th>
              </tr>
            </thead>
            <tbody>
              {group.projects.map((p) => (
                <ProjectRow key={p.id} row={p} date={date} onPin={onPin} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && group.projects.length === 0 && (
        <p className="text-xs text-gray-400 px-4 py-2">프로젝트 없음</p>
      )}
    </div>
  );
}

// ─── 요약 카드 상세 팝업 ─────────────────────────────────────────────────────

const RAG_LABEL: Record<string, { text: string; cls: string }> = {
  GREEN: { text: "정상", cls: "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300" },
  AMBER: { text: "경고", cls: "bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300" },
  RED: { text: "위험", cls: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300" },
};

const SEV_KO: Record<string, string> = { CRITICAL: "위험", WARNING: "경고", INFO: "정보" };
// 상태 배지 hover 시 보여줄 이슈 설명 (네이티브 title, 멀티라인)
function ragTooltip(ragStatus: string, issues?: any[]): string {
  if (!issues || issues.length === 0) {
    return ragStatus === "GREEN" ? "이상 없음 — 감지된 이슈가 없습니다" : "이슈 정보를 불러오는 중…";
  }
  return issues
    .map((i: any) => `[${SEV_KO[i.severity] ?? i.severity}] ${i.title}${i.description ? `\n   · ${i.description}` : ""}`)
    .join("\n");
}
// 이슈 카운트 배지(심각도별) hover 툴팁
function severityTooltip(issues: any[] | undefined, severity: string): string {
  const list = (issues ?? []).filter((i: any) => i.severity === severity);
  const label = SEV_KO[severity] ?? severity;
  if (list.length === 0) return `${label} 이슈`;
  return `${label} 이슈\n` + list
    .map((i: any) => `· ${i.title}${i.description ? `\n   ${i.description}` : ""}`)
    .join("\n");
}

const STATUS_LABEL: Record<string, string> = {
  PLANNING: "계획", IN_PROGRESS: "진행", ON_HOLD: "보류", COMPLETED: "완료", CANCELLED: "취소",
};

const SEV_STYLE: Record<string, string> = {
  CRITICAL: "bg-red-50 text-red-800 dark:text-red-50",
  WARNING: "bg-yellow-50 text-yellow-800 dark:text-yellow-50",
  INFO: "bg-blue-50 text-blue-800 dark:text-blue-50",
};

function SummaryDetailPopup({ type, date, categoryFilter, onClose }: { type: string; date: string; categoryFilter?: string | null; onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  // 상태 배지 툴팁용: 프로젝트별 이슈 상세 (제목/설명/심각도)
  const [issuesByProject, setIssuesByProject] = useState<Record<string, any[]>>({});

  useEffect(() => {
    dashboardApi.getSummaryDetails(type, date)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [type, date]);

  // 전체 프로젝트 카드: 이슈 있는 프로젝트의 상세를 받아 상태 배지 툴팁에 표시
  useEffect(() => {
    if (type !== "projects" || !Array.isArray(data)) return;
    const targets = data.filter((p: any) =>
      ((p.issueCount?.critical ?? 0) + (p.issueCount?.warning ?? 0) + (p.issueCount?.info ?? 0)) > 0,
    );
    if (targets.length === 0) return;
    Promise.all(targets.map((p: any) =>
      dashboardApi.getProjectIssues(p.id)
        .then((iss: any[]) => [p.id, iss] as const)
        .catch(() => [p.id, []] as const),
    )).then((entries) => setIssuesByProject(Object.fromEntries(entries)));
  }, [type, data]);

  const TITLE: Record<string, string> = {
    projects: "프로젝트 현황",
    issues: "이슈 현황",
    starting: "이번 주 시작 세그먼트",
    ending: "이번 주 완료 / 마일스톤",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="font-semibold text-gray-900">{TITLE[type] ?? type}{type === "issues" && categoryFilter ? ` · ${ISSUE_BUCKET_LABEL[categoryFilter] ?? ""}` : ""}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">&times;</button>
        </div>
        <div className="overflow-y-auto flex-1 p-4">
          {loading && <p className="text-sm text-gray-400 text-center py-8">로딩 중...</p>}
          {!loading && !data && <p className="text-sm text-gray-400 text-center py-8">데이터 없음</p>}

          {/* 전체 프로젝트 */}
          {!loading && type === "projects" && Array.isArray(data) && (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs font-medium text-gray-600 border-b border-gray-200">
                  <th className="py-1.5 text-left px-2">상태</th>
                  <th className="py-1.5 text-left px-2">프로젝트</th>
                  <th className="py-1.5 text-right px-2">진행률</th>
                  <th className="py-1.5 text-right px-2">이슈</th>
                </tr>
              </thead>
              <tbody>
                {data.map((p: any) => {
                  const rag = RAG_LABEL[p.ragStatus] ?? RAG_LABEL.GREEN;
                  return (
                    <tr key={p.id} className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50">
                      <td className="py-2 px-2">
                        <span title={ragTooltip(p.ragStatus, issuesByProject[p.id])} className={`text-[11px] px-2 py-0.5 rounded-full font-medium cursor-help ${rag.cls}`}>{rag.text}</span>
                      </td>
                      <td className="py-2 px-2">
                        <Link href={`/projects/${p.id}`} className="text-blue-600 dark:text-blue-400 hover:underline" onClick={onClose}>
                          {p.name}
                        </Link>
                        <span className="ml-2 text-xs text-gray-400">{STATUS_LABEL[p.status] ?? p.status}</span>
                      </td>
                      <td className="py-2 px-2 text-right">{p.overallProgress}%</td>
                      <td className="py-2 px-2 text-right">
                        {p.issueCount.critical > 0 && <span title={severityTooltip(issuesByProject[p.id], "CRITICAL")} className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded mr-1 cursor-help">{p.issueCount.critical}</span>}
                        {p.issueCount.warning > 0 && <span title={severityTooltip(issuesByProject[p.id], "WARNING")} className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded mr-1 cursor-help">{p.issueCount.warning}</span>}
                        {p.issueCount.info > 0 && <span title={severityTooltip(issuesByProject[p.id], "INFO")} className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded cursor-help">{p.issueCount.info}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* 전체 이슈 */}
          {!loading && type === "issues" && Array.isArray(data) && (
            <div className="space-y-4">
              {(() => {
                const items = categoryFilter ? data.filter((it: any) => issueBucket(it?.issue ?? {}) === categoryFilter) : data;
                if (items.length === 0) return <p className="text-sm text-gray-400 text-center py-6">이슈 없음</p>;
                const SEV_ORDER: Record<string, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };
                const grouped = new Map<string, { projectId: string; projectName: string; items: any[] }>();
                for (const item of items) {
                  const key = item.projectId ?? "unknown";
                  if (!grouped.has(key)) grouped.set(key, { projectId: key, projectName: item.projectName ?? key, items: [] });
                  grouped.get(key)!.items.push(item);
                }
                for (const g of grouped.values()) {
                  g.items.sort((a: any, b: any) => (SEV_ORDER[a.issue.severity] ?? 9) - (SEV_ORDER[b.issue.severity] ?? 9));
                }
                return Array.from(grouped.values()).map((group) => (
                  <div key={group.projectId}>
                    <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-gray-200">
                      <Link href={`/projects/${group.projectId}`} className="text-sm font-bold text-gray-800 hover:text-blue-600" onClick={onClose}>
                        {group.projectName}
                      </Link>
                      <span className="text-[11px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">{group.items.length}건</span>
                    </div>
                    <div className="space-y-1.5">
                      {group.items.map((item: any, idx: number) => {
                        const taskNames: string[] = item.issue.taskName
                          ? [item.issue.taskName]
                          : (item.issue.metadata?.tasks as any[])?.map((t: any) => t.name).filter(Boolean) ?? [];
                        return (
                          <div key={idx} className={`rounded-lg px-4 py-2.5 text-sm ${SEV_STYLE[item.issue.severity] ?? ""}`}>
                            <div className="flex items-center justify-between">
                              <span className="font-medium">{item.issue.title}</span>
                              <span className="text-[11px] opacity-70">{item.issue.severity}</span>
                            </div>
                            <div className="text-xs opacity-80 mt-0.5">{item.issue.description}</div>
                            {taskNames.length > 0 && (
                              <div className="text-xs opacity-60 mt-1">태스크: {taskNames.join(", ")}</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ));
              })()}
            </div>
          )}

          {/* 이번 주 시작 */}
          {!loading && type === "starting" && Array.isArray(data) && (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs font-medium text-gray-600 border-b border-gray-200">
                  <th className="py-1.5 text-left px-2">시작일</th>
                  <th className="py-1.5 text-left px-2">프로젝트</th>
                  <th className="py-1.5 text-left px-2">태스크 / 세그먼트</th>
                  <th className="py-1.5 text-left px-2">담당</th>
                </tr>
              </thead>
              <tbody>
                {data.length === 0 && (
                  <tr><td colSpan={4} className="text-center py-6 text-gray-400">이번 주 시작 세그먼트 없음</td></tr>
                )}
                {data.map((s: any) => (
                  <tr key={s.segmentId} className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50">
                    <td className="py-2 px-2 text-xs whitespace-nowrap">{s.startDate}</td>
                    <td className="py-2 px-2">
                      <Link href={`/projects/${s.projectId}`} className="text-blue-600 dark:text-blue-400 hover:underline text-xs" onClick={onClose}>
                        {s.projectName}
                      </Link>
                    </td>
                    <td className="py-2 px-2">
                      <div className="text-xs">{s.taskName}</div>
                      <div className="text-[11px] text-gray-400">{s.segmentName}</div>
                    </td>
                    <td className="py-2 px-2 text-xs text-gray-500">{s.assignees?.join(", ") || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* 이번 주 완료/마일스톤 */}
          {!loading && type === "ending" && data && (
            <div className="space-y-4">
              <div>
                <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">완료 예정 세그먼트</h4>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-xs font-medium text-gray-600 border-b border-gray-200">
                      <th className="py-1.5 text-left px-2">완료일</th>
                      <th className="py-1.5 text-left px-2">프로젝트</th>
                      <th className="py-1.5 text-left px-2">태스크 / 세그먼트</th>
                      <th className="py-1.5 text-right px-2">진행률</th>
                      <th className="py-1.5 text-left px-2">담당</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(!data.endingSegments || data.endingSegments.length === 0) && (
                      <tr><td colSpan={5} className="text-center py-4 text-gray-400 text-xs">완료 예정 없음</td></tr>
                    )}
                    {data.endingSegments?.map((s: any) => (
                      <tr key={s.segmentId} className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50">
                        <td className="py-2 px-2 text-xs whitespace-nowrap">{s.endDate}</td>
                        <td className="py-2 px-2">
                          <Link href={`/projects/${s.projectId}`} className="text-blue-600 dark:text-blue-400 hover:underline text-xs" onClick={onClose}>
                            {s.projectName}
                          </Link>
                        </td>
                        <td className="py-2 px-2">
                          <div className="text-xs">{s.taskName}</div>
                          <div className="text-[11px] text-gray-400">{s.segmentName}</div>
                        </td>
                        <td className="py-2 px-2 text-xs text-right">
                          <span className={s.progressPercent < 50 ? "text-red-600 dark:text-red-400 font-medium" : ""}>{s.progressPercent}%</span>
                        </td>
                        <td className="py-2 px-2 text-xs text-gray-500">{s.assignees?.join(", ") || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.milestones && data.milestones.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">마일스톤</h4>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-xs font-medium text-gray-600 border-b border-gray-200">
                        <th className="py-1.5 text-left px-2">기한</th>
                        <th className="py-1.5 text-left px-2">프로젝트</th>
                        <th className="py-1.5 text-left px-2">마일스톤</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.milestones.map((m: any) => (
                        <tr key={m.taskId} className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50">
                          <td className="py-2 px-2 text-xs whitespace-nowrap">{m.dueDate}</td>
                          <td className="py-2 px-2">
                            <Link href={`/projects/${m.projectId}`} className="text-blue-600 dark:text-blue-400 hover:underline text-xs" onClick={onClose}>
                              {m.projectName}
                            </Link>
                          </td>
                          <td className="py-2 px-2 text-xs">{m.taskName}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 이슈 카테고리 버킷 ───────────────────────────────────────────────────────
// 심각도(위험/경고/정보) 대신 백엔드 issue-detector의 category로 분류.
// 이슈 박스엔 '문제성' 3종만: 지연/이슈/정체. 완료예정(SCHEDULE_DELAY·INFO)·마일스톤은 상단 KPI로 분리.
function issueBucket(iss: { category?: string; severity?: string }): string {
  if (iss.category === "SCHEDULE_DELAY") return iss.severity === "INFO" ? "DUE_SOON" : "DELAY";
  if (iss.category === "MANUAL_ISSUE") return "MANUAL";
  if (iss.category === "PROGRESS_STALE") return "STALE";
  if (iss.category === "MILESTONE_DUE") return "MILESTONE";
  if (iss.category === "BUDGET_OVERRUN") return "BUDGET";
  return "OTHER";
}

// 이슈 1건이 실제로 포함하는 '태스크 수' (배지·탭 개수 = 팝업 태스크 수 일치용).
// 지연/정체/예정은 집계 카운트, 직접추가·마일스톤은 태스크 1개.
function issueTaskCount(iss: any): number {
  return iss?.metadata?.delayedCount ?? iss?.metadata?.staleCount ?? iss?.metadata?.count
    ?? (iss?.taskName ? 1 : (iss?.metadata?.tasks?.length ?? 1));
}
// 이슈 박스에 노출할 문제성 카테고리 (지연/이슈/정체)
const ISSUE_BUCKETS: { key: string; label: string; cls: string }[] = [
  { key: "MANUAL", label: "이슈", cls: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300" },
  { key: "DELAY",  label: "지연", cls: "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300" },
  { key: "STALE",  label: "정체", cls: "bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300" },
];
const ISSUE_BUCKET_LABEL: Record<string, string> = {
  DELAY: "지연", MANUAL: "이슈", STALE: "정체", DUE_SOON: "완료예정", MILESTONE: "마일스톤", BUDGET: "예산", OTHER: "기타",
};

// 프로젝트별 카테고리 개수 맵을 상단 카드·본문 행이 공유 (getSummaryDetails 1회 → 전역 공유)
const IssueCatContext = createContext<Map<string, Record<string, number>>>(new Map());

// 본문 이슈 열 배지용 카테고리 (지연=빨강·이슈=주황·정체=노랑·예정=파랑·마일스톤=보라)
const ISSUE_BADGE_BUCKETS: { key: string; label: string; cls: string }[] = [
  { key: "MANUAL",    label: "이슈",   cls: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300" },
  { key: "DELAY",     label: "지연",   cls: "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300" },
  { key: "STALE",     label: "정체",   cls: "bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300" },
  { key: "DUE_SOON",  label: "예정",   cls: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300" },
  { key: "MILESTONE", label: "마일스톤", cls: "bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300" },
];

// 이슈 객체에서 관련 태스크(이름+ID+원시 상세값) 추출 (백엔드 metadata 기준)
// 완료예정(segments)만 ID가 없어 이동 불가 → id undefined.
type IssueTask = { name: string; id?: string; delayDays?: number; staleDays?: number; endDate?: string; milestoneDate?: string };
function issueTasks(iss: any): IssueTask[] {
  if (iss?.taskName) {
    return [{ name: iss.taskName, id: iss?.taskId, milestoneDate: iss?.metadata?.milestoneDate }];
  }
  const t = iss?.metadata?.tasks;
  if (Array.isArray(t)) return t.map((x: any) => ({ name: x?.name, id: x?.id, delayDays: x?.delayDays, staleDays: x?.staleDays })).filter((x: any) => x.name);
  const s = iss?.metadata?.segments;
  if (Array.isArray(s)) return s.map((x: any) => ({ name: x?.taskName, endDate: x?.endDate })).filter((x: any) => x.name);
  return [];
}

// MM/DD 포맷
function mmdd(dateStr?: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}
// MM/DD, 요일 포맷 (예: "07/20, 월")
function mmddDow(dateStr?: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const dow = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
  return `${mmdd(dateStr)}, ${dow}`;
}

// 이슈 내용 문장 구성 — 숫자만 굵게. (지연 delayDays는 백엔드 배포 후 값이 들어옴)
function renderIssueContent(t: { cat: string; title: string; delayDays?: number; staleDays?: number; endDate?: string; milestoneDate?: string }) {
  const B = (s: string) => <strong className="font-bold">{s}</strong>;
  if (t.cat === "DELAY" && t.delayDays != null) {
    const prefix = t.title.replace(/\s*지연$/, ""); // "태스크 일정" | "크리티컬 패스"
    return <>{prefix} {B(`${t.delayDays}일`)} 지연</>;
  }
  if (t.cat === "STALE" && t.staleDays != null) {
    return <>업데이트 {B(`${t.staleDays}일`)} 미갱신</>;
  }
  if (t.cat === "DUE_SOON" && t.endDate) {
    return <>이번 주({B(mmddDow(t.endDate))}) 완료 예정</>;
  }
  if (t.cat === "MILESTONE" && t.milestoneDate) {
    return <>{t.title} ({mmdd(t.milestoneDate)})</>;
  }
  return <>{t.title}</>;
}

// 이슈 열 배지: 카테고리별 "라벨 N" 색 배지 (0인 카테고리는 숨김).
// onSelect 있으면 각 배지가 버튼 → 그 카테고리만 필터해 팝업 열기.
function IssueCatBadges({ counts, onSelect }: { counts?: Record<string, number>; onSelect?: (key: string) => void }) {
  if (!counts) return null;
  return (
    <>
      {ISSUE_BADGE_BUCKETS.map((b) => {
        const n = counts[b.key] ?? 0;
        if (n === 0) return null;
        const cls = `px-1.5 py-0.5 rounded font-medium whitespace-nowrap ${b.cls}`;
        return onSelect ? (
          <button key={b.key} type="button"
            onClick={(e) => { e.stopPropagation(); onSelect(b.key); }}
            className={`${cls} hover:ring-2 hover:ring-blue-300 transition-shadow`}>
            {b.label} {n}
          </button>
        ) : (
          <span key={b.key} className={cls}>{b.label} {n}</span>
        );
      })}
    </>
  );
}

// ─── 전체 요약 카드 ───────────────────────────────────────────────────────────

function GlobalSummaryCards({ summary, date }: { summary: GlobalSummary; date: string }) {
  const sc = summary.statusCount;
  const ic = summary.issueCount;
  const we = summary.thisWeekEvents;
  const [detailType, setDetailType] = useState<string | null>(null);
  const [issueCatFilter, setIssueCatFilter] = useState<string | null>(null);
  // 프로젝트별 카테고리 맵(Context)에서 전역 합계 계산 — 별도 fetch 불필요(부모가 1회 fetch)
  const issueCatMap = useContext(IssueCatContext);
  const issueCounts = useMemo(() => {
    if (issueCatMap.size === 0) return null;
    const counts: Record<string, number> = {};
    for (const rec of issueCatMap.values()) for (const k in rec) counts[k] = (counts[k] ?? 0) + rec[k];
    return counts;
  }, [issueCatMap]);

  // 집계 기간: 기준일(오늘) ~ +7일
  const winStart = date;
  const winEnd = date ? new Date(new Date(date).getTime() + 7 * 86400000).toISOString().slice(0, 10) : date;
  const rangeText = winStart ? `${winStart.slice(5)} ~ ${winEnd.slice(5)}` : "";

  const cardCls = "bg-white rounded-xl border border-gray-200 shadow-sm p-4 cursor-pointer hover:ring-2 hover:ring-blue-200 transition-all";

  return (
    <>
      {detailType && <SummaryDetailPopup type={detailType} date={date} categoryFilter={issueCatFilter} onClose={() => { setDetailType(null); setIssueCatFilter(null); }} />}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {/* 프로젝트 현황 */}
        <div className={cardCls} onClick={() => setDetailType("projects")}>
          <div className="text-xs text-gray-500 mb-1">프로젝트 현황</div>
          <div className="text-2xl font-bold text-gray-900">{summary.totalProjects}</div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {sc.critical > 0 && <span className="text-xs bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300 px-2 py-0.5 rounded-full">{sc.critical} 위험</span>}
            {sc.warning > 0 && <span className="text-xs bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300 px-2 py-0.5 rounded-full">{sc.warning} 경고</span>}
            <span className="text-xs bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300 px-2 py-0.5 rounded-full">{sc.onTrack} 정상</span>
            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{sc.completed} 완료</span>
            <span className="text-xs bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300 px-2 py-0.5 rounded-full">{sc.onHold} 보류</span>
          </div>
        </div>

        {/* 이슈 현황 — 카테고리별(지연/이슈/정체). 칩 클릭 시 해당 카테고리만 필터 팝업 */}
        <div className={cardCls} onClick={() => { setIssueCatFilter(null); setDetailType("issues"); }}>
          <div className="text-xs text-gray-500 mb-1">이슈 현황</div>
          <div className="text-2xl font-bold text-gray-900">
            {issueCounts ? ISSUE_BUCKETS.reduce((s, b) => s + (issueCounts[b.key] ?? 0), 0) : (ic.critical + ic.warning + ic.info)}
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {ISSUE_BUCKETS.map((b) => {
              const n = issueCounts?.[b.key] ?? 0;
              if (n === 0) return null;
              return (
                <button key={b.key}
                  onClick={(e) => { e.stopPropagation(); setIssueCatFilter(b.key); setDetailType("issues"); }}
                  className={`text-xs px-2 py-0.5 rounded-full font-medium hover:ring-2 hover:ring-blue-200 transition-all ${b.cls}`}>
                  {b.label} {n}
                </button>
              );
            })}
            {issueCounts && ISSUE_BUCKETS.every((b) => (issueCounts[b.key] ?? 0) === 0) && <span className="text-xs text-gray-400">이슈 없음</span>}
          </div>
        </div>

        {/* 이번 주 시작 */}
        <div className={cardCls} onClick={() => setDetailType("starting")}>
          <div className="text-xs text-gray-500 mb-1">앞으로 7일 이내 시작</div>
          <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{we.starting}</div>
          <div className="text-xs text-gray-400 mt-2">{rangeText} · 시작 예정 구간</div>
        </div>

        {/* 이번 주 완료 & 마일스톤 */}
        <div className={cardCls} onClick={() => setDetailType("ending")}>
          <div className="text-xs text-gray-500 mb-1">앞으로 7일 이내 완료 / 마일스톤</div>
          <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">{we.ending} <span className="text-lg font-normal text-gray-400">/ {we.milestones}</span></div>
          <div className="text-xs text-gray-400 mt-2">{rangeText} · 완료 예정 / 마일스톤 도래</div>
        </div>
      </div>
    </>
  );
}

// ─── 메인 페이지 ──────────────────────────────────────────────────────────────

export default function CommandCenterDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  // 프로젝트 소유자 이름 매핑 (프론트 전용, 백엔드 무변경)
  const [ownerByProject, setOwnerByProject] = useState<Map<string, string>>(new Map());
  const [selectedTask, setSelectedTask] = useState<{ task: Task; projectId: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [groupBy] = useState("NONE"); // 그룹화 기능 미구현 → 항상 그룹없음
  const [issueFilter, setIssueFilter] = useState("ALL");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [refreshing, setRefreshing] = useState(false);
  const [presentationMode, setPresentationMode] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 이슈 목록 1회 fetch → 프로젝트별 카테고리 맵 (상단 카드·본문 행 공유)
  const [issuesList, setIssuesList] = useState<any[] | null>(null);
  useEffect(() => {
    let alive = true;
    dashboardApi.getSummaryDetails("issues", date)
      .then((list: any[]) => { if (alive) setIssuesList(list ?? []); })
      .catch(() => { if (alive) setIssuesList([]); });
    return () => { alive = false; };
  }, [date]);
  const issueCatByProject = useMemo(() => {
    const m = new Map<string, Record<string, number>>();
    for (const it of issuesList ?? []) {
      const pid = it?.projectId;
      if (!pid) continue;
      const iss = it?.issue ?? {};
      const b = issueBucket(iss);
      const cur = m.get(pid) ?? {};
      cur[b] = (cur[b] ?? 0) + issueTaskCount(iss);
      m.set(pid, cur);
    }
    return m;
  }, [issuesList]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [result, folderList] = await Promise.all([
        dashboardApi.get({ groupBy, date, issueFilter }),
        folderApi.list().catch(() => [] as Folder[]),
      ]);
      setData(result);
      setFolders(folderList ?? []);
    } catch (e: any) {
      setError(e.message ?? "데이터를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [groupBy, date, issueFilter]);

  useEffect(() => { load(); }, [load]);

  // 프로젝트 소유자 이름 맵 1회 로드 (projectApi.list의 ownerName) — 백엔드 무변경
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const projRes = await projectApi.list().catch(() => ({ items: [] as any[] }));
      if (cancelled) return;
      const om = new Map<string, string>();
      for (const p of (projRes as any).items ?? []) if (p?.id && p.ownerName) om.set(p.id, p.ownerName);
      setOwnerByProject(om);
    })();
    return () => { cancelled = true; };
  }, []);

  const handlePin = useCallback(async (projectId: string) => {
    if (!data) return;
    const config = await dashboardApi.getConfig().catch(() => null);
    const pinned: string[] = config?.pinnedProjectIds ?? [];
    const newPinned = pinned.includes(projectId)
      ? pinned.filter((id: string) => id !== projectId)
      : [...pinned, projectId];
    await dashboardApi.updateConfig({ pinnedProjectIds: newPinned }).catch(() => {});
    await load();
  }, [data, load]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await dashboardApi.refreshAll();
      await load();
    } catch (e: any) {
      setError(e?.message ?? "새로고침 실패");
    }
    finally { setRefreshing(false); }
  };

  const handlePresentationMode = useCallback(() => {
    const next = !presentationMode;
    setPresentationMode(next);

    if (next) {
      containerRef.current?.requestFullscreen?.().catch(() => {});
      scrollTimerRef.current = setInterval(() => {
        window.scrollBy({ top: 2, behavior: "smooth" });
      }, 50);
    } else {
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
      if (scrollTimerRef.current) {
        clearInterval(scrollTimerRef.current);
        scrollTimerRef.current = null;
      }
    }
  }, [presentationMode]);

  useEffect(() => {
    const onFullscreenChange = () => {
      if (!document.fullscreenElement && presentationMode) {
        setPresentationMode(false);
        if (scrollTimerRef.current) {
          clearInterval(scrollTimerRef.current);
          scrollTimerRef.current = null;
        }
      }
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, [presentationMode]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <div className="text-red-500 text-4xl mb-3">⚠</div>
        <p className="text-gray-700 font-medium">데이터 로딩 실패</p>
        <p className="text-sm text-gray-400 mb-4">{error}</p>
        <button onClick={load} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
          다시 시도
        </button>
      </div>
    );
  }

  return (
    <IssueCatContext.Provider value={issueCatByProject}>
    <div ref={containerRef} className={`p-6 space-y-4${presentationMode ? " bg-gray-950 min-h-screen text-white" : ""}`}>
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">전사 대시보드</h1>
          {data && (
            <p className="text-sm text-gray-500 mt-0.5">
              기준일: {data.date} | 캐시: {fmtTime24(data.cachedAt)}
            </p>
          )}
        </div>

        {/* 필터 컨트롤 */}
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <label className="flex items-center gap-1.5 text-sm text-gray-500">
            <span className="shrink-0">기준날짜</span>
            <DateInput
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-800 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
          {/* 그룹화(groupBy) 드롭다운 숨김 — 프로젝트 그룹 관리 화면·데이터 미구현이라 그룹없음 고정 (2026-06-24) */}
          <select
            value={issueFilter}
            onChange={(e) => setIssueFilter(e.target.value)}
            className="text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-800 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {ISSUE_FILTER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="text-sm px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            {refreshing ? "새로고침 중..." : "↻ 새로고침"}
          </button>
          {/* 발표 모드 버튼은 숨김 (기능·핸들러는 유지 — 추후 재사용 대비) */}
        </div>
      </div>

      {/* 로딩 스켈레톤 */}
      {loading && (
        <div className="space-y-3 animate-pulse">
          <div className="grid grid-cols-4 gap-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-24 bg-gray-200 rounded-xl" />
            ))}
          </div>
          <div className="h-48 bg-gray-200 rounded-xl" />
        </div>
      )}

      {/* 데이터 */}
      {!loading && data && (
        <>
          {/* 전체 요약 카드 */}
          <GlobalSummaryCards summary={data.globalSummary} date={date} />

          {/* 그룹 Accordion */}
          {data.groups.length > 0 && (
            <div className="mb-4">
              {data.groups.map((g) => (
                <GroupAccordion key={g.id} group={g} date={date} onPin={handlePin} />
              ))}
            </div>
          )}

          {/* 폴더(부서 자동 구조) 기준 프로젝트 목록 — 각 프로젝트 펼치면 ±7일 태스크 */}
          {data.ungroupedProjects.length > 0 && (
            <FolderProjectsView
              folders={folders}
              projects={data.ungroupedProjects}
              date={date}
              onPin={handlePin}
              onSelectTask={(task, projectId) => setSelectedTask({ task, projectId })}
              ownerByProject={ownerByProject}
            />
          )}

          {/* 빈 상태 */}
          {data.groups.length === 0 && data.ungroupedProjects.length === 0 && (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <div className="text-gray-300 text-5xl mb-3">📋</div>
              <p className="text-gray-500 font-medium">진행 중인 프로젝트가 없습니다.</p>
              <Link href="/projects" className="mt-3 text-sm text-blue-600 dark:text-blue-400 hover:underline">
                프로젝트 관리 →
              </Link>
            </div>
          )}
        </>
      )}

      {/* 태스크 상세 — 대시보드 내에서 드로어로 표시 (페이지 이동 없음) */}
      {selectedTask && (
        <TaskDrawer
          task={selectedTask.task}
          projectId={selectedTask.projectId}
          onClose={() => setSelectedTask(null)}
          onRefresh={() => { void load(); }}
        />
      )}
    </div>
    </IssueCatContext.Provider>
  );
}
