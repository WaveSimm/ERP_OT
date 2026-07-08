"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { attendanceOverviewApi } from "@/lib/api";

// ─── Constants ───────────────────────────────────────────────────────────────

const ENTRY_LABELS: Record<string, string> = {
  WORK: "출근", FIELD: "외근", TRAINING: "교육",
  BUSINESS_TRIP: "출장",
  HALF: "반차",
  HALF_AM: "오전반차", HALF_PM: "오후반차",  // legacy
  QUARTER: "1/4연차",
  FAMILY_DAY: "가정의날", FAMILY_DAY_2H: "가정의날(2H)",
  FAMILY: "가정의날",  // legacy
  BEREAVEMENT: "경조사",
  ANNUAL: "연차", SICK: "병가", SPECIAL: "공가", OT: "휴일근무",
};

const ENTRY_COLORS: Record<string, string> = {
  WORK: "bg-sky-100 text-sky-700",              // 출근 — 파랑(sky)
  FIELD: "bg-sky-100 text-sky-700",      // 근무군(외근·교육·출장) — 파랑(sky) (출근 숨김에 따라 파란색 사용)
  TRAINING: "bg-sky-100 text-sky-700",
  BUSINESS_TRIP: "bg-sky-100 text-sky-700",
  HALF: "bg-amber-100 text-amber-700",           // 휴가군 — 노랑(amber)
  HALF_AM: "bg-amber-100 text-amber-700",
  HALF_PM: "bg-amber-100 text-amber-700",
  QUARTER: "bg-amber-100 text-amber-700",
  FAMILY_DAY: "bg-amber-100 text-amber-700",
  FAMILY_DAY_2H: "bg-amber-100 text-amber-700",
  FAMILY: "bg-amber-100 text-amber-700",
  BEREAVEMENT: "bg-amber-100 text-amber-700",
  ANNUAL: "bg-amber-100 text-amber-700",
  SICK: "bg-amber-100 text-amber-700",
  SPECIAL: "bg-amber-100 text-amber-700",        // 공가 — 휴가군
  SUBSTITUTE: "bg-amber-100 text-amber-700",     // 연차대체 — 휴가군
  OT: "bg-rose-100 text-rose-700",               // 휴일근무 — 빨강(rose)
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

// 시간단위 바: 셀 폭 = 해당 멤버의 근무시간 축(유연근무 반영). 기본 09:30~18:30.
const DAY_START_MIN = 9 * 60 + 30;   // 09:30 (기본 근무 시작)
const DAY_END_MIN = 18 * 60 + 30;    // 18:30 (기본 근무 종료)
function toMin(t: string): number { const [h, m] = t.split(":").map(Number); return (h ?? 0) * 60 + (m ?? 0); }
// 시작/종료시각 → 셀 내 바의 left/width(%). 축(dayStart~dayEnd)은 멤버 근무시간. 시간 없으면 종일(0~100%).
function barGeom(
  startTime: string | null, endTime: string | null,
  dayStart: number = DAY_START_MIN, dayEnd: number = DAY_END_MIN,
): { left: number; width: number } {
  if (!startTime || !endTime) return { left: 0, width: 100 };
  const span = Math.max(1, dayEnd - dayStart);
  const s = Math.max(dayStart, Math.min(dayEnd, toMin(startTime)));
  const e = Math.max(dayStart, Math.min(dayEnd, toMin(endTime)));
  const left = ((s - dayStart) / span) * 100;
  const width = Math.max(6, Math.min(100 - left, ((e - s) / span) * 100));
  return { left, width };
}
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
  reason: string | null;  // 휴일근무(OT): 신청 사유 (백엔드가 신청서에서 조인)
  groupId: string | null;
  sourceType: string;
}

// 바 2번째 줄에 내역(사유)을 표시하는 유형 — 근무군(수동입력 label)·휴일근무(신청 reason)
function entryDetail(e: Entry): string | null {
  if (e.entryType === "OT") return e.reason || null;
  if (e.entryType === "FIELD" || e.entryType === "TRAINING" || e.entryType === "BUSINESS_TRIP") return e.label || null;
  return null;
}

