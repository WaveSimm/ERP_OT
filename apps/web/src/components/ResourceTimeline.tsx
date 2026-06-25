"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { loadColor, loadLabel } from "@/lib/loadColor";

/**
 * ResourceTimeline — 자원 행 heatmap + task별 gantt bar (Phase 1 + 2)
 *
 * 1자원 = 1행. 가로축 = 일자. 셀 색 = 그 날 부하율.
 * 자원 행 펼침 → 그 자원의 task별 segment gantt bar (같은 색상 기준).
 *
 * Phase 3: 휴일/연차/휴일근무 표시 + 호버 tooltip + 자동 셀 단위
 */

export interface DayCell {
  date: string;
  percent: number;
  isWeekend?: boolean;
  isHoliday?: boolean;
  holidayName?: string;
  leaveType?: string;
  leaveLabel?: string;
  hasHolidayWork?: boolean;
  holidayWorkLabel?: string;
}

export interface AssignmentRow {
  projectId: string;
  projectName: string;
  taskId: string;
  taskName: string;
  segmentId: string;
  segmentName: string;
  startDate: string;
  endDate: string;
  effectivePercent: number; // 색상 단계 결정용
  allocationMode?: string;
  allocationPercent?: number | null;
  allocationHoursPerDay?: number | null;
}

export interface ResourceTimelineRow {
  resourceId: string;
  resourceName: string;
  dailyCapacityHours: number;
  totalAllocationPercent: number;
  isOverloaded: boolean;
  dayBreakdown: DayCell[];
  assignments?: AssignmentRow[];
}

interface Props {
  rows: ResourceTimelineRow[];
  startDate: string;
  endDate: string;
}

const CELL_W = 28;

