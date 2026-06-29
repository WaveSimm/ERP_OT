"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { attendanceApi, leaveApi, holidayWorkApi, approvalLineApi, approvalApi, userManagementApi, attendanceOverviewApi, getUser } from "@/lib/api";
import { DateInput } from "@/components/ui/DateInput";
import { TimeInput } from "@/components/ui/TimeInput";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TodayRecord {
  id: string;
  date: string;
  checkState: "NOT_STARTED" | "CHECKED_IN" | "ON_BREAK" | "CHECKED_OUT";
  checkIn: string | null;
  checkOut: string | null;
  workType: string;
  isLate: boolean;
  netWorkMinutes: number;
  note: string | null;
}

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

interface LeaveBalance {
  totalDays: number;        // 정기 연차 (기본 15일)
  longServiceDays?: number; // 장기근속 휴가
  adjustedDays?: number;    // 임시 조정
  usedDays: number;
  pendingDays: number;
  remainingDays: number;
  // 가정의 날 (매월 4시간, 이월 없음) — 이번 달 기준
  familyDayTotal?: number;
  familyDayUsed?: number;
  familyDayRemaining?: number;
  // 연차대체 (휴일근무 보상, 발생연도 다음해 3월말까지)
  substituteTotal?: number;
  substituteUsed?: number;
  substituteRemaining?: number;
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
}

// ─── Constants ───────────────────────────────────────────────────────────────

const WORK_ENTRY_TYPES = [
  { value: "WORK", label: "사무실 출근" },
  { value: "FIELD", label: "외근" },
  { value: "TRAINING", label: "교육" },
  { value: "BUSINESS_TRIP", label: "출장" },
];

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
  WORK: "bg-blue-100 text-blue-800",
  FIELD: "bg-green-100 text-green-800",
  TRAINING: "bg-purple-100 text-purple-800",
  BUSINESS_TRIP: "bg-orange-100 text-orange-800",
  HALF: "bg-yellow-100 text-yellow-800",
  HALF_AM: "bg-yellow-100 text-yellow-800",
  HALF_PM: "bg-yellow-100 text-yellow-800",
  QUARTER: "bg-amber-100 text-amber-800",
  FAMILY_DAY: "bg-emerald-100 text-emerald-800",
  FAMILY_DAY_2H: "bg-emerald-100 text-emerald-800",
  FAMILY: "bg-emerald-100 text-emerald-800",
  BEREAVEMENT: "bg-rose-100 text-rose-800",
  ANNUAL: "bg-red-100 text-red-800",
  SICK: "bg-pink-100 text-pink-800",
  SPECIAL: "bg-indigo-100 text-indigo-800",
  OT: "bg-gray-200 text-gray-800",
  SUBSTITUTE: "bg-cyan-100 text-cyan-800",
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

