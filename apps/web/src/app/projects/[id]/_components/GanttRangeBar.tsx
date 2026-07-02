"use client";

import type { Dispatch, RefObject, SetStateAction } from "react";
import { DateInput } from "@/components/ui/DateInput";
import { ganttWeekRange, ganttMonthRange } from "../_lib";

interface GanttRangeBarProps {
  rangeBarRef: RefObject<HTMLDivElement>;
  viewStart: string;
  viewEnd: string;
  setViewStart: Dispatch<SetStateAction<string>>;
  setViewEnd: Dispatch<SetStateAction<string>>;
  shiftViewRange: (dir: -1 | 1) => void;
  projectStartDate?: string;
  projectEndDate?: string;
}

export default function GanttRangeBar({
  rangeBarRef,
  viewStart,
  viewEnd,
  setViewStart,
  setViewEnd,
  shiftViewRange,
  projectStartDate,
  projectEndDate,
}: GanttRangeBarProps) {
  return (
    <div ref={rangeBarRef} className="sticky z-[25] bg-gray-50 flex items-center gap-1.5 py-1 mb-1.5 flex-wrap" style={{ top: "var(--top-chrome, 56px)" }}>
      {/* 빠른 선택 버튼 */}
      {[
        { label: "지난주",     range: () => ganttWeekRange(-1) },
        { label: "이번주",     range: () => ganttWeekRange(0) },
        { label: "다음주",     range: () => ganttWeekRange(1) },
        { label: "이번주+다음주", range: () => { const a = ganttWeekRange(0); const b = ganttWeekRange(1); return { start: a.start, end: b.end }; } },
        { label: "이번달",     range: () => ganttMonthRange(0) },
      ].map(({ label, range }) => (
        <button key={label} onClick={() => { const r = range(); setViewStart(r.start); setViewEnd(r.end); }}
          className="text-[11px] px-2 py-0.5 rounded border border-gray-200 text-gray-500 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-600 transition-colors whitespace-nowrap">
          {label}
        </button>
      ))}
      <div className="h-3 w-px bg-gray-200 mx-0.5" />
      <span className="text-[11px] text-gray-400">범위</span>
      <button onClick={() => shiftViewRange(-1)} disabled={!viewStart || !viewEnd}
        title="구간 길이만큼 앞으로 이동"
        className="w-6 h-6 flex items-center justify-center rounded-md border border-blue-300 bg-blue-50 text-blue-600 text-sm font-bold hover:bg-blue-100 hover:border-blue-400 disabled:opacity-40 transition-colors">◀</button>
      <DateInput value={viewStart} onChange={(e) => setViewStart(e.target.value)}
        className="text-[11px] px-1.5 py-0.5 border border-gray-200 rounded w-[120px]" />
      <span className="text-[11px] text-gray-300">~</span>
      <DateInput value={viewEnd} onChange={(e) => setViewEnd(e.target.value)}
        className="text-[11px] px-1.5 py-0.5 border border-gray-200 rounded w-[120px]" />
      <button onClick={() => shiftViewRange(1)} disabled={!viewStart || !viewEnd}
        title="구간 길이만큼 뒤로 이동"
        className="w-6 h-6 flex items-center justify-center rounded-md border border-blue-300 bg-blue-50 text-blue-600 text-sm font-bold hover:bg-blue-100 hover:border-blue-400 disabled:opacity-40 transition-colors">▶</button>
      <button onClick={() => {
        setViewStart(projectStartDate || "");
        setViewEnd(projectEndDate || "");
      }} className="text-[11px] text-gray-400 hover:text-gray-600 px-1.5 py-0.5 rounded hover:bg-gray-100"
        title="프로젝트 전체 기간으로 보기">
        전체기간
      </button>
      <span className="text-[11px] text-gray-300 ml-auto">👆 바 클릭 시 상세 편집</span>
    </div>
  );
}
