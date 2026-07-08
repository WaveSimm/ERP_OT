"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { dashboardApi } from "@/lib/api";
import { DateInput } from "@/components/ui/DateInput";


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
  GREEN: "text-green-700",
  AMBER: "text-yellow-700",
  RED: "text-red-700",
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


// ─── SVG 미니 타임라인 ────────────────────────────────────────────────────────

function MiniTimeline({ events, centerDate }: { events: TimelineEvent[]; centerDate: string }) {
  const DAYS = 15; // -7 ~ +7
  const W = 240;
  const H = 40;
  const DAY_W = W / DAYS;
  const center = new Date(centerDate);

  function dayOffset(dateStr: string) {
    const d = new Date(dateStr);
    return Math.floor((d.getTime() - center.getTime()) / (1000 * 60 * 60 * 24));
  }

  function xPos(offset: number) {
    return ((offset + 7) / DAYS) * W;
  }

  const milestones = events.filter((e) => e.type === "MILESTONE");
  const segments = events.filter((e) => e.type !== "MILESTONE");

  // 세그먼트를 startDate ~ endDate 바로 렌더 (근사치)
  const segBars = segments.map((e, i) => {
    const x = xPos(dayOffset(e.date));
    const color = e.isDelayed ? "#EF4444" : e.isCriticalPath ? "#F97316" : "#22C55E";
    return (
      <rect
        key={i}
        x={Math.max(0, x - 1)}
        y={12 + (i % 3) * 8}
        width={DAY_W * 1.5}
        height={6}
        rx="2"
        fill={color}
        opacity={0.85}
      >
        <title>{e.taskName}{e.segmentName ? ` / ${e.segmentName}` : ""} {e.progressPercent != null ? `(${e.progressPercent}%)` : ""}</title>
      </rect>
    );
  });

  const milestoneDots = milestones.map((e, i) => {
    const x = xPos(dayOffset(e.date));
    const color = e.isDelayed ? "#EF4444" : "#8B5CF6";
    return (
      <g key={`m${i}`} transform={`translate(${x}, 20)`}>
        <polygon points="0,-6 5,0 0,6 -5,0" fill={color} />
        <title>{e.taskName} (마일스톤){e.isDelayed ? ` — ${e.delayDays}일 지연` : ""}</title>
      </g>
    );
  });

  return (
    <svg width={W} height={H} className="overflow-visible">
      {/* 배경 그리드 */}
      {Array.from({ length: DAYS + 1 }, (_, i) => (
        <line key={i} x1={i * DAY_W} y1={0} x2={i * DAY_W} y2={H} stroke="#e5e7eb" strokeWidth={0.5} />
      ))}
      {/* 오늘 강조선 */}
      <line x1={xPos(0)} y1={0} x2={xPos(0)} y2={H} stroke="#F97316" strokeWidth={1.5} strokeDasharray="3,2" />
      {/* 세그먼트 바 */}
      {segBars}
      {/* 마일스톤 */}
      {milestoneDots}
    </svg>
  );
}

// ─── 이슈 팝업 ────────────────────────────────────────────────────────────────