function fmtMinutes(mins: number) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}분`;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}

function toDateStr(d: Date) { return d.toISOString().slice(0, 10); }

// ─── CheckIn Widget ───────────────────────────────────────────────────────────

function CheckInWidget({ today, onAction }: { today: TodayRecord | null; onAction: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entryType, setEntryType] = useState("WORK");

  const doAction = async (action: () => Promise<any>) => {
    setLoading(true);
    setError(null);
    try { await action(); }
    catch (e: any) { setError(e.message); }
    finally {
      onAction();
      window.dispatchEvent(new CustomEvent("attendance-updated"));
      setLoading(false);
    }
  };

  const handleCheckIn = async () => {
    // entryType(UI) → workType(backend enum: OFFICE/REMOTE/FIELD) 매핑
    const workType =
      entryType === "FIELD" || entryType === "BUSINESS_TRIP" ? "FIELD" :
      entryType === "TRAINING" ? "OFFICE" :
      "OFFICE";
    await doAction(async () => {
      await attendanceApi.checkIn({ workType });
      try {
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, "0");
        const mm = String(now.getMinutes()).padStart(2, "0");
        await attendanceOverviewApi.createEntry({ date: toDateStr(now), entryType, startTime: `${hh}:${mm}` });
      } catch {}
    });
  };

  if (!today) return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between">
      <div className="text-sm text-gray-400">출퇴근 상태를 불러오는 중...</div>
    </div>
  );

  const state = today.checkState;
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${
            state === "CHECKED_IN" ? "bg-green-500 animate-pulse" :
            state === "ON_BREAK"   ? "bg-orange-500 animate-pulse" :
            state === "CHECKED_OUT"? "bg-gray-400" : "bg-gray-200"
          }`} />
          <span className="text-sm font-semibold text-gray-900">
            {state === "NOT_STARTED" ? "출근 전" :
             state === "CHECKED_IN"  ? "근무 중" :
             state === "ON_BREAK"    ? "외출 중" : "퇴근 완료"}
          </span>
          {today.isLate && state !== "NOT_STARTED" && (
            <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">지각</span>
          )}
        </div>
        <div className="text-sm text-gray-500">{today.date}</div>
      </div>
      <div className="flex items-center gap-4 text-xs text-gray-500 mb-3">
        <span>출근: <strong className="text-gray-800">{fmtTime(today.checkIn)}</strong></span>
        <span>퇴근: <strong className="text-gray-800">{fmtTime(today.checkOut)}</strong></span>
        {today.netWorkMinutes > 0 && (
          <span>근무: <strong className="text-blue-600">{fmtMinutes(today.netWorkMinutes)}</strong></span>
        )}
      </div>
      {error && <div className="text-xs text-red-500 mb-2">{error}</div>}
      <div className="flex gap-2">
        {state === "NOT_STARTED" && (<>
          <select value={entryType} onChange={(e) => setEntryType(e.target.value)}
            className="px-2 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500">
            {WORK_ENTRY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <button onClick={() => { if (confirm("출근 처리하시겠습니까?")) handleCheckIn(); }} disabled={loading}
            className="flex-1 bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-green-700 disabled:opacity-50">출근</button>
        </>)}
        {state === "CHECKED_IN" && (<>
          <button onClick={() => { if (confirm("외출 처리하시겠습니까?")) doAction(() => attendanceApi.breakOut()); }} disabled={loading}
            className="flex-1 bg-orange-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-orange-600 disabled:opacity-50">외출</button>
          <button onClick={() => { if (confirm("퇴근 처리하시겠습니까?\n퇴근 후에는 되돌릴 수 없습니다.")) doAction(() => attendanceApi.checkOut()); }} disabled={loading}
            className="flex-1 bg-gray-700 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-gray-800 disabled:opacity-50">퇴근</button>
        </>)}
        {state === "ON_BREAK" && (
          <button onClick={() => { if (confirm("복귀 처리하시겠습니까?")) doAction(() => attendanceApi.breakIn()); }} disabled={loading}
            className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">복귀</button>
        )}
        {state === "CHECKED_OUT" && (
          <div className="flex-1 text-center text-sm text-gray-500 py-2">
            오늘 근무: <strong className="text-gray-800">{fmtMinutes(today.netWorkMinutes)}</strong>
          </div>
        )}
      </div>
    </div>
  );
}

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

