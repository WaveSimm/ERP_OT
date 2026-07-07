"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { attendanceApi, leaveApi, holidayWorkApi, approvalLineApi, userManagementApi, attendanceOverviewApi, workScheduleApi, getUser } from "@/lib/api";
import { DateInput } from "@/components/ui/DateInput";
import AttendanceOverview from "@/components/AttendanceOverview";
import { useHolidaysMap } from "@/hooks/useHolidaysMap";
import { TimeInput } from "@/components/ui/TimeInput";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CalendarDay {
  date: string;
  status: string;
  checkIn: string | null;
  checkOut: string | null;
  netWorkMinutes: number;
  isLate: boolean;
  leaveType: string | null;
  otHours: number;
  isHoliday: boolean;
  holidayName: string | null;
  isWeekend: boolean;
}

interface WorkScheduleEntry {
  id: string;
  date: string;
  entryType: string;
  startTime: string | null;
  endTime: string | null;
  label: string | null;
  groupId: string | null;
  sourceType: string;
  sourceId: string | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ENTRY_LABELS: Record<string, string> = {
  WORK: "출근", FIELD: "외근", TRAINING: "교육",
  BUSINESS_TRIP: "출장",
  HALF: "반차",                  // v1.6: HALF_AM/HALF_PM 통합
  HALF_AM: "오전반차", HALF_PM: "오후반차",  // legacy 호환
  QUARTER: "1/4연차",
  FAMILY_DAY: "가정의날", FAMILY_DAY_2H: "가정의날(2H)",  // v1.6
  FAMILY: "가정의날",            // legacy 호환
  BEREAVEMENT: "경조사",         // v1.5
  ANNUAL: "연차", SICK: "병가", SPECIAL: "공가", OT: "휴일근무",
  SUBSTITUTE: "연차대체",
};

const ENTRY_COLORS: Record<string, string> = {
  WORK: "bg-sky-100 text-sky-700",              // 출근 — 파랑(sky)
  FIELD: "bg-sky-100 text-sky-700",      // 근무군(외근·교육·출장) — 파랑(sky), 전사근태와 통일
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

const ALL_ENTRY_TYPES = [
  { value: "FIELD", label: "외근" },
  { value: "TRAINING", label: "교육" },
  { value: "BUSINESS_TRIP", label: "출장" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtTime(iso: string | null) {
  if (!iso) return "--:--";
  return new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function toDateStr(d: Date) { return d.toISOString().slice(0, 10); }

// ─── Time Input (HH:mm, 시/분 개별 클릭 편집) ───────────────────────────────

// 출퇴근 시간 입력 전용 — H/M 분리 키보드 UX (일반 시간 입력은 @/components/ui/TimeInput)
function ClockTimeInput({ value, onChange, nextRef, hInputRef }: { value: string; onChange: (v: string) => void; nextRef?: React.MutableRefObject<HTMLInputElement | null>; hInputRef?: React.MutableRefObject<HTMLInputElement | null> }) {
  const [h, m] = value.split(":");
  const [hDraft, setHDraft] = useState(h);
  const [mDraft, setMDraft] = useState(m);
  const mRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setHDraft(h); setMDraft(m); }, [h, m]);

  const commitH = (v: string) => {
    const n = Math.min(23, Math.max(0, parseInt(v) || 0));
    const padded = String(n).padStart(2, "0");
    setHDraft(padded);
    onChange(`${padded}:${m}`);
  };
  const commitM = (v: string) => {
    const n = Math.min(59, Math.max(0, parseInt(v) || 0));
    const padded = String(n).padStart(2, "0");
    setMDraft(padded);
    onChange(`${h}:${padded}`);
  };

  const inputCls = "w-8 text-center bg-transparent text-sm font-medium focus:outline-none focus:bg-teal-50 rounded";

  return (
    <div className="flex items-center border border-gray-300 rounded-lg px-2 py-2 focus-within:ring-2 focus-within:ring-teal-500">
      <input ref={hInputRef} type="text" inputMode="numeric" maxLength={2}
        value={hDraft} onFocus={(e) => e.target.select()}
        onChange={(e) => {
          const raw = e.target.value.replace(/\D/g, "").slice(0, 2);
          setHDraft(raw);
          if (raw.length >= 2) { commitH(raw); mRef.current?.focus(); }
        }}
        onBlur={(e) => commitH(e.target.value)}
        className={inputCls} />
      <span className="text-gray-400 text-sm font-medium">:</span>
      <input ref={mRef} type="text" inputMode="numeric" maxLength={2}
        value={mDraft} onFocus={(e) => e.target.select()}
        onChange={(e) => {
          const raw = e.target.value.replace(/\D/g, "").slice(0, 2);
          setMDraft(raw);
          if (raw.length >= 2) { commitM(raw); nextRef?.current?.focus(); }
        }}
        onBlur={(e) => commitM(e.target.value)}
        className={inputCls} />
    </div>
  );
}

// ─── Work Entry Modal (근태 추가/수정) ───────────────────────────────────────

function getDatesInRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const cur = new Date(start);
  const last = new Date(end);
  while (cur <= last) {
    dates.push(toDateStr(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

function WorkEntryModal({ date, entry, onClose, onSuccess, onDelete, onDeleteLeave, defaultStart = "09:30", defaultEnd = "18:30" }: {
  date: string;
  entry?: WorkScheduleEntry | null;
  onClose: () => void;
  onSuccess: () => void;
  onDelete?: (id: string) => void;
  onDeleteLeave?: (leaveId: string) => void;   // 휴가 파생(LEAVE_APPROVED) 항목 삭제 — 휴가 레코드 제거
  defaultStart?: string;   // 본인 근무시간(유연근무 반영). 신규 입력 기본값.
  defaultEnd?: string;
}) {
  const isEdit = !!entry;
  const isEditable = !entry || entry.sourceType === "MANUAL";
  const hasGroup = !!(entry?.groupId);
  const [startDate, setStartDate] = useState(date);
  const [endDate, setEndDate] = useState(date);
  const [entryType, setEntryType] = useState(entry?.entryType ?? "FIELD");
  const [startTime, setStartTime] = useState(entry?.startTime ?? defaultStart);
  const [endTime, setEndTime] = useState(entry?.endTime ?? defaultEnd);
  const endTimeHRef = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState(entry?.label ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groupAction, setGroupAction] = useState<"single" | "group">(hasGroup ? "group" : "single");
  // 중간 릴리즈(2026-06-29): 근태 추가 모달에서 휴가/휴일근무도 직접 등록(승인 없이 즉시 반영)
  const [category, setCategory] = useState<"WORK" | "LEAVE" | "HOLIDAY">("WORK");
  const [leaveType, setLeaveType] = useState("ANNUAL");
  const leaveSingle = leaveType === "HALF" || leaveType === "QUARTER" || leaveType === "FAMILY_DAY" || leaveType === "FAMILY_DAY_2H";
  const LEAVE_OPTS: { v: string; l: string }[] = [
    { v: "ANNUAL", l: "연차" }, { v: "HALF", l: "반차(4시간)" }, { v: "QUARTER", l: "1/4연차(2시간)" },
    { v: "FAMILY_DAY", l: "가정의날(1시간)" }, { v: "FAMILY_DAY_2H", l: "가정의날(2시간)" },
    { v: "SUBSTITUTE", l: "연차대체" },
    { v: "BEREAVEMENT", l: "경조사" }, { v: "SICK", l: "병가" }, { v: "SPECIAL", l: "공가" },
  ];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      // 휴가/휴일근무 직접 등록 (추가 모드) — 승인 없이 즉시 반영
      if (!isEdit && category === "LEAVE") {
        await leaveApi.create({ type: leaveType, startDate, endDate: leaveSingle ? startDate : (endDate || startDate), reason: label.trim() || "휴가", direct: true, ...(leaveSingle ? { startTime } : {}) });
        onSuccess(); onClose(); return;
      }
      if (!isEdit && category === "HOLIDAY") {
        await holidayWorkApi.create({ date: startDate, reason: label.trim() || "휴일근무", direct: true });
        onSuccess(); onClose(); return;
      }
      if (isEdit && entry) {
        if (hasGroup && groupAction === "group") {
          await attendanceOverviewApi.updateGroup(entry.groupId!, {
            entryType,
            startTime,
            endTime,
            label: label.trim(),
          });
        } else {
          await attendanceOverviewApi.updateEntry(entry.id, {
            entryType,
            startTime,
            endTime,
            label: label.trim(),
          });
        }
      } else {
        const isMultiDay = entryType === "BUSINESS_TRIP" || entryType === "TRAINING";
        const dates = isMultiDay ? getDatesInRange(startDate, endDate) : [startDate];
        const gId = dates.length > 1 ? (Math.random().toString(36).slice(2) + Date.now().toString(36)) : undefined;
        for (let i = 0; i < dates.length; i++) {
          const isFirst = i === 0;
          const isLast = i === dates.length - 1;
          const isSingle = dates.length === 1;
          await attendanceOverviewApi.createEntry({
            date: dates[i],
            entryType,
            startTime: isSingle || isFirst ? startTime : undefined,
            endTime: isSingle || isLast ? endTime : undefined,
            ...(label.trim() ? { label: label.trim() } : {}),
            ...(gId ? { groupId: gId } : {}),
          });
        }
      }
      onSuccess();
      onClose();
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  };

  const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];
  const fmtDateLabel = (ds: string) => {
    const d = new Date(ds);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")} (${DAY_NAMES[d.getDay()]})`;
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-gray-900">{isEdit ? "근태 수정" : "근태 추가"}</h3>
            {isEdit && <p className="text-xs text-gray-500 mt-0.5">{fmtDateLabel(date)}</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        {!isEditable ? (
          <div className="space-y-3">
            <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-600">
              <p className="font-medium mb-1">{ENTRY_LABELS[entry!.entryType] ?? entry!.entryType}</p>
              {(entry!.startTime || entry!.endTime) && <p className="text-xs">{entry!.startTime ? entry!.startTime : ""}{entry!.startTime && entry!.endTime ? " ~ " : ""}{entry!.endTime ? (entry!.startTime ? entry!.endTime : `~${entry!.endTime}`) : ""}</p>}
              {entry!.label && <p className="text-xs text-gray-500">{entry!.label}</p>}
              <p className="text-[10px] text-gray-400 mt-2">
                {entry!.sourceType === "LEAVE_APPROVED"
                  ? "휴가 항목은 여기서 수정은 불가하며, 필요 시 삭제할 수 있습니다."
                  : "자동 생성된 항목은 수정할 수 없습니다."}
              </p>
            </div>
            <div className="flex gap-2">
              {entry!.sourceType === "LEAVE_APPROVED" && entry!.sourceId && onDeleteLeave && (
                <button type="button"
                  onClick={() => { if (window.confirm("이 휴가 항목을 삭제하시겠습니까? 연차가 복원됩니다.")) { onDeleteLeave(entry!.sourceId!); onClose(); } }}
                  className="flex-1 px-3 py-2 bg-red-50 text-red-600 border border-red-200 rounded-lg text-sm font-medium hover:bg-red-100">삭제</button>
              )}
              <button type="button" onClick={onClose} className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">닫기</button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            {/* 그룹 수정 범위 선택 (수정 모드 + groupId 있을 때) */}
            {isEdit && hasGroup && (
              <div className="flex gap-2 p-2 bg-gray-50 rounded-lg">
                <button type="button" onClick={() => setGroupAction("single")}
                  className={`flex-1 text-xs py-1.5 rounded-md font-medium transition-colors ${groupAction === "single" ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-700"}`}>
                  이 항목만
                </button>
                <button type="button" onClick={() => setGroupAction("group")}
                  className={`flex-1 text-xs py-1.5 rounded-md font-medium transition-colors ${groupAction === "group" ? "bg-white shadow text-teal-700" : "text-gray-500 hover:text-gray-700"}`}>
                  전체 일정
                </button>
              </div>
            )}
            {/* 구분 (추가 모드만): 근무 / 휴가 / 휴일근무 */}
            {!isEdit && (
              <div className="flex gap-1 p-1 bg-gray-100 rounded-lg">
                {([["WORK", "근무"], ["LEAVE", "휴가"], ["HOLIDAY", "휴일근무"]] as const).map(([v, l]) => (
                  <button key={v} type="button" onClick={() => setCategory(v)}
                    className={`flex-1 text-xs py-1.5 rounded-md font-medium transition-colors ${category === v ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-700"}`}>
                    {l}
                  </button>
                ))}
              </div>
            )}

            {/* ── 근무 (외근/교육/출장) ── */}
            {category === "WORK" && (<>
            <div>
              <label className="block text-xs text-gray-600 mb-1">근태 유형</label>
              <select value={entryType} onChange={(e) => setEntryType(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                {ALL_ENTRY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            {/* 날짜 선택 (추가 모드만) */}
            {!isEdit && (entryType === "BUSINESS_TRIP" || entryType === "TRAINING" ? (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">시작일</label>
                  <DateInput value={startDate} required onChange={(e) => {
                    setStartDate(e.target.value);
                    if (e.target.value > endDate) setEndDate(e.target.value);
                  }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">종료일</label>
                  <DateInput value={endDate} required min={startDate} onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-xs text-gray-600 mb-1">날짜</label>
                <DateInput value={startDate} required onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
            ))}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-gray-600 mb-1">시작 시간 (30분 단위)</label>
                <TimeInput value={startTime} step={1800} onChange={(e) => setStartTime(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">종료 시간 (30분 단위)</label>
                <TimeInput value={endTime} step={1800} onChange={(e) => setEndTime(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">내용 (선택)</label>
              <input type="text" value={label} onChange={(e) => setLabel(e.target.value)}
                placeholder="예: 강남 현장, 안전교육"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            </div>
            </>)}

            {/* ── 휴가 (즉시 반영) ── */}
            {category === "LEAVE" && (<>
            <div>
              <label className="block text-xs text-gray-600 mb-1">휴가 종류</label>
              <select value={leaveType} onChange={(e) => setLeaveType(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                {LEAVE_OPTS.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
              </select>
            </div>
            {leaveSingle ? (
              <div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">날짜</label>
                    <DateInput value={startDate} required onChange={(e) => setStartDate(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">시작시간 (30분 단위)</label>
                    <TimeInput value={startTime} step={1800} onChange={(e) => setStartTime(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                  </div>
                </div>
                {(() => {
                  const dur = leaveType === "HALF" ? 4 : leaveType === "QUARTER" ? 2 : leaveType === "FAMILY_DAY_2H" ? 2 : leaveType === "FAMILY_DAY" ? 1 : 0;
                  if (!dur || !startTime) return null;
                  const [h, m] = startTime.split(":").map(Number);
                  const t = h * 60 + m + dur * 60;
                  const et = `${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
                  return <p className="text-[11px] text-teal-600 mt-1">⏱ {startTime} ~ {et} ({dur}시간)</p>;
                })()}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">시작일</label>
                  <DateInput value={startDate} required onChange={(e) => { setStartDate(e.target.value); if (e.target.value > endDate) setEndDate(e.target.value); }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">종료일</label>
                  <DateInput value={endDate} required min={startDate} onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
              </div>
            )}
            <div>
              <label className="block text-xs text-gray-600 mb-1">사유</label>
              <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="사유"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            </div>
            </>)}

            {/* ── 휴일근무 (즉시 반영, 휴일/주말만) ── */}
            {category === "HOLIDAY" && (<>
            <div>
              <label className="block text-xs text-gray-600 mb-1">날짜 (휴일/주말)</label>
              <DateInput value={startDate} required onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">사유</label>
              <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="사유"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            </div>
            </>)}
            {error && <p className="text-xs text-red-500">{error}</p>}
            <div className="flex gap-2 pt-1">
              {isEdit && onDelete && (
                <button type="button" onClick={async () => {
                  if (hasGroup && groupAction === "group") {
                    try { await attendanceOverviewApi.deleteGroup(entry!.groupId!); } catch {}
                    onSuccess(); onClose();
                  } else {
                    onDelete(entry!.id); onClose();
                  }
                }}
                  className="px-3 py-2 border border-red-300 text-red-600 rounded-lg text-sm hover:bg-red-50">
                  {hasGroup && groupAction === "group" ? "전체 삭제" : "삭제"}
                </button>
              )}
              <button type="button" onClick={onClose} className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">취소</button>
              <button type="submit" disabled={saving} className="flex-1 bg-teal-600 text-white px-3 py-2 rounded-lg text-sm font-semibold hover:bg-teal-700 disabled:opacity-50">
                {saving ? (isEdit ? "수정 중..." : "등록 중...") : (isEdit ? "수정" : "등록")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── Monthly Calendar with Work Schedule Entries ─────────────────────────────

function MonthlyCalendar({ year, month, refresh, onEntryChanged, defaultStart, defaultEnd }: {
  year: number;
  month: number;
  refresh: number;
  onEntryChanged: () => void;
  defaultStart?: string;
  defaultEnd?: string;
}) {
  const [days, setDays] = useState<CalendarDay[]>([]);
  const [entries, setEntries] = useState<WorkScheduleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingDate, setAddingDate] = useState<string | null>(null);
  const [editingEntry, setEditingEntry] = useState<{ date: string; entry: WorkScheduleEntry } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

    const currentUser = getUser();

    Promise.all([
      attendanceApi.getCalendar(year, month),
      attendanceOverviewApi.getWeekly(startDate, endDate),
    ])
      .then(([cal, wsData]) => {
        if (cancelled) return;
        setDays(cal.days ?? []);

        // 내 엔트리만 추출
        const myEntries: WorkScheduleEntry[] = [];
        const collect = (members: any[]) => {
          for (const m of members) {
            if (currentUser && m.userId === currentUser.id) {
              for (const e of m.entries) myEntries.push(e);
            }
          }
        };
        if (wsData.departments) for (const d of wsData.departments) collect(d.members);
        if (wsData.unassigned) collect(wsData.unassigned);
        setEntries(myEntries);
        setLoading(false);
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [year, month, refresh]);

  const entriesByDate = useMemo(() => {
    const map = new Map<string, WorkScheduleEntry[]>();
    for (const e of entries) {
      if (!map.has(e.date)) map.set(e.date, []);
      map.get(e.date)!.push(e);
    }
    return map;
  }, [entries]);

  const handleDeleteEntry = async (id: string) => {
    try {
      await attendanceOverviewApi.deleteEntry(id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
      onEntryChanged();
    } catch {}
  };

  // 휴가 파생(가정의날 등 LEAVE_APPROVED) 항목 삭제 — 휴가 레코드 제거(캘린더 엔트리도 함께 삭제됨)
  const handleDeleteLeave = async (leaveId: string) => {
    try {
      await leaveApi.remove(leaveId);
      setEntries((prev) => prev.filter((e) => e.sourceId !== leaveId));
      onEntryChanged();
    } catch {}
  };

  if (loading) return <div className="text-sm text-gray-400 py-6 text-center">불러오는 중...</div>;

  const firstDay = new Date(year, month - 1, 1).getDay();
  const cells: (CalendarDay | null)[] = [...Array(firstDay).fill(null), ...days];
  while (cells.length % 7 !== 0) cells.push(null);
  const DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
  const todayStr = toDateStr(new Date());

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="p-3">
        <div className="grid grid-cols-7 mb-1">
          {DAY_LABELS.map((d, i) => (
            <div key={d} className={`text-center text-xs font-semibold py-1 ${i === 0 ? "text-red-500" : i === 6 ? "text-blue-500" : "text-gray-500"}`}>{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {cells.map((cell, idx) => {
            if (!cell) return <div key={`empty-${idx}`} className="min-h-[72px] rounded-lg" />;
            const dayNum = parseInt(cell.date.slice(8));
            const isToday = cell.date === todayStr;
            const dow = new Date(cell.date).getDay();
            // 출근(WORK)은 위 회색 출퇴근 글씨로 이미 표시 → 바 중복 방지 위해 제외. 외근/휴가 등만 바로 표시.
            const dayEntries = (entriesByDate.get(cell.date) ?? []).filter((e) => e.entryType !== "WORK");

            return (
              <div key={cell.date}
                className={`min-h-[72px] rounded-lg p-1 flex flex-col transition-colors group ${
                  isToday ? "bg-blue-50 ring-1 ring-blue-300" :
                  cell.isHoliday || cell.isWeekend ? "bg-gray-50" : ""
                }`}>
                {/* 날짜 헤더 + 출퇴근 — 고정 높이로 엔트리 시작 위치 통일 */}
                <div className="h-[40px] flex-shrink-0">
                  <div className="flex items-center gap-1">
                    <span className={`text-xs font-medium leading-none ${
                      isToday ? "text-blue-700 font-bold" :
                      dow === 0 || cell.isHoliday ? "text-red-500" :
                      dow === 6 ? "text-blue-500" : "text-gray-700"
                    }`}>{dayNum}</span>
                    <button onClick={() => setAddingDate(cell.date)}
                      className="text-red-500 hover:text-white hover:bg-red-500 rounded text-base font-bold leading-none transition-colors w-5 h-5 flex items-center justify-center shrink-0"
                      title="근태 추가">+</button>
                  </div>
                  {cell.isHoliday
                    ? <span className="text-xs text-red-400 truncate leading-tight">{cell.holidayName}</span>
                    : cell.checkIn && (
                      <span className="text-xs text-gray-400 leading-tight">
                        {fmtTime(cell.checkIn).slice(0, 5)}{cell.checkOut ? `~${fmtTime(cell.checkOut).slice(0, 5)}` : ""}
                      </span>
                    )
                  }
                </div>

                {/* 근태 엔트리 블록 — 1줄: 유형+시간(동일 크기), 2줄째: 내용 */}
                <div className="flex flex-col gap-0.5">
                  {dayEntries.slice(0, 2).map((entry) => {
                    const timeStr = entry.startTime && entry.endTime
                      ? `${entry.startTime}~${entry.endTime}`
                      : entry.startTime ? `${entry.startTime}~`
                      : entry.endTime ? `~${entry.endTime}` : "";
                    return (
                      <div key={entry.id}
                        onClick={() => setEditingEntry({ date: cell.date, entry })}
                        className={`rounded px-1 py-0.5 cursor-pointer hover:opacity-80 transition-opacity ${ENTRY_COLORS[entry.entryType] ?? "bg-gray-100 text-gray-600"}`}
                        title={[ENTRY_LABELS[entry.entryType], timeStr, entry.label].filter(Boolean).join(" / ")}>
                        <div className="text-xs font-medium leading-tight truncate">
                          {ENTRY_LABELS[entry.entryType] ?? entry.entryType}
                          {timeStr && <span className="font-normal opacity-75"> {timeStr}</span>}
                        </div>
                        {entry.label && (
                          <div className="text-xs leading-tight truncate">{entry.label}</div>
                        )}
                      </div>
                    );
                  })}
                  {dayEntries.length > 2 && (
                    <span className="text-xs text-gray-400">+{dayEntries.length - 2}건</span>
                  )}

                  {/* OT 표시 */}
                  {cell.otHours > 0 && !dayEntries.some((e) => e.entryType === "OT") && (
                    <span className="text-xs text-purple-500 leading-tight">휴일근무</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 근태 추가 모달 */}
      {addingDate && (
        <WorkEntryModal
          date={addingDate}
          onClose={() => setAddingDate(null)}
          onSuccess={() => { onEntryChanged(); }}
          defaultStart={defaultStart}
          defaultEnd={defaultEnd}
        />
      )}

      {/* 근태 수정 모달 */}
      {editingEntry && (
        <WorkEntryModal
          date={editingEntry.date}
          entry={editingEntry.entry}
          onClose={() => setEditingEntry(null)}
          onSuccess={() => { onEntryChanged(); }}
          onDelete={(id) => { handleDeleteEntry(id); }}
          onDeleteLeave={(leaveId) => { handleDeleteLeave(leaveId); }}
        />
      )}
    </div>
  );
}

// ─── Leave Request Form ───────────────────────────────────────────────────────

// ─── 휴가/휴일근무 신청 버튼 (전자결재 redirect) ──────────────────────────────
// 중간 릴리즈(2026-06-29): 전자결재 미사용 → 버튼 정의 비활성화. 재개 시 아래 함수 + 렌더 블록 복원.
/*
function LeaveRequestForm({ onSuccess: _onSuccess }: { onSuccess: () => void }) {
  const router = useRouter();
  return (
    <button
      onClick={() => router.push("/approval/new?template=LEAVE")}
      className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
    >
      + 휴가 신청
    </button>
  );
}

function HolidayWorkRequestForm({ onSuccess: _onSuccess }: { onSuccess: () => void }) {
  const router = useRouter();
  return (
    <button
      onClick={() => router.push("/approval/new?template=OT")}
      className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700"
    >
      + 휴일근무 신청
    </button>
  );
}
*/

// ─── AttendanceView (exported) ────────────────────────────────────────────────

// 화면 정리(2026-07-07, 관리부 요청): 연차현황·출퇴근(근무시간)·휴가/휴일근무 내역 제거,
//   월간 캘린더 + 전사근태(링크 대신 하단 직접 표시)로 단순화.
export default function AttendanceView() {
  const [refresh, setRefresh] = useState(0);
  // 본인 근무시간(유연근무 반영). 근태 추가 모달 기본값으로 사용. 로딩 전 회사 기본값.
  const [sched, setSched] = useState<{ start: string; end: string }>({ start: "09:30", end: "18:30" });
  const holidays = useHolidaysMap();

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  useEffect(() => {
    workScheduleApi.mine()
      .then((s) => { if (s?.workStartTime && s?.workEndTime) setSched({ start: s.workStartTime, end: s.workEndTime }); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handler = () => setRefresh((r) => r + 1);
    window.addEventListener("attendance-updated", handler);
    return () => window.removeEventListener("attendance-updated", handler);
  }, []);

  const navigateMonth = (dir: -1 | 1) => {
    let m = month + dir, y = year;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    setYear(y); setMonth(m);
  };

  return (
    <div className="space-y-6">
      {/* 중간 릴리즈(2026-06-29): 전자결재 미사용 → 휴가/휴일근무는 캘린더 날짜별 "+" 버튼(근태 추가)에서 직접 등록 */}

      {/* 월간 달력 (근태 통합) */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-900">내 월간 근태</h2>
          <div className="flex items-center gap-2">
            <button onClick={() => navigateMonth(-1)} className="p-1 text-gray-400 hover:text-gray-700 border border-gray-200 rounded">‹</button>
            <span className="text-sm font-medium text-gray-700">{year}년 {month}월</span>
            <button onClick={() => navigateMonth(1)} className="p-1 text-gray-400 hover:text-gray-700 border border-gray-200 rounded">›</button>
          </div>
        </div>
        <MonthlyCalendar year={year} month={month} refresh={refresh} onEntryChanged={() => setRefresh((r) => r + 1)} defaultStart={sched.start} defaultEnd={sched.end} />
        <p className="text-[10px] text-gray-400 mt-1.5 ml-1">날짜를 클릭하여 근태를 추가할 수 있습니다</p>
      </div>

      {/* 전사근태 — 링크 대신 하단 직접 표시 (2026-07-07) */}
      <div>
        <h2 className="text-sm font-semibold text-gray-900 mb-3">전사근태</h2>
        <AttendanceOverview holidays={holidays} />
      </div>
    </div>
  );
}