interface Member {
  userId: string;
  name: string;
  workStartTime?: string;   // 본인 근무시간(유연근무). 바 축 기준. 없으면 09:30~18:30.
  workEndTime?: string;
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

interface Props {
  /** 회사달력 v1.2 — 일자별 휴일 Map (date → 휴일명). 미전달 시 휴일 표시 안 함 */
  holidays?: Map<string, string>;
}

export default function AttendanceOverview({ holidays }: Props = {}) {
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
                    ? "bg-white text-blue-600 dark:text-blue-400 shadow-sm"
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
        <div className="bg-red-50 border border-red-200 dark:border-red-800 rounded-lg p-3 mb-4 text-sm text-red-700 dark:text-red-300">{error}</div>
      )}

      {loading && !data && (
        <div className="text-sm text-gray-400 py-8 text-center">불러오는 중...</div>
      )}

      {data && (
        <div className="space-y-2">
          {data.departments.map((dept) => (
            <DeptSection key={dept.id} dept={dept} days={days} viewMode={viewMode}
              isExpanded={expanded[dept.id] ?? false} onToggle={() => toggle(dept.id)}
              holidays={holidays} />
          ))}
          {data.unassigned.length > 0 && (
            <DeptSection
              key="__unassigned"
              dept={{ id: "__unassigned", name: "미배정", sortOrder: 999, members: data.unassigned }}
              days={days} viewMode={viewMode}
              isExpanded={expanded["__unassigned"] ?? false}
              onToggle={() => toggle("__unassigned")}
              holidays={holidays}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── DeptSection ─────────────────────────────────────────────────────────────

function DeptSection({ dept, days, viewMode, isExpanded, onToggle, holidays }: {
  dept: Department;
  days: string[];
  viewMode: ViewMode;
  isExpanded: boolean;
  onToggle: () => void;
  holidays?: Map<string, string>;
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
          <table className="w-full text-sm border-collapse min-w-[640px] table-fixed">
            <thead>
              <tr className="border-t border-gray-200">
                <th className="w-28 text-left px-3 py-2 text-xs font-semibold text-gray-500 bg-white sticky left-0 z-10">이름</th>
                {days.map((day) => {
                  const holidayName = holidays?.get(day);
                  const isHol = !!holidayName;
                  const colorCls = isToday(day)
                    ? "bg-blue-50 text-blue-700 dark:text-blue-300"
                    : isHol
                    ? "bg-red-50 text-red-600 dark:text-red-300 font-bold"
                    : isWeekend(day)
                    ? "bg-gray-50 text-gray-400"
                    : "text-gray-500";
                  return (
                    <th
                      key={day}
                      className={`px-1 py-2 text-center text-xs font-semibold ${
                        viewMode === "month" ? "min-w-[36px]" : "min-w-[80px]"
                      } ${colorCls}`}
                      title={holidayName ?? undefined}
                    >
                      {viewMode === "month"
                        ? new Date(day).getDate()
                        : `${getDayLabel(day)} ${fmtShort(day)}`}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {dept.members.map((member) => (
                <MemberRow key={member.userId} member={member} days={days} viewMode={viewMode} holidays={holidays} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── MemberRow ───────────────────────────────────────────────────────────────

function MemberRow({ member, days, viewMode, holidays }: { member: Member; days: string[]; viewMode: ViewMode; holidays?: Map<string, string> }) {
  const entriesByDate = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const e of member.entries) {
      // 전사근태는 출퇴근 바(WORK, attendance_records에서 합성)를 표시 — 외근/휴가 등 예외와 함께
      if (!map.has(e.date)) map.set(e.date, []);
      map.get(e.date)!.push(e);
    }
    return map;
  }, [member.entries]);

  // 바 축 = 본인 근무시간(유연근무 반영). 없으면 회사 기본 09:30~18:30.
  const dayStart = member.workStartTime ? toMin(member.workStartTime) : DAY_START_MIN;
  const dayEnd = member.workEndTime ? toMin(member.workEndTime) : DAY_END_MIN;

  // 연속 병합 (2026-07-07): 같은 입력(그룹 등록 groupId, 또는 유형·시간·내용 동일)이
  //   연속된 날에 반복되면 colSpan 한 칸으로 합쳐 한 줄로 표시.
  //   그 날 표시할 엔트리가 해당 항목 하나뿐인 날끼리만 병합(다른 항목 섞인 날은 제외).
  const entrySig = (e: Entry) =>
    e.groupId ?? `${e.entryType}|${e.startTime ?? ""}|${e.endTime ?? ""}|${e.label ?? ""}|${e.reason ?? ""}`;
  const cellPlans = useMemo(() => {
    const visibleOf = (d: string) => (entriesByDate.get(d) ?? []).filter((e) => e.entryType !== "WORK");
    const plans: { day: string; endDay: string; span: number; entries: Entry[]; merged: boolean }[] = [];
    let i = 0;
    while (i < days.length) {
      const day = days[i]!;
      const es = visibleOf(day);
      if (es.length === 1) {
        const s = entrySig(es[0]!);
        let j = i + 1;
        while (j < days.length) {
          const es2 = visibleOf(days[j]!);
          if (es2.length === 1 && entrySig(es2[0]!) === s) j++;
          else break;
        }
        if (j - i > 1) {
          plans.push({ day, endDay: days[j - 1]!, span: j - i, entries: es, merged: true });
          i = j;
          continue;
        }
      }
      plans.push({ day, endDay: day, span: 1, entries: es, merged: false });
      i++;
    }
    return plans;
  }, [entriesByDate, days]);

  return (
    <tr className="border-t border-gray-100 hover:bg-gray-50/50 dark:hover:bg-gray-500/10">
      <td className="w-28 px-3 py-1.5 text-sm font-medium text-gray-800 bg-white sticky left-0 z-10 truncate">
        {member.name}
      </td>
      {cellPlans.map(({ day, endDay, span, entries: dayEntries, merged }) => {
        const isHol = !!holidays?.get(day);
        const cellBg = merged
          ? ""
          : isToday(day)
          ? "bg-blue-50/30 dark:bg-blue-500/10"
          : isHol
          ? "bg-red-50/40 dark:bg-red-500/10"
          : isWeekend(day)
          ? "bg-gray-50/50 dark:bg-gray-500/10"
          : "";
        return (
          <td key={day} colSpan={span > 1 ? span : undefined} className={`px-0.5 py-1 text-center border-l border-gray-50 align-top ${cellBg}`}>
            <div className={`flex flex-col gap-0.5 ${viewMode === "month" && !merged ? "items-center" : "items-stretch"}`}>
              {dayEntries.map((e) => {
                const timeStr = e.startTime && e.endTime
                  ? `${e.startTime}~${e.endTime}`
                  : e.startTime ? `${e.startTime}~`
                  : e.endTime ? `~${e.endTime}` : "";
                const detail = entryDetail(e);
                const tip = [
                  ENTRY_LABELS[e.entryType],
                  merged ? `${fmtShort(day)}~${fmtShort(endDay)} (${span}일)` : "",
                  timeStr,
                  detail ?? e.label,
                ].filter(Boolean).join(" / ");
                // 병합 바 — 기간 전체를 한 줄로 (유형·시간 + 내역)
                if (merged) {
                  return (
                    <div key={e.id}
                      className={`w-full h-8 rounded px-1 py-0.5 flex flex-col justify-center overflow-hidden ${ENTRY_COLORS[e.entryType] ?? "bg-gray-100 text-gray-600"}`}
                      title={tip}>
                      <span className="text-xs font-medium leading-none truncate">
                        {ENTRY_LABELS[e.entryType] ?? e.entryType}{timeStr ? ` ${timeStr}` : ""}
                      </span>
                      {viewMode !== "month" && (
                        detail ? (
                          <span className="text-xs leading-none truncate mt-0.5">{detail}</span>
                        ) : (
                          <span className="text-xs leading-none mt-0.5" aria-hidden>&nbsp;</span>
                        )
                      )}
                    </div>
                  );
                }
                if (viewMode === "month") {
                  return (
                    <span key={e.id} className={`text-xs px-0.5 py-px rounded whitespace-nowrap ${ENTRY_COLORS[e.entryType] ?? "bg-gray-100 text-gray-600"}`}
                      title={tip}>
                      {(ENTRY_LABELS[e.entryType] ?? e.entryType).slice(0, 1)}
                    </span>
                  );
                }
                // 타임라인 트랙: 전체 폭 = 본인 근무시간(유연근무 반영), 바는 시작시각 위치 + 길이
                const { left, width } = barGeom(e.startTime, e.endTime, dayStart, dayEnd);
                const isPartial = !!(e.startTime && e.endTime);
                // 근무군·휴일근무는 2줄 바 — 1줄=유형·시간, 2줄=내역(사유)
                return (
                  <div key={e.id} className={`w-full relative rounded bg-gray-100/60 dark:bg-gray-500/10 h-8`}
                    title={tip}>
                    <div className={`absolute top-0 bottom-0 rounded px-1 flex flex-col justify-center overflow-hidden ${ENTRY_COLORS[e.entryType] ?? "bg-gray-100 text-gray-600"}`}
                      style={{ left: `${left}%`, width: `${width}%` }}>
                      <span className="text-xs font-medium leading-none truncate">
                        {ENTRY_LABELS[e.entryType] ?? e.entryType}{isPartial && timeStr ? ` ${timeStr}` : ""}
                      </span>
                      {detail ? (
                        <span className="text-xs leading-none truncate mt-0.5">{detail}</span>
                      ) : (
                        <span className="text-xs leading-none mt-0.5" aria-hidden>&nbsp;</span>
                      )}
                    </div>
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
