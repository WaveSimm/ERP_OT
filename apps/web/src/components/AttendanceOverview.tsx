"use client";

import { useState, useEffect, useMemo, useCallback, type DragEvent } from "react";
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

// 막대 왼쪽 색상바(rod) — 은은한 중간톤 + 투명도(글씨보다 안 튀게). 유형 구분용.
const ENTRY_ACCENTS: Record<string, string> = {
  WORK: "bg-sky-400/50", FIELD: "bg-sky-400/50", TRAINING: "bg-sky-400/50", BUSINESS_TRIP: "bg-sky-400/50",
  HALF: "bg-amber-400/50", HALF_AM: "bg-amber-400/50", HALF_PM: "bg-amber-400/50", QUARTER: "bg-amber-400/50",
  FAMILY_DAY: "bg-amber-400/50", FAMILY_DAY_2H: "bg-amber-400/50", FAMILY: "bg-amber-400/50",
  BEREAVEMENT: "bg-amber-400/50", ANNUAL: "bg-amber-400/50", SICK: "bg-amber-400/50", SPECIAL: "bg-amber-400/50",
  SUBSTITUTE: "bg-amber-400/50", OT: "bg-rose-400/50",
};

// 삭제 가능 항목 hover 테두리 — 각 종류 색(accent) 계열의 진한 톤으로 시인성 확보(빨강 경고색 대신 통일감)
const ENTRY_RINGS: Record<string, string> = {
  WORK: "hover:ring-sky-500", FIELD: "hover:ring-sky-500", TRAINING: "hover:ring-sky-500", BUSINESS_TRIP: "hover:ring-sky-500",
  HALF: "hover:ring-amber-500", HALF_AM: "hover:ring-amber-500", HALF_PM: "hover:ring-amber-500", QUARTER: "hover:ring-amber-500",
  FAMILY_DAY: "hover:ring-amber-500", FAMILY_DAY_2H: "hover:ring-amber-500", FAMILY: "hover:ring-amber-500",
  BEREAVEMENT: "hover:ring-amber-500", ANNUAL: "hover:ring-amber-500", SICK: "hover:ring-amber-500", SPECIAL: "hover:ring-amber-500",
  SUBSTITUTE: "hover:ring-amber-500", OT: "hover:ring-rose-500",
};

const DAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"];

// 드래그 재정렬 제외(고정) 부서 — 회장단·대표이사·임원
const LOCKED_DEPTS = new Set(["회장단", "대표이사", "임원"]);

type ViewMode = "day" | "week" | "month";

// ─── Helpers ─────────────────────────────────────────────────────────────────

// 로컬(KST) 기준 "YYYY-MM-DD" — toISOString()은 UTC라 아침에 전날로 밀림
function fmt(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
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
  sourceId: string | null;  // 휴가결재 등록 단위(하나의 결재가 여러 날에 걸침) — 병합 판정용
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
  /** 섹션 제목. 전달 시 sticky 헤더 안(뷰탭·날짜 네비 위)에 함께 고정 렌더 */
  title?: string;
  /** 모바일 환경 여부. true면 이름 순서변경(드래그) 비활성 — 모바일에선 재정렬 불필요 */
  mobile?: boolean;
}

