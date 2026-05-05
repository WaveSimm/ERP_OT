"use client";

import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { DateInput } from "@/components/ui/DateInput";

interface Schedule {
  id: string;
  type: string;
  title: string;
  startDate: string;
  endDate: string;
  projectId?: string;
  description?: string;
}

interface Props {
  schedules: Schedule[];
  /** 회사달력 v1.2 — 일자별 휴일 Map (date → 휴일명). 미전달 시 휴일 표시 안 함 */
  holidays?: Map<string, string>;
}

type RangePreset = "lastWeek" | "thisWeek" | "nextWeek" | "thisMonth" | "nextMonth" | "all";

const PRESET_LABELS: Record<RangePreset, string> = {
  lastWeek: "지난주",
  thisWeek: "이번주",
  nextWeek: "다음주",
  thisMonth: "이번달",
  nextMonth: "다음달",
  all: "전체",
};

function getPresetRange(preset: RangePreset): { start: Date; end: Date } | null {
  if (preset === "all") return null;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const dow = now.getDay();
  const mondayOffset = dow === 0 ? -6 : 1 - dow;

  if (preset === "lastWeek") {
    const start = new Date(now); start.setDate(start.getDate() + mondayOffset - 7);
    const end = new Date(start); end.setDate(end.getDate() + 13);
    return { start, end };
  }
  if (preset === "thisWeek") {
    const start = new Date(now); start.setDate(start.getDate() + mondayOffset);
    const end = new Date(start); end.setDate(end.getDate() + 13);
    return { start, end };
  }
  if (preset === "nextWeek") {
    const start = new Date(now); start.setDate(start.getDate() + mondayOffset + 7);
    const end = new Date(start); end.setDate(end.getDate() + 13);
    return { start, end };
  }
  if (preset === "thisMonth") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { start, end };
  }
  const start = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 2, 0);
  return { start, end };
}

