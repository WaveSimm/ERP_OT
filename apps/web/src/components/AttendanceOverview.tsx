"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { attendanceOverviewApi } from "@/lib/api";

// ─── Constants ───────────────────────────────────────────────────────────────

const ENTRY_LABELS: Record<string, string> = {
  WORK: "출근", FIELD: "외근", TRAINING: "교육",
  BUSINESS_TRIP: "출장", HALF_AM: "오전반차", HALF_PM: "오후반차",
  QUARTER: "1/4차", FAMILY: "가정의날",
  ANNUAL: "연차", SICK: "병가", SPECIAL: "특별휴가", OT: "OT",
};

const ENTRY_COLORS: Record<string, string> = {
  WORK: "bg-blue-100 text-blue-800",
  FIELD: "bg-green-100 text-green-800",
  TRAINING: "bg-purple-100 text-purple-800",
  BUSINESS_TRIP: "bg-orange-100 text-orange-800",
  HALF_AM: "bg-yellow-100 text-yellow-800",
  HALF_PM: "bg-yellow-100 text-yellow-800",
  QUARTER: "bg-amber-100 text-amber-800",
  FAMILY: "bg-emerald-100 text-emerald-800",
  ANNUAL: "bg-red-100 text-red-800",
  SICK: "bg-pink-100 text-pink-800",
  SPECIAL: "bg-indigo-100 text-indigo-800",
  OT: "bg-gray-200 text-gray-800",
};

const DAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"];