export default function AttendanceOverview({ holidays, title, mobile = false }: Props = {}) {
  // 모바일 환경 기본은 '일' 뷰 — 하루치는 화면폭에 맞아 가로 스크롤 없이 보임(아래 min-w 해제와 짝).
  const [viewMode, setViewMode] = useState<ViewMode>(mobile ? "day" : "week");
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

  // 부서 내 멤버 순서 재정렬 — 낙관적 업데이트 후 저장, 실패 시 서버 상태로 롤백.
  const reorderMembers = useCallback(async (deptId: string, orderedUserIds: string[]) => {
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        departments: prev.departments.map((d) => {
          if (d.id !== deptId) return d;
          const byId = new Map(d.members.map((m) => [m.userId, m]));
          const next = orderedUserIds.map((id) => byId.get(id)).filter((m): m is Member => !!m);
          return { ...d, members: next };
        }),
      };
    });
    try {
      await attendanceOverviewApi.reorderMembers(deptId, orderedUserIds);
    } catch {
      load(); // 실패 시 서버 상태로 복구
    }
  }, [load]);

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
      {/* View Mode Tabs + Navigator — 스크롤해도 상단 고정 (탭 헤더 바로 아래) */}
      <div
        className="sticky z-20 bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 flex flex-col gap-3 mb-4 pt-1 pb-2"
        style={{ top: "var(--attn-sticky-top, 10rem)" }}
      >
        {title && (
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
        )}
        {/* 뷰 모드 전환 */}
        <div className="flex items-center justify-between">
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            {([
              { key: "day" as ViewMode, label: "일" },
              { key: "week" as ViewMode, label: "주" },
              // 모바일에선 월 뷰 제외 — 30열이라 폭이 과해 부적합
              ...(mobile ? [] : [{ key: "month" as ViewMode, label: "월" }]),
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
              holidays={holidays}
              canReorder={!mobile && !LOCKED_DEPTS.has(dept.name)} onReorder={reorderMembers} />
          ))}
          {data.unassigned.length > 0 && (
            <DeptSection
              key="__unassigned"
              dept={{ id: "__unassigned", name: "미배정", sortOrder: 999, members: data.unassigned }}
              days={days} viewMode={viewMode}
              isExpanded={expanded["__unassigned"] ?? false}
              onToggle={() => toggle("__unassigned")}
              holidays={holidays}
              canReorder={false}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── DeptSection ─────────────────────────────────────────────────────────────

function DeptSection({ dept, days, viewMode, isExpanded, onToggle, holidays, canReorder, onReorder }: {
  dept: Department;
  days: string[];
  viewMode: ViewMode;
  isExpanded: boolean;
  onToggle: () => void;
  holidays?: Map<string, string>;
  canReorder?: boolean;
  onReorder?: (deptId: string, orderedUserIds: string[]) => void;
}) {
  const [dragUser, setDragUser] = useState<string | null>(null);
  const [overUser, setOverUser] = useState<string | null>(null);

  const dropOn = (targetUserId: string) => {
    if (!canReorder || !dragUser || dragUser === targetUserId) { setDragUser(null); setOverUser(null); return; }
    const ids = dept.members.map((m) => m.userId);
    const from = ids.indexOf(dragUser);
    const to = ids.indexOf(targetUserId);
    setDragUser(null); setOverUser(null);
    if (from < 0 || to < 0) return;
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved!);
    onReorder?.(dept.id, ids);
  };

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
          {/* 일 뷰는 하루(1열)라 화면폭에 맞춤(min-w 해제) → 작은 화면에서 가로 스크롤 없음.
              주/월 뷰는 열이 많아 min-w-[640px] 유지(넘치면 가로 스크롤). */}
          <table className={`w-full text-sm border-collapse table-fixed ${viewMode === "day" ? "" : "min-w-[640px]"}`}>
            <thead>
              <tr className="border-t border-b border-gray-200 dark:border-gray-700">
                <th className="w-20 sm:w-28 text-left px-3 py-2 text-xs font-semibold text-gray-500 bg-white sticky left-0 z-10 shadow-[inset_-1px_0_0_0_#e5e7eb] dark:shadow-[inset_-1px_0_0_0_#374151]">이름</th>
                {days.map((day, di) => {
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
                        di === 0 ? "" : "border-l border-gray-200 dark:border-gray-700"
                      } ${
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
                <MemberRow key={member.userId} member={member} days={days} viewMode={viewMode} holidays={holidays}
                  drag={canReorder ? {
                    canDrag: true,
                    isOver: overUser === member.userId && dragUser !== member.userId,
                    onDragStart: (e) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", member.userId);  // Firefox: 없으면 드래그 시작 안 됨
                      setDragUser(member.userId);
                    },
                    onDragOver: (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (overUser !== member.userId) setOverUser(member.userId); },
                    onDrop: (e) => { e.preventDefault(); dropOn(member.userId); },
                    onDragEnd: () => { setDragUser(null); setOverUser(null); },
                  } : undefined} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── MemberRow ───────────────────────────────────────────────────────────────

interface RowDrag {
  canDrag: boolean;
  isOver: boolean;
  onDragStart: (e: DragEvent) => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
  onDragEnd: () => void;
}

function MemberRow({ member, days, viewMode, holidays, drag }: { member: Member; days: string[]; viewMode: ViewMode; holidays?: Map<string, string>; drag?: RowDrag }) {
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

  // 표시 막대 생성 (레인 방식, 2026-07-09):
  //   ① 등록 단위(regKey = groupId(수동 기간등록) 또는 sourceId(휴가결재))가 같으면 하나의 일정.
  //      연속일에 걸치면 한 막대로 병합 — 같은 날 다른 항목(예: 가정의날)이 있어도 병합 유지.
  //      → 반차·가정의날 등을 날짜별로 따로 입력하면 regKey가 달라 병합 안 됨(의도).
  //   ② 병합 막대의 시각 = 시작일 startTime ~ 종료일 endTime. 경계일이 종일이면 근무시작/끝까지,
  //      한쪽 시각만 있으면(16:30~ / ~13:30) 그만큼만 그림(종일 처리 안 함).
  //   ③ 겹치는 막대는 레인(위아래)으로 쌓아 표시.
  const N = days.length;
  const regKey = (e: Entry) => e.groupId ?? (e.sourceId ? `src:${e.sourceId}` : null);
  const bars = useMemo(() => {
    const visibleOf = (d: string) => (entriesByDate.get(d) ?? []).filter((e) => e.entryType !== "WORK");
    type Bar = { startIdx: number; endIdx: number; e: Entry; spanStart: string | null; spanEnd: string | null; multi: boolean };
    const byKey = new Map<string, { idx: number; e: Entry }[]>();
    const items: Bar[] = [];
    days.forEach((d, idx) => {
      for (const e of visibleOf(d)) {
        const k = regKey(e);
        if (k != null) {
          if (!byKey.has(k)) byKey.set(k, []);
          byKey.get(k)!.push({ idx, e });
        } else {
          items.push({ startIdx: idx, endIdx: idx, e, spanStart: e.startTime, spanEnd: e.endTime, multi: false });
        }
      }
    });
    // 등록 단위별 연속일 런(run) 병합
    for (const list of byKey.values()) {
      list.sort((a, b) => a.idx - b.idx);
      let s = 0;
      while (s < list.length) {
        let t = s;
        while (t + 1 < list.length && list[t + 1]!.idx === list[t]!.idx + 1) t++;
        const first = list[s]!, last = list[t]!;
        items.push({
          startIdx: first.idx, endIdx: last.idx, e: first.e,
          spanStart: first.e.startTime, spanEnd: last.e.endTime, multi: t > s,
        });
        s = t + 1;
      }
    }
    // 레인 배정(겹침 방지) — 시작·종료 순 정렬 후 greedy
    items.sort((a, b) => a.startIdx - b.startIdx || a.endIdx - b.endIdx);
    const laneEnd: number[] = [];
    return items.map((it) => {
      let lane = laneEnd.findIndex((end) => end < it.startIdx);
      if (lane === -1) { lane = laneEnd.length; laneEnd.push(it.endIdx); }
      else laneEnd[lane] = it.endIdx;
      return { ...it, lane };
    });
  }, [entriesByDate, days]);

  const laneCount = bars.reduce((m, b) => Math.max(m, b.lane + 1), 0);
  // 월간·주간 통일 — 뷰 전환 시 행 높이 동일하게 보이도록. 일반 행 = PAD*2 + ROW_H = 45px
  const ROW_H = 37;
  const GAP = 3, PAD = 4;
  const rowHeight = Math.max(
    45,
    PAD * 2 + laneCount * ROW_H + Math.max(0, laneCount - 1) * GAP,
  );

  const axisSpan = Math.max(1, dayEnd - dayStart);
  // 일자 내 시각 → 0~1 위치(근무시간 축). 시각 없으면 fb(시작 0 / 끝 1)
  const frac = (t: string | null, fb: number) =>
    t ? Math.min(1, Math.max(0, (toMin(t) - dayStart) / axisSpan)) : fb;

  return (
    <tr
      onDragOver={drag?.onDragOver}
      onDrop={drag?.onDrop}
      className={`group border-t border-gray-100 hover:bg-gray-50/50 dark:hover:bg-gray-500/10 ${
        drag?.isOver ? "outline outline-2 -outline-offset-2 outline-blue-400" : ""
      }`}
    >
      <td
        draggable={drag?.canDrag}
        onDragStart={drag?.onDragStart}
        onDragEnd={drag?.onDragEnd}
        className={`w-20 sm:w-28 px-3 py-1.5 text-sm font-medium text-gray-800 bg-white sticky left-0 z-10 truncate shadow-[inset_-1px_0_0_0_#e5e7eb] dark:shadow-[inset_-1px_0_0_0_#374151] ${drag?.canDrag ? "cursor-move" : ""}`}>
        {/* 드래그 소스는 이름 열(td) 자체 — 일정 타임라인 셀은 draggable 아님(일정 텍스트 복사 가능).
            별도 핸들 아이콘 없이 커서(cursor-move)로만 드래그 가능함을 표시. */}
        {member.name}
      </td>
      <td colSpan={N} className="p-0 align-top">
        <div className="relative" style={{ height: rowHeight }}>
          {/* 배경 일자 스트라이프 — 오늘/휴일/주말 음영 + 열 구분선 */}
          <div className="absolute inset-0 flex">
            {days.map((d, di) => {
              const isHol = !!holidays?.get(d);
              const bg = isToday(d)
                ? "bg-blue-50/30 dark:bg-blue-500/10"
                : isHol
                ? "bg-red-50/40 dark:bg-red-500/10"
                : isWeekend(d)
                ? "bg-gray-50/50 dark:bg-gray-500/10"
                : "";
              return <div key={d} className={`flex-1 ${di === 0 ? "" : "border-l border-gray-200 dark:border-gray-700"} ${bg}`} />;
            })}
          </div>
          {/* 막대 — 시작일 시작시각 ~ 종료일 종료시각을 실제 폭으로 */}
          {bars.map((b) => {
            // 시각 위치(근무시간 축)로 그리되, 막대는 자기 날짜 칸 안으로 clamp — 다음날로 넘어감 방지.
            //   얇아서 최소폭이 필요하면 오른쪽 경계에 붙인 채 왼쪽으로만 확장(그날 오후 끝에 딱 맞음).
            const dayLeft = (b.startIdx / N) * 100;
            const dayRight = ((b.endIdx + 1) / N) * 100;
            const minW = (100 / N) * 0.2;
            let left = Math.min(Math.max(((b.startIdx + frac(b.spanStart, 0)) / N) * 100, dayLeft), dayRight);
            let right = Math.min(Math.max(((b.endIdx + frac(b.spanEnd, 1)) / N) * 100, dayLeft), dayRight);
            if (right - left < minW) {
              left = Math.max(dayLeft, right - minW);
              if (right - left < minW) right = Math.min(dayRight, left + minW);
            }
            const width = right - left;
            const timeStr = b.spanStart || b.spanEnd ? `${b.spanStart ?? ""}~${b.spanEnd ?? ""}` : "";
            const detail = entryDetail(b.e);
            const label = ENTRY_LABELS[b.e.entryType] ?? b.e.entryType;
            const tip = [
              label,
              b.multi ? `${fmtShort(days[b.startIdx]!)}~${fmtShort(days[b.endIdx]!)} (${b.endIdx - b.startIdx + 1}일)` : "",
              timeStr,
              detail ?? b.e.label,
            ].filter(Boolean).join(" / ");
            // 막대를 칸 안쪽으로 좌우로 들여 여백 — 상하 여백(PAD)과 동일하게 맞춤
            const INSET = PAD;
            const style = { left: `calc(${left}% + ${INSET}px)`, width: `calc(${width}% - ${INSET * 2}px)`, top: PAD + b.lane * (ROW_H + GAP), height: ROW_H } as const;
            const colorCls = ENTRY_COLORS[b.e.entryType] ?? "bg-gray-100 text-gray-600";
            const accentCls = ENTRY_ACCENTS[b.e.entryType] ?? "bg-gray-400/50";
            if (viewMode === "month") {
              // 칸이 좁아 글자 대신 색 블록만 — 상세는 툴팁(title)으로 확인
              return (
                <div key={`${b.e.id}:${b.startIdx}`} title={tip}
                  className={`absolute rounded overflow-hidden ${colorCls}`} style={style} />
              );
            }
            return (
              <div key={`${b.e.id}:${b.startIdx}`} title={tip}
                className={`absolute rounded pl-1.5 pr-1 flex flex-col justify-center overflow-hidden ${colorCls}`} style={style}>
                {/* rod: 텍스트와 같은 행에 두고 items-stretch로 글씨 높이(첫 줄~끝 줄)에 맞춤 */}
                <div className="flex items-stretch gap-1.5 min-w-0">
                  <span className={`w-[3px] rounded-sm shrink-0 ${accentCls}`} aria-hidden />
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs font-medium leading-none truncate">
                      {label}{timeStr ? ` ${timeStr}` : ""}
                    </span>
                    {detail && <span className="text-xs leading-none truncate mt-0.5 opacity-75">{detail}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </td>
    </tr>
  );
}
