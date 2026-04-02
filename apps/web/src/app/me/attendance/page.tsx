"use client";

import { useState, useCallback, useEffect } from "react";
import { attendanceApi, leaveApi, overtimeApi, approvalLineApi, userManagementApi } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TodayRecord {
  id: string;
  date: string;
  checkState: "NOT_STARTED" | "CHECKED_IN" | "ON_BREAK" | "CHECKED_OUT";
  checkInTime: string | null;
  checkOutTime: string | null;
  workType: string;
  isLate: boolean;
  netWorkMinutes: number;
  note: string | null;
}

interface CalendarDay {
  date: string;
  status: string;
  checkInTime: string | null;
  checkOutTime: string | null;
  netWorkMinutes: number;
  isLate: boolean;
  leaveType: string | null;
  otHours: number;
  isHoliday: boolean;
  holidayName: string | null;
  isWeekend: boolean;
}

interface LeaveBalance {
  totalDays: number;
  usedDays: number;
  pendingDays: number;
  remainingDays: number;
}

function fmtTime(iso: string | null) {
  if (!iso) return "--:--";
  return new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

function fmtMinutes(mins: number) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}분`;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}

// ─── CheckIn Widget ────────────────────────────────────────────────────────────

function CheckInWidget({ today, onAction }: { today: TodayRecord | null; onAction: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doAction = async (action: () => Promise<any>) => {
    setLoading(true);
    setError(null);
    try {
      await action();
      onAction();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  if (!today) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between">
        <div className="text-sm text-gray-400">출퇴근 상태를 불러오는 중...</div>
      </div>
    );
  }

  const state = today.checkState;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${
            state === "CHECKED_IN" ? "bg-green-500 animate-pulse" :
            state === "ON_BREAK" ? "bg-orange-500 animate-pulse" :
            state === "CHECKED_OUT" ? "bg-gray-400" : "bg-gray-200"
          }`} />
          <span className="text-sm font-semibold text-gray-900">
            {state === "NOT_STARTED" ? "출근 전" :
             state === "CHECKED_IN" ? "근무 중" :
             state === "ON_BREAK" ? "외출 중" : "퇴근 완료"}
          </span>
          {today.isLate && state !== "NOT_STARTED" && (
            <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">지각</span>
          )}
        </div>
        <div className="text-sm text-gray-500">
          {today.date}
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs text-gray-500 mb-3">
        <span>출근: <strong className="text-gray-800">{fmtTime(today.checkInTime)}</strong></span>
        <span>퇴근: <strong className="text-gray-800">{fmtTime(today.checkOutTime)}</strong></span>
        {today.netWorkMinutes > 0 && (
          <span>근무: <strong className="text-blue-600">{fmtMinutes(today.netWorkMinutes)}</strong></span>
        )}
      </div>

      {error && <div className="text-xs text-red-500 mb-2">{error}</div>}

      <div className="flex gap-2">
        {state === "NOT_STARTED" && (
          <button
            onClick={() => doAction(() => attendanceApi.checkIn({ workType: "OFFICE" }))}
            disabled={loading}
            className="flex-1 bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-green-700 disabled:opacity-50"
          >
            출근
          </button>
        )}
        {state === "CHECKED_IN" && (
          <>
            <button
              onClick={() => doAction(() => attendanceApi.breakOut())}
              disabled={loading}
              className="flex-1 bg-orange-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-orange-600 disabled:opacity-50"
            >
              외출
            </button>
            <button
              onClick={() => doAction(() => attendanceApi.checkOut())}
              disabled={loading}
              className="flex-1 bg-gray-700 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-gray-800 disabled:opacity-50"
            >
              퇴근
            </button>
          </>
        )}
        {state === "ON_BREAK" && (
          <button
            onClick={() => doAction(() => attendanceApi.breakIn())}
            disabled={loading}
            className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
          >
            복귀
          </button>
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

// ─── Monthly Calendar ─────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, { icon: string; color: string }> = {
  NORMAL:  { icon: "✓", color: "text-green-600" },
  LATE:    { icon: "✓", color: "text-orange-500" },
  ABSENT:  { icon: "✗", color: "text-red-500" },
  LEAVE:   { icon: "휴", color: "text-blue-600" },
  HOLIDAY: { icon: "•", color: "text-gray-400" },
};

function MonthlyCalendar({
  year,
  month,
}: {
  year: number;
  month: number;
}) {
  const [days, setDays] = useState<CalendarDay[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      attendanceApi.getCalendar(year, month),
      attendanceApi.getSummary(year, month),
    ]).then(([cal, sum]) => {
      if (!cancelled) {
        setDays(cal.days ?? []);
        setSummary(sum);
        setLoading(false);
      }
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [year, month]);

  if (loading) return <div className="text-sm text-gray-400 py-6 text-center">불러오는 중...</div>;

  // Build grid: find weekday of first day
  const firstDay = new Date(year, month - 1, 1).getDay();
  const cells: (CalendarDay | null)[] = [...Array(firstDay).fill(null), ...days];
  while (cells.length % 7 !== 0) cells.push(null);

  const DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      {/* Summary bar */}
      {summary && (
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex flex-wrap gap-4 text-xs text-gray-600">
          <span>출근 <strong className="text-gray-900">{summary.normalCount ?? 0}일</strong></span>
          <span>지각 <strong className="text-orange-600">{summary.lateCount ?? 0}일</strong></span>
          <span>결근 <strong className="text-red-600">{summary.absentCount ?? 0}일</strong></span>
          <span>휴가 <strong className="text-blue-600">{summary.leaveCount ?? 0}일</strong></span>
          <span>총 근무 <strong className="text-blue-700">{fmtMinutes(summary.totalWorkMinutes ?? 0)}</strong></span>
          <span>OT <strong className="text-purple-600">{(summary.totalOtHours ?? 0).toFixed(1)}h</strong></span>
        </div>
      )}

      {/* Calendar grid */}
      <div className="p-3">
        <div className="grid grid-cols-7 mb-1">
          {DAY_LABELS.map((d, i) => (
            <div key={d} className={`text-center text-xs font-semibold py-1 ${i === 0 ? "text-red-500" : i === 6 ? "text-blue-500" : "text-gray-500"}`}>
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {cells.map((cell, idx) => {
            if (!cell) return <div key={`empty-${idx}`} className="h-14 rounded-lg" />;
            const dayNum = parseInt(cell.date.slice(8));
            const isToday = cell.date === today;
            const dow = new Date(cell.date).getDay();
            const meta = STATUS_LABELS[cell.status] ?? { icon: "", color: "text-gray-400" };

            return (
              <div
                key={cell.date}
                className={`h-14 rounded-lg p-1.5 flex flex-col ${
                  isToday ? "bg-blue-50 ring-1 ring-blue-300" :
                  cell.isHoliday || cell.isWeekend ? "bg-gray-50" : "hover:bg-gray-50"
                }`}
              >
                <span className={`text-xs font-medium ${
                  isToday ? "text-blue-700 font-bold" :
                  dow === 0 || cell.isHoliday ? "text-red-500" :
                  dow === 6 ? "text-blue-500" : "text-gray-700"
                }`}>
                  {dayNum}
                </span>
                {cell.isHoliday && (
                  <span className="text-[10px] text-red-400 truncate">{cell.holidayName}</span>
                )}
                {!cell.isHoliday && cell.status && cell.status !== "HOLIDAY" && (
                  <span className={`text-xs font-bold ${meta.color}`}>{meta.icon}</span>
                )}
                {cell.isLate && (
                  <span className="text-[10px] text-orange-500">지각</span>
                )}
                {cell.otHours > 0 && (
                  <span className="text-[10px] text-purple-500 mt-auto">OT {cell.otHours}h</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Leave Balance Card ────────────────────────────────────────────────────────

function LeaveBalanceCard({ balance }: { balance: LeaveBalance | null }) {
  if (!balance) return null;
  const pct = balance.totalDays > 0 ? Math.round((balance.usedDays / balance.totalDays) * 100) : 0;
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900">연차 현황</h3>
        <span className="text-xs text-gray-400">{new Date().getFullYear()}년</span>
      </div>
      <div className="flex items-end gap-1 mb-2">
        <span className="text-2xl font-bold text-blue-600">{balance.remainingDays}</span>
        <span className="text-sm text-gray-500 mb-0.5">일 잔여</span>
        <span className="text-xs text-gray-400 mb-0.5 ml-1">/ {balance.totalDays}일</span>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-2 mb-2">
        <div className="bg-blue-500 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex justify-between text-xs text-gray-500">
        <span>사용: {balance.usedDays}일</span>
        {balance.pendingDays > 0 && <span className="text-amber-600">대기: {balance.pendingDays}일</span>}
      </div>
    </div>
  );
}

// ─── Leave Request Form ────────────────────────────────────────────────────────

const LEAVE_TYPES = [
  { value: "ANNUAL", label: "연차" },
  { value: "SICK", label: "병가" },
  { value: "HALF_AM", label: "반차(오전)" },
  { value: "HALF_PM", label: "반차(오후)" },
  { value: "SPECIAL", label: "특별휴가" },
];

function LeaveRequestForm({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ type: "ANNUAL", startDate: "", endDate: "", reason: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approverId, setApproverId] = useState<string>("");
  const [members, setMembers] = useState<{ id: string; name: string }[]>([]);
  const [loadingApprover, setLoadingApprover] = useState(false);

  const openForm = async () => {
    setOpen(true);
    setLoadingApprover(true);
    try {
      const [info, list] = await Promise.all([
        approvalLineApi.getMe().catch(() => null),
        userManagementApi.members().catch(() => []),
      ]);
      setMembers(list);
      setApproverId(info?.approverId ?? "");
    } finally {
      setLoadingApprover(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await leaveApi.create({ ...form, ...(approverId ? { approverId } : {}) });
      setOpen(false);
      setForm({ type: "ANNUAL", startDate: "", endDate: "", reason: "" });
      onSuccess();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        onClick={openForm}
        className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
      >
        + 휴가 신청
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">휴가 신청</h3>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            <form onSubmit={submit} className="space-y-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">1차 결재자</label>
                {loadingApprover ? (
                  <div className="px-3 py-2 border border-gray-200 rounded-lg text-xs text-gray-400">불러오는 중...</div>
                ) : (
                  <select
                    value={approverId}
                    onChange={(e) => setApproverId(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">— 결재자 선택 —</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">휴가 유형</label>
                <select
                  value={form.type}
                  onChange={(e) => setForm((p) => ({ ...p, type: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {LEAVE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">시작일</label>
                  <input type="date" value={form.startDate} required
                    onChange={(e) => setForm((p) => ({ ...p, startDate: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">종료일</label>
                  <input type="date" value={form.endDate} required
                    onChange={(e) => setForm((p) => ({ ...p, endDate: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">사유</label>
                <input type="text" value={form.reason} required
                  onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              {error && <p className="text-xs text-red-500">{error}</p>}
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setOpen(false)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">취소</button>
                <button type="submit" disabled={saving}
                  className="flex-1 bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
                  {saving ? "신청 중..." : "신청"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

// ─── OT Request Form ──────────────────────────────────────────────────────────

function OvertimeRequestForm({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ date: "", plannedHours: "2", reason: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approverId, setApproverId] = useState<string>("");
  const [members, setMembers] = useState<{ id: string; name: string }[]>([]);
  const [loadingApprover, setLoadingApprover] = useState(false);

  const openForm = async () => {
    setOpen(true);
    setLoadingApprover(true);
    try {
      const [info, list] = await Promise.all([
        approvalLineApi.getMe().catch(() => null),
        userManagementApi.members().catch(() => []),
      ]);
      setMembers(list);
      setApproverId(info?.approverId ?? "");
    } finally {
      setLoadingApprover(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await overtimeApi.create({ ...form, plannedHours: parseFloat(form.plannedHours), ...(approverId ? { approverId } : {}) });
      setOpen(false);
      setForm({ date: "", plannedHours: "2", reason: "" });
      onSuccess();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        onClick={openForm}
        className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700"
      >
        + OT 신청
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">OT 신청</h3>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            <form onSubmit={submit} className="space-y-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">1차 결재자</label>
                {loadingApprover ? (
                  <div className="px-3 py-2 border border-gray-200 rounded-lg text-xs text-gray-400">불러오는 중...</div>
                ) : (
                  <select
                    value={approverId}
                    onChange={(e) => setApproverId(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="">— 결재자 선택 —</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">날짜</label>
                <input type="date" value={form.date} required
                  onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">예정 시간 (h)</label>
                <input type="number" min="0.5" max="12" step="0.5" value={form.plannedHours} required
                  onChange={(e) => setForm((p) => ({ ...p, plannedHours: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">사유</label>
                <input type="text" value={form.reason} required
                  onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
              </div>
              {error && <p className="text-xs text-red-500">{error}</p>}
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setOpen(false)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">취소</button>
                <button type="submit" disabled={saving}
                  className="flex-1 bg-purple-600 text-white px-3 py-2 rounded-lg text-sm font-semibold hover:bg-purple-700 disabled:opacity-50">
                  {saving ? "신청 중..." : "신청"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Leave History ─────────────────────────────────────────────────────────────

const APPROVAL_STATUS: Record<string, { label: string; color: string }> = {
  PENDING:  { label: "대기",  color: "text-amber-600 bg-amber-50" },
  APPROVED: { label: "승인",  color: "text-green-600 bg-green-50" },
  REJECTED: { label: "반려",  color: "text-red-600 bg-red-50" },
  CANCELLED:{ label: "취소",  color: "text-gray-500 bg-gray-50" },
};

function LeaveHistory({ refresh }: { refresh: number }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    leaveApi.list().then(setItems).catch(() => {}).finally(() => setLoading(false));
  }, [refresh]);

  const cancel = async (id: string) => {
    await leaveApi.cancel(id);
    setItems((prev) => prev.map((i) => i.id === id ? { ...i, status: "CANCELLED" } : i));
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
              <div className="font-medium text-gray-900">{LEAVE_TYPES.find((t) => t.value === item.type)?.label ?? item.type}</div>
              <div className="text-xs text-gray-400">{item.startDate?.slice(0, 10)} ~ {item.endDate?.slice(0, 10)}</div>
            </div>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.color}`}>{st.label}</span>
            {item.status === "PENDING" && (
              <button onClick={() => cancel(item.id)} className="text-xs text-gray-400 hover:text-red-500">취소</button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── OT History ───────────────────────────────────────────────────────────────

function OvertimeHistory({ refresh }: { refresh: number }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [actualHours, setActualHours] = useState("2");

  useEffect(() => {
    setLoading(true);
    overtimeApi.list().then(setItems).catch(() => {}).finally(() => setLoading(false));
  }, [refresh]);

  const cancel = async (id: string) => {
    await overtimeApi.cancel(id);
    setItems((prev) => prev.map((i) => i.id === id ? { ...i, status: "CANCELLED" } : i));
  };

  const complete = async (id: string) => {
    await overtimeApi.complete(id, parseFloat(actualHours));
    setItems((prev) => prev.map((i) => i.id === id ? { ...i, status: "DONE", actualHours: parseFloat(actualHours) } : i));
    setCompletingId(null);
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
                <div className="font-medium text-gray-900">{item.date?.slice(0, 10)} · {item.plannedHours}h 예정</div>
                <div className="text-xs text-gray-400 truncate">{item.reason}</div>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.color}`}>{st.label}</span>
              {item.status === "APPROVED" && (
                <button onClick={() => setCompletingId(item.id)} className="text-xs text-purple-600 hover:underline">실적 입력</button>
              )}
              {item.status === "PENDING" && (
                <button onClick={() => cancel(item.id)} className="text-xs text-gray-400 hover:text-red-500">취소</button>
              )}
            </div>
            {completingId === item.id && (
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="number" min="0.5" max="12" step="0.5" value={actualHours}
                  onChange={(e) => setActualHours(e.target.value)}
                  className="w-20 px-2 py-1 border border-gray-300 rounded text-xs"
                />
                <span className="text-xs text-gray-500">시간</span>
                <button onClick={() => complete(item.id)} className="text-xs bg-purple-600 text-white px-2 py-1 rounded hover:bg-purple-700">저장</button>
                <button onClick={() => setCompletingId(null)} className="text-xs text-gray-400 hover:text-gray-600">취소</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AttendancePage() {
  const [today, setToday] = useState<TodayRecord | null>(null);
  const [balance, setBalance] = useState<LeaveBalance | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [activeTab, setActiveTab] = useState<"leave" | "ot">("leave");

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const loadToday = useCallback(async () => {
    try {
      const res = await attendanceApi.getToday();
      setToday(res);
    } catch {}
  }, []);

  const loadBalance = useCallback(async () => {
    try {
      const res = await leaveApi.getBalance();
      setBalance(res);
    } catch {}
  }, []);

  useEffect(() => {
    loadToday();
    loadBalance();
  }, []);

  const navigateMonth = (dir: -1 | 1) => {
    let m = month + dir;
    let y = year;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    setYear(y);
    setMonth(m);
  };

  const handleAction = () => {
    loadToday();
    setRefresh((r) => r + 1);
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">내 근태</h1>
        <div className="flex items-center gap-2">
          <LeaveRequestForm onSuccess={() => { setRefresh((r) => r + 1); loadBalance(); }} />
          <OvertimeRequestForm onSuccess={() => setRefresh((r) => r + 1)} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* CheckIn widget */}
        <div className="md:col-span-2">
          <CheckInWidget today={today} onAction={handleAction} />
        </div>
        {/* Leave balance */}
        <LeaveBalanceCard balance={balance} />
      </div>

      {/* Calendar */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-900">월간 근태 현황</h2>
          <div className="flex items-center gap-2">
            <button onClick={() => navigateMonth(-1)} className="p-1 text-gray-400 hover:text-gray-700 border border-gray-200 rounded">‹</button>
            <span className="text-sm font-medium text-gray-700">{year}년 {month}월</span>
            <button onClick={() => navigateMonth(1)} className="p-1 text-gray-400 hover:text-gray-700 border border-gray-200 rounded">›</button>
          </div>
        </div>
        <MonthlyCalendar year={year} month={month} />
      </div>

      {/* Leave & OT history tabs */}
      <div>
        <div className="flex items-center gap-1 mb-3">
          <button
            onClick={() => setActiveTab("leave")}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === "leave" ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"}`}
          >
            휴가 내역
          </button>
          <button
            onClick={() => setActiveTab("ot")}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === "ot" ? "bg-purple-600 text-white" : "text-gray-600 hover:bg-gray-100"}`}
          >
            OT 내역
          </button>
        </div>
        {activeTab === "leave" ? (
          <LeaveHistory refresh={refresh} />
        ) : (
          <OvertimeHistory refresh={refresh} />
        )}
      </div>
    </div>
  );
}