export function ResourceTimeline({ rows }: Props) {
  const router = useRouter();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (rows.length === 0) {
    return <div className="text-center py-12 text-gray-400 text-sm">자원이 없습니다</div>;
  }

  const days = rows[0]?.dayBreakdown ?? [];

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // segment 기간이 그 날을 포함하는지
  const segmentCoversDate = (segStart: string, segEnd: string, date: string) => {
    return segStart <= date && date <= segEnd;
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="text-left px-3 py-2 sticky left-0 bg-white min-w-[220px] font-medium text-gray-600">
              자원 / 태스크
            </th>
            <th
              className="text-right px-2 py-2 min-w-[60px] font-medium text-gray-600 cursor-help"
              title="투입률 — 자원 행: 기간 중 가장 바쁜 하루의 누적 투입률(최대/peak). 태스크 행: 해당 태스크의 투입률."
            >
              투입률
            </th>
            {days.map((d) => {
              const md = d.date.slice(5).replace("-", "/");
              const dow = new Date(d.date + "T00:00:00.000Z").getUTCDay();
              const dowLabel = ["일", "월", "화", "수", "목", "금", "토"][dow];
              const isWeekend = dow === 0 || dow === 6;
              const isHoliday = d.isHoliday;
              const colorCls = isHoliday
                ? "text-red-500 font-medium"
                : isWeekend
                ? "text-gray-400"
                : "text-gray-500";
              return (
                <th
                  key={d.date}
                  className={`text-center px-1 py-2 font-normal text-[10px] ${colorCls}`}
                  style={{ minWidth: CELL_W }}
                  title={d.holidayName ?? undefined}
                >
                  <div>{md}</div>
                  <div className="text-[9px]">{dowLabel}</div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isOpen = expanded.has(row.resourceId);
            const taskCount = (row.assignments ?? []).length;
            return (
              <Fragment key={row.resourceId}>
                {/* 자원 요약 행 */}
                <tr className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2 sticky left-0 bg-white">
                    <button onClick={() => toggle(row.resourceId)} className="flex items-center gap-2 text-left w-full">
                      <span className="text-gray-400 text-xs w-3 shrink-0">{isOpen ? "▾" : "▸"}</span>
                      <span className="font-medium text-gray-900">{row.resourceName}</span>
                      <span className="text-[10px] text-gray-400">{row.dailyCapacityHours}h/일</span>
                      {taskCount > 0 && <span className="text-[10px] text-gray-400">· {taskCount}건</span>}
                    </button>
                  </td>
                  <td
                    className={`text-right px-2 py-2 font-medium cursor-help ${row.isOverloaded ? "text-red-600" : row.totalAllocationPercent === 0 ? "text-gray-400" : "text-blue-600"}`}
                    title={`최대 투입률 ${row.totalAllocationPercent}% — 기간 중 가장 바쁜 하루의 누적 투입(겹치는 배정 합산의 최댓값). 100% 초과 시 과부하.`}
                  >
                    {row.totalAllocationPercent}%
                  </td>
                  {row.dayBreakdown.map((cell) => {
                    const opts = {
                      isWeekend: cell.isWeekend,
                      isHoliday: cell.isHoliday,
                      hasHolidayWork: cell.hasHolidayWork,
                      leaveType: cell.leaveType,
                    };
                    const cls = loadColor(cell.percent, opts);
                    const label = loadLabel(cell.percent, opts);
                    const tipParts = [`${cell.date} — ${cell.percent}% (${label})`];
                    if (cell.holidayName) tipParts.push(`공휴일: ${cell.holidayName}`);
                    if (cell.leaveLabel) tipParts.push(`휴가: ${cell.leaveLabel}`);
                    if (cell.holidayWorkLabel) tipParts.push(`휴일근무: ${cell.holidayWorkLabel}`);
                    return (
                      <td key={cell.date} className="p-0.5" title={tipParts.join(" / ")}>
                        <div className={`h-6 rounded-sm ${cls}`} />
                      </td>
                    );
                  })}
                </tr>

                {/* 펼침 — task별 gantt bar */}
                {isOpen && taskCount === 0 && (
                  <tr className="border-b border-gray-100 bg-gray-50/40">
                    <td colSpan={days.length + 2} className="px-3 py-3 text-center text-xs text-gray-400">
                      배정된 작업이 없습니다
                    </td>
                  </tr>
                )}
                {isOpen && (row.assignments ?? []).slice().sort((a, b) =>
                  a.projectName.localeCompare(b.projectName) || a.taskName.localeCompare(b.taskName) || a.startDate.localeCompare(b.startDate)
                ).map((a, idx) => (
                  <tr key={`${row.resourceId}-${a.segmentId}-${idx}`} className="border-b border-gray-50 bg-gray-50/30">
                    <td className="px-3 py-1.5 sticky left-0 bg-gray-50/30">
                      <button
                        onClick={() => {
                          try { sessionStorage.setItem(`erp_tab_${a.projectId}`, "tasks"); } catch {}
                          router.push(`/projects/${a.projectId}?taskId=${a.taskId}`);
                        }}
                        className="flex items-center gap-2 pl-5 text-left hover:underline"
                        title="클릭하여 해당 태스크로 이동"
                      >
                        <span className="text-[11px] text-blue-600 truncate max-w-[100px]">{a.projectName}</span>
                        <span className="text-gray-300">·</span>
                        <span className="text-[11px] text-gray-700 truncate max-w-[120px]">{a.taskName}</span>
                      </button>
                    </td>
                    <td className="text-right px-2 py-1.5 text-[11px] text-gray-600">
                      {a.effectivePercent}%
                    </td>
                    {row.dayBreakdown.map((cell) => {
                      const inSegment = segmentCoversDate(a.startDate, a.endDate, cell.date);
                      if (!inSegment) {
                        return <td key={cell.date} className="p-0.5"><div className="h-4" /></td>;
                      }
                      // 같은 색상 기준 — segment의 effectivePercent 사용
                      // 휴일/주말은 회색 우선 (loadColor 내부에서 isHoliday/isWeekend 우선 처리)
                      const cls = loadColor(a.effectivePercent, {
                        isWeekend: cell.isWeekend,
                        isHoliday: cell.isHoliday,
                      });
                      const tip = cell.holidayName
                        ? `${cell.date} — ${a.taskName} ${a.effectivePercent}% (공휴일: ${cell.holidayName})`
                        : `${cell.date} — ${a.taskName} ${a.effectivePercent}%`;
                      return (
                        <td key={cell.date} className="p-0.5" title={tip}>
                          <div className={`h-4 rounded-sm ${cls}`} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// 부하 색상 범례 (직원현황 탭 상단에 sticky로 1회 표시 — 부서별 중복 제거)
export function ResourceLoadLegend() {
  return (
    <div className="flex items-center gap-3 text-[11px] text-gray-500 flex-wrap">
      <span className="font-medium">부하 범례:</span>
      <span className="flex items-center gap-1"><span className="inline-block w-4 h-4 bg-gray-50 border border-gray-200 rounded-sm" /> 여유 0%</span>
      <span className="flex items-center gap-1"><span className="inline-block w-4 h-4 bg-blue-200 rounded-sm" /> 1~50%</span>
      <span className="flex items-center gap-1"><span className="inline-block w-4 h-4 bg-blue-500 rounded-sm" /> 51~100%</span>
      <span className="flex items-center gap-1"><span className="inline-block w-4 h-4 bg-orange-400 rounded-sm" /> 주의 101~150%</span>
      <span className="flex items-center gap-1"><span className="inline-block w-4 h-4 bg-red-500 rounded-sm" /> 과부하 &gt;150%</span>
      <span className="flex items-center gap-1"><span className="inline-block w-4 h-4 bg-gray-100 rounded-sm" /> 주말</span>
      <span className="flex items-center gap-1"><span className="inline-block w-4 h-4 bg-gray-300 rounded-sm" /> 공휴일</span>
      <span className="flex items-center gap-1"><span className="inline-block w-4 h-4 bg-pink-200 rounded-sm" /> 휴가</span>
      <span className="flex items-center gap-1"><span className="inline-block w-4 h-4 bg-purple-400 rounded-sm" /> 휴일근무</span>
    </div>
  );
}