function IssuePopup({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [issues, setIssues] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    dashboardApi.getProjectIssues(projectId)
      .then(setIssues)
      .catch(() => setIssues([]))
      .finally(() => setLoading(false));
  }, [projectId]);

  const SEV_COLOR: Record<string, string> = {
    CRITICAL: "bg-red-100 text-red-800 border-red-200",
    WARNING: "bg-yellow-100 text-yellow-800 border-yellow-200",
    INFO: "bg-blue-100 text-blue-800 border-blue-200",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[70vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="font-semibold text-gray-900">이슈 상세</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>
        <div className="overflow-y-auto flex-1 p-4 space-y-2">
          {loading && <p className="text-sm text-gray-400 text-center py-6">로딩 중...</p>}
          {!loading && issues.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-6">이슈가 없습니다.</p>
          )}
          {issues.map((iss) => (
            <div key={iss.id} className={`border rounded-lg px-4 py-2.5 text-sm ${SEV_COLOR[iss.severity]}`}>
              <div className="font-medium">{iss.title}</div>
              <div className="opacity-80 text-xs mt-0.5">{iss.description}</div>
              <div className="mt-2 flex gap-2">
                <Link
                  href={`/projects/${projectId}`}
                  className="text-xs font-medium underline underline-offset-2 opacity-80 hover:opacity-100"
                  onClick={onClose}
                >
                  프로젝트로 이동 →
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── 프로젝트 행 ──────────────────────────────────────────────────────────────

function ProjectRow({ row, date, onPin }: { row: ProjectRow; date: string; onPin: (id: string) => void }) {
  const [showIssues, setShowIssues] = useState(false);
  const totalIssues = row.issueCount.critical + row.issueCount.warning + row.issueCount.info;

  return (
    <>
      {showIssues && <IssuePopup projectId={row.id} onClose={() => setShowIssues(false)} />}
      <tr className="border-b hover:bg-gray-50 transition-colors">
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


        {/* 이슈 */}
        <td className="px-3 py-2.5 w-24">
          {totalIssues > 0 ? (
            <button
              onClick={() => setShowIssues(true)}
              className="flex items-center gap-1 text-xs"
            >
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
        <div className="mt-1 rounded-lg border overflow-hidden">
          <table className="w-full table-fixed">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 border-b">
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
  GREEN: { text: "정상", cls: "bg-green-100 text-green-700" },
  AMBER: { text: "경고", cls: "bg-yellow-100 text-yellow-700" },
  RED: { text: "위험", cls: "bg-red-100 text-red-700" },
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
  CRITICAL: "border-red-200 bg-red-50 text-red-800",
  WARNING: "border-yellow-200 bg-yellow-50 text-yellow-800",
  INFO: "border-blue-200 bg-blue-50 text-blue-800",
};

function SummaryDetailPopup({ type, date, onClose }: { type: string; date: string; onClose: () => void }) {
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
          <h3 className="font-semibold text-gray-900">{TITLE[type] ?? type}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">&times;</button>
        </div>
        <div className="overflow-y-auto flex-1 p-4">
          {loading && <p className="text-sm text-gray-400 text-center py-8">로딩 중...</p>}
          {!loading && !data && <p className="text-sm text-gray-400 text-center py-8">데이터 없음</p>}

          {/* 전체 프로젝트 */}
          {!loading && type === "projects" && Array.isArray(data) && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-gray-500">
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
                    <tr key={p.id} className="border-b hover:bg-gray-50">
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
              {data.length === 0 && <p className="text-sm text-gray-400 text-center py-6">이슈 없음</p>}
              {(() => {
                const SEV_ORDER: Record<string, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };
                const grouped = new Map<string, { projectId: string; projectName: string; items: any[] }>();
                for (const item of data) {
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
                          <div key={idx} className={`border rounded-lg px-4 py-2.5 text-sm ${SEV_STYLE[item.issue.severity] ?? ""}`}>
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
                <tr className="border-b text-xs text-gray-500">
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
                  <tr key={s.segmentId} className="border-b hover:bg-gray-50">
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
                    <tr className="border-b text-xs text-gray-500">
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
                      <tr key={s.segmentId} className="border-b hover:bg-gray-50">
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
                      <tr className="border-b text-xs text-gray-500">
                        <th className="py-1.5 text-left px-2">기한</th>
                        <th className="py-1.5 text-left px-2">프로젝트</th>
                        <th className="py-1.5 text-left px-2">마일스톤</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.milestones.map((m: any) => (
                        <tr key={m.taskId} className="border-b hover:bg-gray-50">
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

// ─── 전체 요약 카드 ───────────────────────────────────────────────────────────

function GlobalSummaryCards({ summary, date }: { summary: GlobalSummary; date: string }) {
  const sc = summary.statusCount;
  const ic = summary.issueCount;
  const we = summary.thisWeekEvents;
  const [detailType, setDetailType] = useState<string | null>(null);

  // 집계 기간: 기준일(오늘) ~ +7일
  const winStart = date;
  const winEnd = date ? new Date(new Date(date).getTime() + 7 * 86400000).toISOString().slice(0, 10) : date;
  const rangeText = winStart ? `${winStart.slice(5)} ~ ${winEnd.slice(5)}` : "";

  const cardCls = "bg-white rounded-xl border shadow-sm p-4 cursor-pointer hover:ring-2 hover:ring-blue-200 transition-all";

  return (
    <>
      {detailType && <SummaryDetailPopup type={detailType} date={date} onClose={() => setDetailType(null)} />}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {/* 프로젝트 현황 */}
        <div className={cardCls} onClick={() => setDetailType("projects")}>
          <div className="text-xs text-gray-500 mb-1">프로젝트 현황</div>
          <div className="text-2xl font-bold text-gray-900">{summary.totalProjects}</div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {sc.critical > 0 && <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">{sc.critical} 위험</span>}
            {sc.warning > 0 && <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">{sc.warning} 경고</span>}
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">{sc.onTrack} 정상</span>
            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{sc.completed} 완료</span>
            <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{sc.onHold} 보류</span>
          </div>
        </div>

        {/* 이슈 현황 */}
        <div className={cardCls} onClick={() => setDetailType("issues")}>
          <div className="text-xs text-gray-500 mb-1">이슈 현황</div>
          <div className="text-2xl font-bold text-gray-900">{ic.critical + ic.warning + ic.info}</div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {ic.critical > 0 && <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">{ic.critical} 위험</span>}
            {ic.warning > 0 && <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">{ic.warning} 경고</span>}
            {ic.info > 0 && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{ic.info} 정보</span>}
            {ic.critical + ic.warning + ic.info === 0 && <span className="text-xs text-gray-400">이슈 없음</span>}
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [groupBy] = useState("NONE"); // 그룹화 기능 미구현 → 항상 그룹없음
  const [issueFilter, setIssueFilter] = useState("ALL");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [refreshing, setRefreshing] = useState(false);
  const [presentationMode, setPresentationMode] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await dashboardApi.get({ groupBy, date, issueFilter });
      setData(result);
    } catch (e: any) {
      setError(e.message ?? "데이터를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [groupBy, date, issueFilter]);

  useEffect(() => { load(); }, [load]);

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
    <div ref={containerRef} className={`p-6 space-y-4${presentationMode ? " bg-gray-950 min-h-screen text-white" : ""}`}>
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">전사 대시보드</h1>
          {data && (
            <p className="text-sm text-gray-500 mt-0.5">
              기준일: {data.date} | 캐시: {data.cachedAt.slice(11, 16)}
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
              className="text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
          {/* 그룹화(groupBy) 드롭다운 숨김 — 프로젝트 그룹 관리 화면·데이터 미구현이라 그룹없음 고정 (2026-06-24) */}
          <select
            value={issueFilter}
            onChange={(e) => setIssueFilter(e.target.value)}
            className="text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {ISSUE_FILTER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="text-sm px-3 py-1.5 border rounded-lg hover:bg-gray-100 disabled:opacity-50 transition-colors"
          >
            {refreshing ? "새로고침 중..." : "↻ 새로고침"}
          </button>
          <button
            onClick={handlePresentationMode}
            className={`text-sm px-3 py-1.5 border rounded-lg transition-colors ${presentationMode ? "bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700" : "hover:bg-gray-100"}`}
            title={presentationMode ? "발표 모드 종료 (ESC)" : "발표 모드 시작"}
          >
            {presentationMode ? "⏹ 발표 종료" : "▶ 발표 모드"}
          </button>
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

          {/* 그룹 미소속 프로젝트 */}
          {data.ungroupedProjects.length > 0 && (
            <div>
              {data.groups.length > 0 && (
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 px-1">
                  그룹 미소속 프로젝트
                </div>
              )}
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full table-fixed">
                  <thead>
                    <tr className="bg-gray-50 text-xs text-gray-500 border-b">
                      <th className="px-3 py-1.5 text-left w-10"></th>
                      <th className="px-3 py-1.5 text-left">프로젝트</th>
                      <th className="px-3 py-1.5 text-left w-28">진행률</th>
                      <th className="px-3 py-1.5 text-left w-24">이슈</th>
                      <th className="px-3 py-1.5 text-left w-[270px]">타임라인 (±7일)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.ungroupedProjects.map((p) => (
                      <ProjectRow key={p.id} row={p} date={date} onPin={handlePin} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
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
    </div>
  );
}