type ViewMode = "day" | "week" | "month";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(d: Date) { return d.toISOString().slice(0, 10); }
function fmtShort(dateStr: string) {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}.${d.getDate()}`;
}
function fmtMonth(dateStr: string) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
}

function isToday(dateStr: string) { return dateStr === fmt(new Date()); }
function isWeekend(dateStr: string) {
  const d = new Date(dateStr).getDay();
  return d === 0 || d === 6;
}

function getDayLabel(dateStr: string) {
  return DAY_LABELS[(new Date(dateStr).getDay() + 6) % 7]; // 월=0 ... 일=6
}

/** 주 단위: offset 기반 월~일 */
function getWeekRange(offset: number): { start: string; end: string; weekNum: number } {
  const today = new Date();
  const dow = today.getDay();
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(today);
  mon.setDate(today.getDate() + diffToMon + offset * 7);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);

  const tmp = new Date(mon);
  tmp.setDate(tmp.getDate() + 3 - ((tmp.getDay() + 6) % 7));
  const firstThurs = new Date(tmp.getFullYear(), 0, 4);
  firstThurs.setDate(firstThurs.getDate() + 3 - ((firstThurs.getDay() + 6) % 7));
  const weekNum = 1 + Math.round((tmp.getTime() - firstThurs.getTime()) / (7 * 86400000));

  return { start: fmt(mon), end: fmt(sun), weekNum };
}

/** 일 단위: offset 기반 */
function getDayRange(offset: number): { start: string; end: string } {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const s = fmt(d);
  return { start: s, end: s };
}

/** 월 단위: offset 기반 1일~말일 */
function getMonthRange(offset: number): { start: string; end: string; label: string } {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  const start = fmt(d);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { start, end: fmt(last), label: `${d.getFullYear()}년 ${d.getMonth() + 1}월` };
}

function getDays(start: string, end: string): string[] {
  const days: string[] = [];
  const d = new Date(start);
  const endD = new Date(end);
  while (d <= endD) {
    days.push(fmt(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface Entry {
  id: string;
  date: string;
  entryType: string;
  startTime: string | null;
  endTime: string | null;
  label: string | null;
  groupId: string | null;
  sourceType: string;
}

interface Member {
  userId: string;
  name: string;
  entries: Entry[];
}

interface Department {
  id: string;
  name: string;
  sortOrder: number;
  members: Member[];
}

interface WeeklyData {
  weekStart: string;
  weekEnd: string;
  departments: Department[];
  unassigned: Member[];
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function AttendanceOverview() {
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<WeeklyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [initialized, setInitialized] = useState(false);

  const range = useMemo(() => {
    if (viewMode === "day") return getDayRange(offset);
    if (viewMode === "month") return getMonthRange(offset);
    return getWeekRange(offset);
  }, [viewMode, offset]);

  const weekNum = viewMode === "week" ? (range as any).weekNum : undefined;
  const days = useMemo(() => getDays(range.start, range.end), [range.start, range.end]);

  const headerLabel = useMemo(() => {
    if (viewMode === "day") {
      return `${fmtShort(range.start)} (${getDayLabel(range.start)})`;
    }
    if (viewMode === "month") {
      return (range as any).label;
    }
    return `${fmtShort(range.start)} ~ ${fmtShort(range.end)} (${weekNum}주차)`;
  }, [viewMode, range, weekNum]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await attendanceOverviewApi.getWeekly(range.start, range.end);
      setData(res);
      if (!initialized && res.departments) {
        const exp: Record<string, boolean> = {};
        for (const d of res.departments) exp[d.id] = true;
        if (res.unassigned?.length > 0) exp["__unassigned"] = true;
        setExpanded(exp);
        setInitialized(true);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [range.start, range.end, initialized]);

  useEffect(() => { load(); }, [load]);

  const toggle = (id: string) => setExpanded((p) => ({ ...p, [id]: !p[id] }));

  const allIds = useMemo(() => {
    if (!data) return [];
    const ids = data.departments.map((d) => d.id);
    if (data.unassigned.length > 0) ids.push("__unassigned");
    return ids;
  }, [data]);

  const allExpanded = allIds.length > 0 && allIds.every((id) => expanded[id]);

  const toggleAll = () => {
    const next: Record<string, boolean> = {};
    const val = !allExpanded;
    for (const id of allIds) next[id] = val;
    setExpanded(next);
  };

  const switchMode = (mode: ViewMode) => {
    setViewMode(mode);
    setOffset(0);
  };

  return (
    <div>
      {/* View Mode Tabs + Navigator */}
      <div className="flex flex-col gap-3 mb-4">
        {/* 뷰 모드 전환 */}
        <div className="flex items-center justify-between">
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            {([
              { key: "day" as ViewMode, label: "일" },
              { key: "week" as ViewMode, label: "주" },
              { key: "month" as ViewMode, label: "월" },
            ]).map((m) => (
              <button key={m.key} onClick={() => switchMode(m.key)}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  viewMode === m.key
                    ? "bg-white text-blue-600 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}>
                {m.label}
              </button>
            ))}
          </div>

          {/* 모두 펼치기/닫기 */}
          {data && allIds.length > 0 && (
            <button onClick={toggleAll}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-600 transition-colors">
              {allExpanded ? "모두 닫기" : "모두 펼치기"}
            </button>
          )}
        </div>

        {/* 날짜 네비게이터 */}
        <div className="flex items-center gap-3">
          <button onClick={() => setOffset((o) => o - 1)}
            className="px-2 py-1 rounded hover:bg-gray-100 text-gray-600 font-bold text-lg">◀</button>
          <span className="font-semibold text-gray-900">{headerLabel}</span>
          <button onClick={() => setOffset((o) => o + 1)}
            className="px-2 py-1 rounded hover:bg-gray-100 text-gray-600 font-bold text-lg">▶</button>
          {offset !== 0 && (
            <button onClick={() => setOffset(0)}
              className="ml-2 px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">오늘</button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-sm text-red-700">{error}</div>
      )}

      {loading && !data && (
        <div className="text-sm text-gray-400 py-8 text-center">불러오는 중...</div>
      )}

      {data && (
        <div className="space-y-2">
          {data.departments.map((dept) => (
            <DeptSection key={dept.id} dept={dept} days={days} viewMode={viewMode}
              isExpanded={expanded[dept.id] ?? false} onToggle={() => toggle(dept.id)} />
          ))}
          {data.unassigned.length > 0 && (
            <DeptSection
              key="__unassigned"
              dept={{ id: "__unassigned", name: "미배정", sortOrder: 999, members: data.unassigned }}
              days={days} viewMode={viewMode}
              isExpanded={expanded["__unassigned"] ?? false}
              onToggle={() => toggle("__unassigned")}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── DeptSection ─────────────────────────────────────────────────────────────

function DeptSection({ dept, days, viewMode, isExpanded, onToggle }: {
  dept: Department;
  days: string[];
  viewMode: ViewMode;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button onClick={onToggle}
        className="flex items-center gap-2 w-full py-2.5 px-4 bg-gray-50 hover:bg-gray-100 text-left">
        <span className="text-xs text-gray-400">{isExpanded ? "▼" : "►"}</span>
        <span className="font-semibold text-sm text-gray-800">{dept.name}</span>
        <span className="text-xs text-gray-500">({dept.members.length}명)</span>
      </button>
      {isExpanded && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse min-w-[640px]">
            <thead>
              <tr className="border-t border-gray-200">
                <th className="w-24 text-left px-3 py-2 text-xs font-semibold text-gray-500 bg-white sticky left-0 z-10">이름</th>
                {days.map((day) => (
                  <th key={day} className={`px-1 py-2 text-center text-xs font-semibold ${
                    viewMode === "month" ? "min-w-[36px]" : "min-w-[80px]"
                  } ${
                    isToday(day) ? "bg-blue-50 text-blue-700" :
                    isWeekend(day) ? "bg-gray-50 text-gray-400" : "text-gray-500"
                  }`}>
                    {viewMode === "month"
                      ? new Date(day).getDate()
                      : `${getDayLabel(day)} ${fmtShort(day)}`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dept.members.map((member) => (
                <MemberRow key={member.userId} member={member} days={days} viewMode={viewMode} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── MemberRow ───────────────────────────────────────────────────────────────

function MemberRow({ member, days, viewMode }: { member: Member; days: string[]; viewMode: ViewMode }) {
  const entriesByDate = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const e of member.entries) {
      if (!map.has(e.date)) map.set(e.date, []);
      map.get(e.date)!.push(e);
    }
    return map;
  }, [member.entries]);

  return (
    <tr className="border-t border-gray-100 hover:bg-gray-50/50">
      <td className="px-3 py-1.5 text-sm font-medium text-gray-800 bg-white sticky left-0 z-10 whitespace-nowrap">
        {member.name}
      </td>
      {days.map((day) => {
        const dayEntries = entriesByDate.get(day) ?? [];
        return (
          <td key={day} className={`px-0.5 py-1 text-center border-l border-gray-50 align-top ${
            isToday(day) ? "bg-blue-50/30" : isWeekend(day) ? "bg-gray-50/50" : ""
          }`}>
            <div className="flex flex-col items-center gap-0.5">
              {dayEntries.map((e) => {
                const timeStr = e.startTime && e.endTime
                  ? `${e.startTime}~${e.endTime}`
                  : e.startTime ? `${e.startTime}~`
                  : e.endTime ? `~${e.endTime}` : "";
                if (viewMode === "month") {
                  return (
                    <span key={e.id} className={`text-[10px] px-0.5 py-px rounded whitespace-nowrap ${ENTRY_COLORS[e.entryType] ?? "bg-gray-100 text-gray-600"}`}
                      title={[ENTRY_LABELS[e.entryType], timeStr, e.label].filter(Boolean).join(" / ")}>
                      {(ENTRY_LABELS[e.entryType] ?? e.entryType).slice(0, 1)}
                    </span>
                  );
                }
                return (
                  <div key={e.id} className={`rounded px-1 py-0.5 text-left w-full ${ENTRY_COLORS[e.entryType] ?? "bg-gray-100 text-gray-600"}`}
                    title={[ENTRY_LABELS[e.entryType], timeStr, e.label].filter(Boolean).join(" / ")}>
                    <div className="text-[10px] font-medium leading-tight truncate">{ENTRY_LABELS[e.entryType] ?? e.entryType}</div>
                    {timeStr && <div className="text-[9px] leading-tight opacity-75 truncate">{timeStr}</div>}
                    {e.label && <div className="text-[9px] leading-tight opacity-60 truncate">{e.label}</div>}
                  </div>
                );
              })}
            </div>
          </td>
        );
      })}
    </tr>
  );
}