function fmt(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const TYPE_COLORS: Record<string, { bar: string; barDark: string; text: string }> = {
  PROJECT:     { bar: "#3b82f6", barDark: "#2563eb", text: "#fff" },
  MAINTENANCE: { bar: "#eab308", barDark: "#ca8a04", text: "#422006" },
  CALIBRATION: { bar: "#a855f7", barDark: "#9333ea", text: "#fff" },
  TRAINING:    { bar: "#22c55e", barDark: "#16a34a", text: "#fff" },
  STANDBY:     { bar: "#9ca3af", barDark: "#6b7280", text: "#fff" },
};

const TYPE_LABELS: Record<string, string> = {
  PROJECT: "투입", MAINTENANCE: "정비", CALIBRATION: "교정", TRAINING: "교육", STANDBY: "대기",
};

const ROW_H = 40;
const BAR_H = 22;
const BAR_TOP = Math.round((ROW_H - BAR_H) / 2);

function parseDate(s: string) {
  const d = new Date(s);
  d.setHours(0, 0, 0, 0);
  return d;
}
function daysBetween(a: Date, b: Date) { return Math.round((b.getTime() - a.getTime()) / 86_400_000); }

/** 퍼센트 기반 위치 계산 — 브라우저 폭에 자동 맞춤 */
function pct(day: number, total: number) { return `${(day / total) * 100}%`; }
function pctN(day: number, total: number) { return (day / total) * 100; }

export default function ScheduleTimeline({ schedules, holidays }: Props) {
  const [tooltip, setTooltip] = useState<{ pctX: number; s: Schedule } | null>(null);
  const [activePreset, setActivePreset] = useState<RangePreset>("thisMonth");
  const [customStart, setCustomStart] = useState(() => fmt(getPresetRange("thisMonth")!.start));
  const [customEnd, setCustomEnd] = useState(() => fmt(getPresetRange("thisMonth")!.end));

  const handlePreset = useCallback((preset: RangePreset) => {
    setActivePreset(preset);
    if (preset === "all") {
      setCustomStart("");
      setCustomEnd("");
    } else {
      const range = getPresetRange(preset)!;
      setCustomStart(fmt(range.start));
      setCustomEnd(fmt(range.end));
    }
  }, []);

  const handleCustomDate = useCallback((type: "start" | "end", value: string) => {
    setActivePreset("all");
    if (type === "start") setCustomStart(value);
    else setCustomEnd(value);
  }, []);

  const sorted = useMemo(() =>
    [...schedules].sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime()),
    [schedules]
  );

  /* ── 타임라인 범위 ── */
  const { rangeStart, totalDays } = useMemo(() => {
    if (customStart && customEnd) {
      const cs = parseDate(customStart);
      const ce = parseDate(customEnd);
      if (!isNaN(cs.getTime()) && !isNaN(ce.getTime()) && ce >= cs) {
        return { rangeStart: cs, totalDays: daysBetween(cs, ce) + 1 };
      }
    }
    if (sorted.length === 0) {
      const now = new Date(); now.setHours(0, 0, 0, 0);
      return { rangeStart: new Date(now.getFullYear(), now.getMonth(), 1), totalDays: 90 };
    }
    const dates = sorted.flatMap((s) => [parseDate(s.startDate), parseDate(s.endDate)]);
    const min = new Date(Math.min(...dates.map((d) => d.getTime())));
    const max = new Date(Math.max(...dates.map((d) => d.getTime())));
    min.setDate(min.getDate() - 7);
    max.setDate(max.getDate() + 14);
    return { rangeStart: min, totalDays: Math.max(daysBetween(min, max) + 1, 30) };
  }, [sorted, customStart, customEnd]);


  /* ── Month headers ── */
  const months = useMemo(() => {
    const result: { label: string; leftPct: number; widthPct: number }[] = [];
    const cursor = new Date(rangeStart); cursor.setDate(1);
    const rangeEnd = new Date(rangeStart); rangeEnd.setDate(rangeEnd.getDate() + totalDays);
    while (cursor <= rangeEnd) {
      const monthStart = new Date(cursor);
      const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
      const startDay = Math.max(0, daysBetween(rangeStart, monthStart));
      const endDay = Math.min(totalDays, daysBetween(rangeStart, monthEnd) + 1);
      result.push({
        label: `${cursor.getFullYear()}년 ${cursor.getMonth() + 1}월`,
        leftPct: pctN(startDay, totalDays),
        widthPct: pctN(endDay - startDay, totalDays),
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return result;
  }, [rangeStart, totalDays]);

  /* ── Day headers — 항상 표시 ── */
  const dayHeaders = useMemo(() => {
    const result: {
      label: string;
      iso: string;
      leftPct: number;
      widthPct: number;
      isWeekend: boolean;
      isHoliday: boolean;
      holidayName?: string;
    }[] = [];
    const w = pctN(1, totalDays);
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(rangeStart); d.setDate(d.getDate() + i);
      const dow = d.getDay();
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const holidayName = holidays?.get(iso);
      result.push({
        label: `${d.getDate()}`,
        iso,
        leftPct: pctN(i, totalDays),
        widthPct: w,
        isWeekend: dow === 0 || dow === 6,
        isHoliday: !!holidayName,
        ...(holidayName ? { holidayName } : {}),
      });
    }
    return result;
  }, [rangeStart, totalDays, holidays]);

  const todayPct = pctN(daysBetween(rangeStart, new Date()), totalDays);

  if (sorted.length === 0) return null;

  const headerH = 44;

  return (
    <div className="bg-white border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-gray-50">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-gray-700">운영 타임라인</span>
          <div className="flex gap-2.5">
            {Object.entries(TYPE_LABELS).map(([key, label]) => {
              if (!sorted.some((s) => s.type === key)) return null;
              const tc = TYPE_COLORS[key] ?? TYPE_COLORS.STANDBY;
              return (
                <span key={key} className="flex items-center gap-1 text-[10px] text-gray-500">
                  <span className="w-3 h-2.5 rounded-sm inline-block" style={{ backgroundColor: tc.bar }} />
                  {label}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {/* Date range filter */}
      <div className="flex items-center gap-2 px-4 py-1.5 border-b bg-white flex-wrap">
        {(Object.entries(PRESET_LABELS) as [RangePreset, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => handlePreset(key)}
            className={`px-2.5 py-1 text-xs rounded transition-colors ${
              activePreset === key
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {label}
          </button>
        ))}
        <span className="text-gray-300 mx-1">|</span>
        <DateInput
          
          value={customStart}
          onChange={(e) => handleCustomDate("start", e.target.value)}
          className="px-2 py-1 text-xs border rounded bg-white text-gray-700 w-[130px]"
        />
        <span className="text-gray-400 text-xs">~</span>
        <DateInput
          
          value={customEnd}
          onChange={(e) => handleCustomDate("end", e.target.value)}
          className="px-2 py-1 text-xs border rounded bg-white text-gray-700 w-[130px]"
        />
      </div>

      {/* Timeline: 100% 너비, 퍼센트 기반 — 브라우저 크기에 자동 맞춤 */}
      <div className="relative" onMouseLeave={() => setTooltip(null)}>
        {/* Month headers */}
        <div className="relative h-6 bg-gray-50 border-b border-gray-200">
          {months.map((m, i) => (
            <div key={i} className="absolute top-0 h-full text-[11px] text-gray-600 font-medium border-r border-gray-200 flex items-center px-2 select-none truncate"
              style={{ left: `${m.leftPct}%`, width: `${m.widthPct}%` }}>
              {m.label}
            </div>
          ))}
        </div>

        {/* Day headers */}
        <div className="relative h-[20px] bg-gray-50/80 border-b border-gray-200">
          {dayHeaders.map((d, i) => {
            const cls = d.isHoliday
              ? "text-red-500 bg-red-100/60 border-red-200 font-medium"
              : d.isWeekend
              ? "text-red-400 bg-red-50/40 border-red-100"
              : "text-gray-400 border-gray-100";
            return (
              <div key={i}
                className={`absolute text-[9px] text-center border-r select-none flex items-center justify-center ${cls}`}
                style={{ left: `${d.leftPct}%`, width: `${d.widthPct}%`, height: 20 }}
                title={d.holidayName ?? undefined}
              >
                {d.label}
              </div>
            );
          })}
        </div>

        {/* Single bar row */}
        <div className="relative" style={{ height: ROW_H }}>
          {/* Month grid lines */}
          {months.map((m, i) => (
            <div key={i} className="absolute top-0 border-l border-gray-200 pointer-events-none" style={{ left: `${m.leftPct}%`, height: ROW_H }} />
          ))}

          {/* Weekend columns */}
          {dayHeaders.filter((d) => d.isWeekend && !d.isHoliday).map((d, i) => (
            <div key={`we-${i}`} className="absolute top-0 bg-gray-50/50 pointer-events-none" style={{ left: `${d.leftPct}%`, width: `${d.widthPct}%`, height: ROW_H }} />
          ))}

          {/* Holiday columns — 휴일은 weekend보다 진한 음영 (회사달력 v1.2) */}
          {dayHeaders.filter((d) => d.isHoliday).map((d, i) => (
            <div key={`hol-${i}`} className="absolute top-0 bg-red-50/40 pointer-events-none" style={{ left: `${d.leftPct}%`, width: `${d.widthPct}%`, height: ROW_H }} title={d.holidayName ?? undefined} />
          ))}

          {/* Today line */}
          {todayPct >= 0 && todayPct <= 100 && (
            <div className="absolute top-0 z-10 pointer-events-none" style={{ left: `${todayPct}%`, height: ROW_H }}>
              <div className="w-[2px] h-full bg-red-400 opacity-60" />
            </div>
          )}

          {/* Bars */}
          {sorted.map((s) => {
            const startOff = daysBetween(rangeStart, parseDate(s.startDate));
            const dur = Math.max(1, daysBetween(parseDate(s.startDate), parseDate(s.endDate)) + 1);
            const leftP = pctN(startOff, totalDays);
            const widthP = Math.max(pctN(1, totalDays), pctN(dur, totalDays));
            const tc = TYPE_COLORS[s.type] ?? TYPE_COLORS.STANDBY;
            const label = TYPE_LABELS[s.type] ?? s.type;

            return (
              <div
                key={s.id}
                className="absolute rounded-sm shadow-sm flex items-center overflow-hidden cursor-default hover:brightness-110 transition-all"
                style={{
                  left: `${leftP}%`,
                  width: `${widthP}%`,
                  top: BAR_TOP,
                  height: BAR_H,
                  background: `linear-gradient(180deg, ${tc.bar} 0%, ${tc.barDark} 100%)`,
                  zIndex: 5,
                }}
                onMouseEnter={() => setTooltip({ pctX: leftP + widthP / 2, s })}
                onMouseLeave={() => setTooltip(null)}
              >
                <span className="text-[9px] font-bold px-1 truncate select-none whitespace-nowrap" style={{ color: tc.text }}>
                  {label}
                </span>
                <span className="text-[9px] truncate select-none whitespace-nowrap opacity-80" style={{ color: tc.text }}>
                  {s.title}
                </span>
              </div>
            );
          })}
        </div>

        {/* Tooltip */}
        {tooltip && (
          <div
            className="absolute z-30 bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-lg pointer-events-none whitespace-nowrap"
            style={{ left: `${Math.max(1, Math.min(tooltip.pctX, 85))}%`, top: headerH + ROW_H + 4 }}
          >
            <div className="font-semibold">{tooltip.s.title}</div>
            <div className="text-gray-300 mt-0.5">
              {TYPE_LABELS[tooltip.s.type] ?? tooltip.s.type} &middot; {parseDate(tooltip.s.startDate).toLocaleDateString()} ~ {parseDate(tooltip.s.endDate).toLocaleDateString()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