function WorkEntryModal({ date, entry, onClose, onSuccess, onDelete }: {
  date: string;
  entry?: WorkScheduleEntry | null;
  onClose: () => void;
  onSuccess: () => void;
  onDelete?: (id: string) => void;
}) {
  const isEdit = !!entry;
  const isEditable = !entry || entry.sourceType === "MANUAL";
  const hasGroup = !!(entry?.groupId);
  const [startDate, setStartDate] = useState(date);
  const [endDate, setEndDate] = useState(date);
  const [entryType, setEntryType] = useState(entry?.entryType ?? "FIELD");
  const [startTime, setStartTime] = useState(entry?.startTime ?? "09:30");
  const [endTime, setEndTime] = useState(entry?.endTime ?? "18:30");
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
              <p className="text-[10px] text-gray-400 mt-2">자동 생성된 항목은 수정할 수 없습니다.</p>
            </div>
            <button type="button" onClick={onClose} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">닫기</button>
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
                <label className="block text-xs text-gray-600 mb-1">시작 시간</label>
                <ClockTimeInput value={startTime} onChange={setStartTime} nextRef={endTimeHRef} />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">종료 시간</label>
                <ClockTimeInput value={endTime} onChange={setEndTime} hInputRef={endTimeHRef} />
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

function MonthlyCalendar({ year, month, refresh, onEntryChanged }: {
  year: number;
  month: number;
  refresh: number;
  onEntryChanged: () => void;
}) {
  const [days, setDays] = useState<CalendarDay[]>([]);
  const [summary, setSummary] = useState<any>(null);
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
      attendanceApi.getSummary(year, month),
      attendanceOverviewApi.getWeekly(startDate, endDate),
    ])
      .then(([cal, sum, wsData]) => {
        if (cancelled) return;
        setDays(cal.days ?? []);
        setSummary(sum);

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

  if (loading) return <div className="text-sm text-gray-400 py-6 text-center">불러오는 중...</div>;

  const firstDay = new Date(year, month - 1, 1).getDay();
  const cells: (CalendarDay | null)[] = [...Array(firstDay).fill(null), ...days];
  while (cells.length % 7 !== 0) cells.push(null);
  const DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
  const todayStr = toDateStr(new Date());

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      {summary && (
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex flex-wrap gap-4 text-xs text-gray-600">
          <span>출근 <strong className="text-gray-900">{summary.normalCount ?? 0}일</strong></span>
          <span>지각 <strong className="text-orange-600">{summary.lateCount ?? 0}일</strong></span>
          <span>결근 <strong className="text-red-600">{summary.absentCount ?? 0}일</strong></span>
          <span>휴가 <strong className="text-blue-600">{summary.leaveCount ?? 0}일</strong></span>
          <span>총 근무 <strong className="text-blue-700">{fmtMinutes(summary.totalWorkMinutes ?? 0)}</strong></span>
          <span>휴일근무 <strong className="text-purple-600">{(summary.totalOtHours ?? 0).toFixed(1)}h</strong></span>
        </div>
      )}
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
            const dayEntries = entriesByDate.get(cell.date) ?? [];

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
                    ? <span className="text-[9px] text-red-400 truncate leading-tight">{cell.holidayName}</span>
                    : cell.checkIn && (
                      <span className="text-[9px] text-gray-400 leading-tight">
                        {fmtTime(cell.checkIn).slice(0, 5)}{cell.checkOut ? `~${fmtTime(cell.checkOut).slice(0, 5)}` : ""}
                      </span>
                    )
                  }
                </div>

                {/* 근태 엔트리 블록 — 3줄: 유형 / 시간 / 내용 */}
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
                        <div className="text-[10px] font-medium leading-tight truncate">
                          {ENTRY_LABELS[entry.entryType] ?? entry.entryType}
                        </div>
                        {timeStr && (
                          <div className="text-[9px] leading-tight opacity-75 truncate">{timeStr}</div>
                        )}
                        {entry.label && (
                          <div className="text-[9px] leading-tight opacity-60 truncate">{entry.label}</div>
                        )}
                      </div>
                    );
                  })}
                  {dayEntries.length > 2 && (
                    <span className="text-[9px] text-gray-400">+{dayEntries.length - 2}건</span>
                  )}

                  {/* OT 표시 */}
                  {cell.otHours > 0 && !dayEntries.some((e) => e.entryType === "OT") && (
                    <span className="text-[9px] text-purple-500 leading-tight">휴일근무</span>
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
        />
      )}
    </div>
  );
}

// ─── Leave Balance Card ───────────────────────────────────────────────────────

// 연차 현황 — 상단 슬림 바 (한 줄: 잔여/전체 · 사용 · 대기 · 가정의 날)
function LeaveBalanceCard({ balance }: { balance: LeaveBalance | null }) {
  if (!balance) return null;
  const longSvc = balance.longServiceDays ?? 0;
  const adj = balance.adjustedDays ?? 0;
  const subTotal = balance.substituteTotal ?? 0;        // 연차대체 발생(유효)
  const subRem = balance.substituteRemaining ?? 0;
  const total = balance.totalDays + longSvc + adj + subTotal;
  const used = balance.usedDays + (balance.substituteUsed ?? 0);
  const remaining = balance.remainingDays + subRem;
  // 전체 구성: 정기 · 대체 · 근속 (조정은 0 아닐 때만)
  const breakdown = [`정기 ${balance.totalDays}일`, `대체 ${subTotal}일`, `근속 ${longSvc}일`];
  if (adj !== 0) breakdown.push(`조정 ${adj > 0 ? "+" : ""}${adj}일`);
  return (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="text-sm font-semibold text-gray-900">
          연차 현황 <span className="text-xs font-normal text-gray-400">{new Date().getFullYear()}</span>
        </span>
        <span className="text-xs text-gray-500">사용 <span className="font-medium text-gray-700">{used}일</span></span>
        <span className="flex items-baseline gap-1 text-xs">
          <span className="text-gray-500">잔여</span>
          <span className="text-base font-bold text-blue-600 leading-none">{remaining}일</span>
          <span className="text-gray-400">/ 전체 {total}일</span>
          <span className="text-gray-400">({breakdown.join(" · ")})</span>
        </span>
        {balance.pendingDays > 0 && <span className="text-xs text-amber-600">대기 {balance.pendingDays}일</span>}
        {typeof balance.familyDayTotal === "number" && (
          <span className="text-xs text-gray-500 sm:ml-auto flex items-baseline gap-1.5 sm:border-l sm:border-gray-200 sm:pl-4">
            <span className="text-gray-600 font-medium">가정의 날</span>
            <span className="text-gray-400">(이번 달)</span>
            <span>사용 {balance.familyDayUsed ?? 0}시간</span>
            <span>· 잔여 <span className="font-semibold text-rose-600">{balance.familyDayRemaining}</span>시간</span>
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Leave Request Form ───────────────────────────────────────────────────────

const LEAVE_TYPES = [
  { value: "ANNUAL", label: "연차" },
  { value: "HALF", label: "반차(4시간)" },
  { value: "QUARTER", label: "1/4연차(2시간)" },
  { value: "FAMILY_DAY", label: "가정의날(1시간)" },
  { value: "FAMILY_DAY_2H", label: "가정의날(2시간)" },
  { value: "SUBSTITUTE", label: "연차대체" },
  { value: "BEREAVEMENT", label: "경조사" },
  { value: "SICK", label: "병가" },
  { value: "SPECIAL", label: "공가" },
];

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

// ─── Leave / 휴일근무 History ─────────────────────────────────────────────────

const APPROVAL_STATUS: Record<string, { label: string; color: string }> = {
  PENDING:   { label: "대기", color: "text-amber-600 bg-amber-50" },
  APPROVED:  { label: "승인", color: "text-green-600 bg-green-50" },
  REJECTED:  { label: "반려", color: "text-red-600 bg-red-50" },
  CANCELLED: { label: "취소", color: "text-gray-500 bg-gray-50" },
};

function LeaveHistory({ refresh }: { refresh: number }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    setLoading(true);
    Promise.all([
      leaveApi.list().catch(() => [] as any[]),
      approvalApi.getSentDocuments(1, 50).then((r: any) => r?.items ?? []).catch(() => [] as any[]),
    ]).then(([list, sent]: [any[], any[]]) => {
      const rows = (list ?? []).filter((i: any) => i.status !== "CANCELLED");
      // 승인 전 전자결재 휴가 결재(아직 근태에 미반영) 병합 — APPROVED는 위 휴가 레코드로 표시되므로 제외
      const pendingDocs = (sent ?? [])
        .filter((d: any) => d.template?.code === "LEAVE" && d.status !== "APPROVED" && d.status !== "DRAFT")
        .map((d: any) => ({
          id: d.id,
          type: d.content?.leaveType,
          startDate: d.content?.startDate,
          endDate: d.content?.endDate,
          status: d.status === "REJECTED" ? "REJECTED" : "PENDING",
          _docId: d.id,
        }));
      setItems([...pendingDocs, ...rows]);
    }).finally(() => setLoading(false));
  }, [refresh]);

  // 중간 릴리즈(2026-06-29): 승인 개념 제거 → 삭제(연차 복원 + 캘린더 제거)
  const del = async (id: string) => {
    if (!window.confirm("이 휴가를 삭제하시겠습니까? 연차가 복원됩니다.")) return;
    await leaveApi.remove(id);
    setItems((prev) => prev.filter((i) => i.id !== id));
    window.dispatchEvent(new CustomEvent("attendance-updated"));
  };

  if (loading) return <div className="text-xs text-gray-400 py-4 text-center">불러오는 중...</div>;
  return (
    <div className="space-y-2">
      {items.length === 0 && <div className="text-xs text-gray-400 text-center py-4">신청 내역이 없습니다.</div>}
      {items.map((item) => {
        const st = APPROVAL_STATUS[item.status] ?? { label: item.status, color: "text-gray-500 bg-gray-50" };
        return (
          <div key={item.id} className="flex items-center gap-3 px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-sm">
            <div className="flex-1 min-w-0">
              <div className="font-medium text-gray-900">{LEAVE_TYPES.find((t) => t.value === item.type)?.label ?? item.type ?? "휴가"}</div>
              <div className="text-xs text-gray-400">{item.startDate?.slice(0, 10)} ~ {item.endDate?.slice(0, 10)}</div>
            </div>
            {item._docId ? (
              <>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.color}`}>{st.label}</span>
                <button onClick={() => router.push(`/approval/${item._docId}`)} className="text-xs text-blue-500 hover:text-blue-700">보기</button>
              </>
            ) : (
              <button onClick={() => del(item.id)} className="text-xs text-red-500 hover:text-red-700">삭제</button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function HolidayWorkHistory({ refresh }: { refresh: number }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    setLoading(true);
    Promise.all([
      holidayWorkApi.list().catch(() => [] as any[]),
      approvalApi.getSentDocuments(1, 50).then((r: any) => r?.items ?? []).catch(() => [] as any[]),
    ]).then(([list, sent]: [any[], any[]]) => {
      // 승인 전 전자결재 휴일근무 결재(아직 근태에 미반영) 병합
      const pendingDocs = (sent ?? [])
        .filter((d: any) => d.template?.code === "OT" && d.status !== "APPROVED" && d.status !== "DRAFT")
        .map((d: any) => {
          const wd = d.content?.workDates;
          const firstDate = Array.isArray(wd) ? wd[0] : (d.content?.workDate ?? "");
          return {
            id: d.id,
            date: firstDate,
            reason: d.content?.reason,
            status: d.status === "REJECTED" ? "REJECTED" : "PENDING",
            _docId: d.id,
          };
        });
      setItems([...pendingDocs, ...(list ?? [])]);
    }).finally(() => setLoading(false));
  }, [refresh]);

  // 중간 릴리즈(2026-06-29): 승인 개념 제거 → 삭제(캘린더 제거)
  const del = async (id: string) => {
    if (!window.confirm("이 휴일근무를 삭제하시겠습니까?")) return;
    await holidayWorkApi.remove(id);
    setItems((prev) => prev.filter((i) => i.id !== id));
    window.dispatchEvent(new CustomEvent("attendance-updated"));
  };

  if (loading) return <div className="text-xs text-gray-400 py-4 text-center">불러오는 중...</div>;
  return (
    <div className="space-y-2">
      {items.length === 0 && <div className="text-xs text-gray-400 text-center py-4">신청 내역이 없습니다.</div>}
      {items.map((item) => {
        const st = APPROVAL_STATUS[item.status] ?? { label: item.status, color: "text-gray-500 bg-gray-50" };
        return (
          <div key={item.id} className="px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-sm">
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-gray-900">{item.date?.slice(0, 10)} · 휴일근무</div>
                <div className="text-xs text-gray-400 truncate">{item.reason}</div>
              </div>
              {item._docId ? (
                <>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.color}`}>{st.label}</span>
                  <button onClick={() => router.push(`/approval/${item._docId}`)} className="text-xs text-blue-500 hover:text-blue-700">보기</button>
                </>
              ) : (
                <button onClick={() => del(item.id)} className="text-xs text-red-500 hover:text-red-700">삭제</button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── AttendanceView (exported) ────────────────────────────────────────────────

export default function AttendanceView() {
  const router = useRouter();
  const [today, setToday] = useState<TodayRecord | null>(null);
  const [balance, setBalance] = useState<LeaveBalance | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [activeTab, setActiveTab] = useState<"leave" | "ot">("leave");

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const loadToday = useCallback(async () => {
    try { setToday(await attendanceApi.getToday()); } catch {}
  }, []);

  const loadBalance = useCallback(async () => {
    try { setBalance(await leaveApi.getBalance()); } catch {}
  }, []);

  useEffect(() => { loadToday(); loadBalance(); }, []);

  useEffect(() => {
    const handler = () => { loadToday(); loadBalance(); setRefresh((r) => r + 1); };
    window.addEventListener("attendance-updated", handler);
    return () => window.removeEventListener("attendance-updated", handler);
  }, [loadToday, loadBalance]);

  const navigateMonth = (dir: -1 | 1) => {
    let m = month + dir, y = year;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    setYear(y); setMonth(m);
  };

  const handleAction = () => { loadToday(); setRefresh((r) => r + 1); };

  return (
    <div className="space-y-6">
      {/* 중간 릴리즈(2026-06-29): 전자결재 미사용 → 휴가/휴일근무는 캘린더 날짜별 "+" 버튼(근태 추가)에서 직접 등록 */}

      {/* 연차 현황 — 상단 슬림 바(한 줄) */}
      <LeaveBalanceCard balance={balance} />

      <CheckInWidget today={today} onAction={handleAction} />

      {/* 월간 달력 (근태 통합) */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-900">월간 근태 현황</h2>
            <button onClick={() => router.push("/resources?tab=attendance")}
              className="text-xs px-2 py-0.5 rounded border border-blue-200 text-blue-600 hover:bg-blue-50 transition-colors">
              전사근태 →
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => navigateMonth(-1)} className="p-1 text-gray-400 hover:text-gray-700 border border-gray-200 rounded">‹</button>
            <span className="text-sm font-medium text-gray-700">{year}년 {month}월</span>
            <button onClick={() => navigateMonth(1)} className="p-1 text-gray-400 hover:text-gray-700 border border-gray-200 rounded">›</button>
          </div>
        </div>
        <MonthlyCalendar year={year} month={month} refresh={refresh} onEntryChanged={() => { setRefresh((r) => r + 1); loadBalance(); }} />
        <p className="text-[10px] text-gray-400 mt-1.5 ml-1">날짜를 클릭하여 근태를 추가할 수 있습니다</p>
      </div>

      {/* 휴가 / 휴일근무 내역 */}
      <div>
        <div className="flex items-center gap-1 mb-3">
          <button onClick={() => setActiveTab("leave")}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === "leave" ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"}`}>
            휴가 내역
          </button>
          <button onClick={() => setActiveTab("ot")}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === "ot" ? "bg-purple-600 text-white" : "text-gray-600 hover:bg-gray-100"}`}>
            휴일근무 내역
          </button>
        </div>
        {activeTab === "leave" ? <LeaveHistory refresh={refresh} /> : <HolidayWorkHistory refresh={refresh} />}
      </div>
    </div>
  );
}
