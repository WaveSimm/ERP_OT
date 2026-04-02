"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { meApi, attendanceApi, leaveApi, myTasksApi, taskApi } from "@/lib/api";
import TaskDrawer from "@/components/TaskDrawer";

// ─── Types ────────────────────────────────────────────────────────────────────

interface KanbanCard {
  segmentId: string;
  segmentName: string;
  taskId: string;
  taskName: string;
  projectId: string;
  projectName: string;
  startDate: string;
  endDate: string;
  daysUntilEnd: number;
  progressPercent: number;
  myAllocationPercent: number;
  myAllocationMode: string;
  isCriticalPath: boolean;
  staleDays: number;
  lastUpdatedAt: string;
}

interface KanbanData {
  date: string;
  columns: {
    UPCOMING: KanbanCard[];
    IN_PROGRESS: KanbanCard[];
    DUE_SOON: KanbanCard[];
    DONE: KanbanCard[];
  };
  staleCount: number;
  totalAssigned: number;
}

// ─── Kanban hooks ─────────────────────────────────────────────────────────────

function useKanban() {
  const [data, setData] = useState<KanbanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await meApi.getKanban());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const updateProgress = useCallback(async (segmentId: string, progressPercent: number, changeReason?: string) => {
    setData((prev) => {
      if (!prev) return prev;
      const cols = { ...prev.columns };
      for (const col of Object.keys(cols) as (keyof typeof cols)[]) {
        cols[col] = cols[col].map((c) =>
          c.segmentId === segmentId ? { ...c, progressPercent } : c,
        );
      }
      if (progressPercent >= 100) {
        let card: KanbanCard | undefined;
        for (const col of ["DUE_SOON", "IN_PROGRESS", "UPCOMING"] as const) {
          const idx = cols[col].findIndex((c) => c.segmentId === segmentId);
          if (idx !== -1) { [card] = cols[col].splice(idx, 1); break; }
        }
        if (card) cols.DONE = [{ ...card, progressPercent: 100 }, ...cols.DONE];
      }
      return { ...prev, columns: cols };
    });
    try {
      await meApi.updateSegmentProgress(segmentId, { progressPercent, changeReason });
    } catch { load(); }
  }, [load]);

  return { data, loading, error, load, updateProgress };
}

// ─── Kanban components ────────────────────────────────────────────────────────

function StaleBanner({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 flex items-center gap-2 text-sm">
      <span className="text-amber-600 font-medium">⚠ {count}개 세그먼트</span>
      <span className="text-amber-700">진행률이 3일 이상 업데이트되지 않았습니다.</span>
    </div>
  );
}

function ProgressUpdateModal({ card, onClose, onSave }: {
  card: KanbanCard;
  onClose: () => void;
  onSave: (value: number, reason: string) => Promise<void>;
}) {
  const [value, setValue] = useState(card.progressPercent);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await onSave(value, reason);
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900 text-sm">진행률 업데이트</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="mb-1 text-xs text-gray-500">{card.projectName} / {card.segmentName}</div>
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-600">진행률</span>
            <span className="text-sm font-bold text-blue-600">{value}%</span>
          </div>
          <input type="range" min={0} max={100} step={5} value={value}
            onChange={(e) => setValue(Number(e.target.value))} className="w-full accent-blue-600" />
          <div className="w-full bg-gray-100 rounded-full h-2 mt-2">
            <div className="bg-blue-500 h-2 rounded-full transition-all" style={{ width: `${value}%` }} />
          </div>
        </div>
        <div className="mb-4">
          <label className="block text-xs text-gray-600 mb-1">변경 사유 (선택)</label>
          <input type="text" value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="예: 배관 1구간 완료"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">취소</button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

const COLUMN_META = {
  DUE_SOON:    { label: "마감 임박", color: "text-red-600",   bg: "bg-red-50",   border: "border-red-200",   dot: "bg-red-500" },
  IN_PROGRESS: { label: "진행 중",   color: "text-blue-600",  bg: "bg-blue-50",  border: "border-blue-200",  dot: "bg-blue-500" },
  UPCOMING:    { label: "예정",       color: "text-gray-600",  bg: "bg-gray-50",  border: "border-gray-200",  dot: "bg-gray-400" },
  DONE:        { label: "완료",       color: "text-green-600", bg: "bg-green-50", border: "border-green-200", dot: "bg-green-500" },
};

function KanbanCardItem({ card, onUpdate }: { card: KanbanCard; onUpdate: (card: KanbanCard) => void }) {
  const router = useRouter();
  const isStale = card.staleDays >= 3;
  const dueSoon = card.daysUntilEnd <= 3 && card.daysUntilEnd >= 0;

  return (
    <div className={`bg-white rounded-lg border shadow-sm p-3 space-y-2 ${isStale ? "border-amber-300" : "border-gray-200"}`}>
      <div className="flex items-start gap-1.5">
        {card.isCriticalPath && <span className="shrink-0 text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-medium">CPM</span>}
        <button className="text-xs text-gray-500 hover:text-blue-600 text-left truncate flex-1 min-w-0"
          onClick={() => router.push(`/projects/${card.projectId}`)} title={card.projectName}>
          {card.projectName}
        </button>
      </div>
      <div className="font-semibold text-sm text-gray-900 truncate">{card.segmentName}</div>
      <div className="text-xs text-gray-400 truncate">{card.taskName}</div>
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>{card.startDate.slice(5)} ~ {card.endDate.slice(5)}</span>
        <span className={`font-medium ${dueSoon ? "text-red-600" : "text-gray-600"}`}>
          {card.daysUntilEnd < 0 ? `D+${Math.abs(card.daysUntilEnd)}` : card.daysUntilEnd === 0 ? "D-Day" : `D-${card.daysUntilEnd}`}
        </span>
      </div>
      <div>
        <div className="flex items-center justify-between mb-1">
          <div className="w-full bg-gray-100 rounded-full h-1.5 mr-2">
            <div className="bg-blue-500 h-1.5 rounded-full transition-all" style={{ width: `${card.progressPercent}%` }} />
          </div>
          <span className="text-xs font-medium text-gray-700 shrink-0">{card.progressPercent}%</span>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-gray-400 flex-1">
          나: {card.myAllocationMode === "PERCENT" ? `${card.myAllocationPercent}%` : `${card.myAllocationPercent}h/일`}
        </span>
        {card.progressPercent < 100 && (
          <button onClick={() => onUpdate(card)}
            className="text-xs bg-blue-50 text-blue-600 hover:bg-blue-100 px-2 py-1 rounded font-medium">업데이트</button>
        )}
        {isStale && (
          <span className="text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">{card.staleDays}일</span>
        )}
      </div>
    </div>
  );
}

function KanbanColumn({ colKey, cards, onUpdate }: {
  colKey: keyof typeof COLUMN_META;
  cards: KanbanCard[];
  onUpdate: (card: KanbanCard) => void;
}) {
  const meta = COLUMN_META[colKey];
  return (
    <div className={`flex flex-col rounded-xl border ${meta.border} ${meta.bg} min-w-[260px] flex-1`}>
      <div className="px-4 py-3 flex items-center gap-2 border-b border-inherit">
        <div className={`w-2 h-2 rounded-full ${meta.dot}`} />
        <span className={`text-sm font-semibold ${meta.color}`}>{meta.label}</span>
        <span className="ml-auto text-xs text-gray-400 bg-white rounded-full px-2 py-0.5 border border-gray-200">{cards.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2 max-h-[calc(100vh-240px)]">
        {cards.length === 0
          ? <div className="text-xs text-gray-400 text-center py-6">없음</div>
          : cards.map((c) => <KanbanCardItem key={c.segmentId} card={c} onUpdate={onUpdate} />)
        }
      </div>
    </div>
  );
}

// ─── Attendance Summary Bar ───────────────────────────────────────────────────

const CHECK_STATE_LABEL: Record<string, string> = {
  NOT_STARTED: "미출근",
  CHECKED_IN: "근무 중",
  ON_BREAK: "외출 중",
  CHECKED_OUT: "퇴근",
};

const CHECK_STATE_COLOR: Record<string, string> = {
  NOT_STARTED: "bg-gray-100 text-gray-600",
  CHECKED_IN: "bg-green-100 text-green-700",
  ON_BREAK: "bg-orange-100 text-orange-700",
  CHECKED_OUT: "bg-blue-100 text-blue-700",
};

function fmtMin(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function AttendanceSummaryBar() {
  const router = useRouter();
  const [today, setToday] = useState<any>(null);
  const [balance, setBalance] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [t, b] = await Promise.all([
        attendanceApi.getToday().catch(() => null),
        leaveApi.getBalance().catch(() => null),
      ]);
      setToday(t);
      setBalance(b);
    } catch {}
  }, []);

  useEffect(() => { load(); }, []);

  const handleCheckIn = async () => {
    setSaving(true);
    try { await attendanceApi.checkIn({ workType: "OFFICE" }); await load(); }
    catch {} finally { setSaving(false); }
  };
  const handleCheckOut = async () => {
    setSaving(true);
    try { await attendanceApi.checkOut(); await load(); }
    catch {} finally { setSaving(false); }
  };
  const handleBreakOut = async () => {
    setSaving(true);
    try { await attendanceApi.breakOut(); await load(); }
    catch {} finally { setSaving(false); }
  };
  const handleBreakIn = async () => {
    setSaving(true);
    try { await attendanceApi.breakIn(); await load(); }
    catch {} finally { setSaving(false); }
  };

  const checkState: string = today?.checkState ?? "NOT_STARTED";
  const remainingLeave = balance
    ? Math.max(0, (balance.totalDays ?? 0) + (balance.adjustedDays ?? 0) - (balance.usedDays ?? 0) - (balance.pendingDays ?? 0))
    : null;

  return (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-4 flex-wrap">
      {/* 상태 배지 */}
      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${CHECK_STATE_COLOR[checkState] ?? "bg-gray-100 text-gray-600"}`}>
        {CHECK_STATE_LABEL[checkState] ?? checkState}
      </span>

      {/* 출퇴근 시각 */}
      {today?.checkIn && (
        <span className="text-xs text-gray-500">
          출근 {today.checkIn.slice(11, 16)}
          {today.checkOut && ` · 퇴근 ${today.checkOut.slice(11, 16)}`}
        </span>
      )}

      {/* 실근무시간 */}
      {today?.netWorkMinutes > 0 && (
        <span className="text-xs text-gray-600">
          근무 <span className="font-medium text-gray-800">{fmtMin(today.netWorkMinutes)}</span>
        </span>
      )}

      {/* 액션 버튼 */}
      <div className="flex items-center gap-1.5">
        {checkState === "NOT_STARTED" && (
          <button onClick={handleCheckIn} disabled={saving}
            className="px-2.5 py-1 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
            출근
          </button>
        )}
        {checkState === "CHECKED_IN" && (
          <>
            <button onClick={handleBreakOut} disabled={saving}
              className="px-2.5 py-1 text-xs font-medium bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50">
              외출
            </button>
            <button onClick={handleCheckOut} disabled={saving}
              className="px-2.5 py-1 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
              퇴근
            </button>
          </>
        )}
        {checkState === "ON_BREAK" && (
          <button onClick={handleBreakIn} disabled={saving}
            className="px-2.5 py-1 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
            복귀
          </button>
        )}
      </div>

      {/* 연차 잔여 */}
      {remainingLeave !== null && (
        <div className="ml-auto flex items-center gap-1 text-xs text-gray-500">
          잔여 연차
          <span className={`font-semibold ${remainingLeave <= 3 ? "text-orange-600" : "text-gray-800"}`}>
            {remainingLeave}일
          </span>
        </div>
      )}

      {/* 근태 페이지 링크 */}
      <button onClick={() => router.push("/me/attendance")}
        className="text-xs text-blue-600 hover:underline shrink-0">
        근태 관리 →
      </button>
    </div>
  );
}

// ─── Week Calendar ────────────────────────────────────────────────────────────

function WeekCalendarView() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(() => new Date().toISOString().slice(0, 10));

  const load = useCallback(async (date: string) => {
    setLoading(true);
    try { setData(await meApi.getWeekCalendar(date)); } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(currentDate); }, []);

  const navigate = (dir: -1 | 1) => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() + dir * 7);
    const next = d.toISOString().slice(0, 10);
    setCurrentDate(next);
    load(next);
  };

  const DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
  if (loading) return <div className="text-sm text-gray-400 py-8 text-center">불러오는 중...</div>;
  if (!data) return null;

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between border-b border-gray-200">
        <button onClick={() => navigate(-1)} className="p-1 text-gray-400 hover:text-gray-700">‹</button>
        <span className="text-sm font-semibold text-gray-900">{data.weekStart} ~ {data.weekEnd}</span>
        <button onClick={() => navigate(1)} className="p-1 text-gray-400 hover:text-gray-700">›</button>
      </div>
      <div className="grid grid-cols-7 divide-x divide-gray-100">
        {data.days.map((day: any) => (
          <div key={day.date} className={`min-h-[120px] p-2 ${day.isToday ? "bg-blue-50" : ""} ${day.dayOfWeek === 0 || day.dayOfWeek === 6 ? "bg-gray-50" : ""}`}>
            <div className={`text-xs font-semibold mb-2 ${day.isToday ? "text-blue-600" : day.dayOfWeek === 0 ? "text-red-500" : day.dayOfWeek === 6 ? "text-blue-500" : "text-gray-600"}`}>
              {DAY_LABELS[day.dayOfWeek]} {day.date.slice(8)}
            </div>
            <div className="space-y-1">
              {day.segments.map((seg: any) => (
                <div key={`${seg.segmentId}-${day.date}`}
                  className={`text-xs px-1.5 py-0.5 rounded truncate ${seg.isCriticalPath ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700"}`}
                  title={`${seg.projectName} / ${seg.segmentName}`}>
                  {seg.segmentName}
                </div>
              ))}
              {day.segments.length === 0 && <div className="text-xs text-gray-300">-</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── My Tasks (내 작업) ─────────────────────────────────────────────────────────

// EditCell — module-level to avoid unmount on every render
function EditCell({ editKey, display, inputType = "text", width = "w-full", align = "center",
  editCell, setEditCell, saving, onCommit }: {
  editKey: string; display: string; inputType?: string; width?: string; align?: string;
  editCell: { key: string; value: string } | null;
  setEditCell: (v: { key: string; value: string } | null) => void;
  saving: Set<string>;
  onCommit: (key: string, value: string) => void;
}) {
  const isEditing = editCell?.key === editKey;
  const isSaving = saving.has(editKey);
  if (isEditing) {
    return (
      <input autoFocus type={inputType} value={editCell!.value}
        min={inputType === "date" ? "2000-01-01" : undefined}
        max={inputType === "date" ? "2099-12-31" : undefined}
        onChange={(e) => setEditCell({ key: editKey, value: e.target.value })}
        onBlur={() => onCommit(editKey, editCell!.value)}
        onFocus={(e) => (e.target as HTMLInputElement).select()}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); onCommit(editKey, editCell!.value); }
          if (e.key === "Escape") setEditCell(null);
        }}
        onClick={(e) => e.stopPropagation()}
        className={`border border-blue-400 rounded px-1 py-0 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 ${width} text-${align} [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
      />
    );
  }
  return (
    <span onClick={(e) => { e.stopPropagation(); if (!isSaving) setEditCell({ key: editKey, value: display.replace(/%|h$/g, "") }); }}
      className={`text-xs cursor-pointer rounded px-1 py-0.5 hover:bg-blue-50 hover:ring-1 hover:ring-blue-200 transition-colors select-none ${isSaving ? "opacity-40" : "text-gray-700"} text-${align}`}>
      {isSaving ? "…" : (display || "—")}
    </span>
  );
}

const STATUS_COLOR: Record<string, string> = {
  TODO: "bg-gray-100 text-gray-600", IN_PROGRESS: "bg-blue-100 text-blue-700",
  ON_HOLD: "bg-yellow-100 text-yellow-700", DONE: "bg-green-100 text-green-700", BLOCKED: "bg-red-100 text-red-600",
};
const STATUS_LABEL: Record<string, string> = {
  TODO: "예정", IN_PROGRESS: "진행중", ON_HOLD: "보류", DONE: "완료", BLOCKED: "차단",
};
const PROJECT_STATUS_LABEL: Record<string, string> = {
  PLANNING: "계획", IN_PROGRESS: "진행중", ON_HOLD: "보류", COMPLETED: "완료", CANCELLED: "취소",
};
type FilterStatus = "ALL" | "TODO" | "IN_PROGRESS" | "ON_HOLD" | "DONE" | "BLOCKED";

function MyTasksView() {
  const router = useRouter();
  const [groups, setGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [editCell, setEditCell] = useState<{ key: string; value: string } | null>(null);
  const [statusEditId, setStatusEditId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [projectOrder, setProjectOrder] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("myTasks_projectOrder") ?? "[]"); } catch { return []; }
  });
  const [dragProjectId, setDragProjectId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<{ id: string; pos: "before" | "after" } | null>(null);

  const load = async () => {
    setLoading(true); setError("");
    try { setGroups(await myTasksApi.list()); }
    catch (e: any) { setError(e.message ?? "데이터를 불러올 수 없습니다."); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const filteredGroups = useMemo(() => {
    const filtered = groups.map((g) => ({
      ...g,
      tasks: g.tasks.filter((t: any) => {
        const matchStatus = filterStatus === "ALL" || t.taskStatus === filterStatus;
        const matchSearch = !searchQuery ||
          t.taskName.toLowerCase().includes(searchQuery.toLowerCase()) ||
          g.project.name.toLowerCase().includes(searchQuery.toLowerCase());
        return matchStatus && matchSearch;
      }),
    })).filter((g) => g.tasks.length > 0);
    if (projectOrder.length > 0) {
      filtered.sort((a, b) => {
        const ai = projectOrder.indexOf(a.project.id);
        const bi = projectOrder.indexOf(b.project.id);
        if (ai === -1 && bi === -1) return 0;
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      });
    }
    return filtered;
  }, [groups, filterStatus, searchQuery, projectOrder]);

  const counts = useMemo(() => {
    const all = groups.flatMap((g) => g.tasks);
    return {
      all: all.length,
      todo: all.filter((t: any) => t.taskStatus === "TODO").length,
      in_progress: all.filter((t: any) => t.taskStatus === "IN_PROGRESS").length,
      on_hold: all.filter((t: any) => t.taskStatus === "ON_HOLD").length,
      done: all.filter((t: any) => t.taskStatus === "DONE").length,
      blocked: all.filter((t: any) => t.taskStatus === "BLOCKED").length,
    };
  }, [groups]);

  const today = new Date().toISOString().slice(0, 10);
  const dueState = (endDate: string | null) => {
    if (!endDate) return null;
    if (endDate < today) return "overdue";
    const diff = Math.ceil((new Date(endDate).getTime() - Date.now()) / 86400000);
    return diff <= 3 ? "soon" : "ok";
  };
  const setSavingKey = (key: string, on: boolean) =>
    setSaving((prev) => { const n = new Set(prev); on ? n.add(key) : n.delete(key); return n; });

  const handleTaskClick = async (task: any, e: React.MouseEvent) => {
    e.stopPropagation();
    if (selectedTask?.id === task.taskId) { setSelectedTask(null); return; }
    const full = await taskApi.get(task.project.id, task.taskId);
    setSelectedTask(full);
    setSelectedProjectId(task.project.id);
  };

  const handleStatusChange = async (task: any, newStatus: string) => {
    const key = `${task.taskId}:status`;
    setSavingKey(key, true);
    try { await taskApi.update(task.project.id, task.taskId, { status: newStatus }); await load(); }
    finally { setSavingKey(key, false); }
  };

  const makeCommitHandler = (task: any, seg: any) => async (key: string, rawVal: string) => {
    const val = rawVal.trim(); setEditCell(null);
    if (!val) return;
    const field = key.split(":").pop()!;
    setSavingKey(key, true);
    try {
      if (field === "startDate" || field === "endDate" || field === "progress") {
        const payload: any = { changeReason: "직접 수정" };
        if (field === "startDate") payload.startDate = val;
        else if (field === "endDate") payload.endDate = val;
        else payload.progressPercent = Math.min(100, Math.max(0, Number(val)));
        await taskApi.updateSegment(task.project.id, task.taskId, seg.segmentId, payload);
      } else if (field === "allocation") {
        await taskApi.upsertAssignment(task.project.id, task.taskId, seg.segmentId, {
          resourceId: seg.resourceId,
          allocationMode: seg.allocationMode ?? "PERCENT",
          allocationPercent: Math.min(200, Math.max(0, Number(val))),
        });
      }
      await load();
    } finally { setSavingKey(key, false); }
  };

  const FILTER_TABS = [
    { label: "전체", count: counts.all, status: "ALL" as FilterStatus },
    { label: "예정", count: counts.todo, status: "TODO" as FilterStatus },
    { label: "진행중", count: counts.in_progress, status: "IN_PROGRESS" as FilterStatus },
    { label: "보류", count: counts.on_hold, status: "ON_HOLD" as FilterStatus },
    { label: "완료", count: counts.done, status: "DONE" as FilterStatus },
    { label: "차단", count: counts.blocked, status: "BLOCKED" as FilterStatus },
  ];

  return (
    <div onClick={() => selectedTask && setSelectedTask(null)}>
      {/* Filter + Search */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center bg-gray-100 rounded-lg p-1 gap-0.5">
          {FILTER_TABS.map((tab) => (
            <button key={tab.status} onClick={() => setFilterStatus(tab.status)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${filterStatus === tab.status ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-700"}`}>
              {tab.label} <span className="ml-0.5 opacity-60">{tab.count}</span>
            </button>
          ))}
        </div>
        <div className="relative max-w-xs flex-1">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">🔍</span>
          <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="태스크 또는 프로젝트 검색..."
            className="w-full pl-7 pr-3 py-1.5 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <button onClick={load} className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs text-gray-600 hover:bg-gray-50">새로고침</button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center text-sm text-red-600">
          {error} <button onClick={load} className="ml-2 underline text-xs">다시 시도</button>
        </div>
      ) : filteredGroups.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
          <p className="text-3xl mb-2">✅</p>
          <p className="text-sm text-gray-400">
            {searchQuery || filterStatus !== "ALL" ? "검색 조건에 맞는 작업이 없습니다." : "아직 배정된 작업이 없습니다."}
          </p>
        </div>
      ) : (
        <div className="space-y-0 flex flex-col gap-0">
          {filteredGroups.map((group) => {
            const isCollapsed = collapsedProjects.has(group.project.id);
            const isDragging = dragProjectId === group.project.id;
            const linePos = dragOver?.id === group.project.id ? dragOver!.pos : null;
            return (
              <div key={group.project.id} className="relative">
                {linePos === "before" && <div className="absolute -top-0.5 left-0 right-0 h-0.5 bg-blue-500 rounded-full z-10 pointer-events-none" />}
                <div
                  className={`bg-white border rounded-xl overflow-hidden mb-3 transition-opacity ${isDragging ? "opacity-40" : "opacity-100"} border-gray-200`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (!dragProjectId || dragProjectId === group.project.id) return;
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    const pos = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
                    if (dragOver?.id !== group.project.id || dragOver?.pos !== pos) setDragOver({ id: group.project.id, pos });
                  }}
                  onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (!dragProjectId || dragProjectId === group.project.id) return;
                    const ids = filteredGroups.map((g) => g.project.id);
                    const from = ids.indexOf(dragProjectId);
                    let to = ids.indexOf(group.project.id);
                    if (dragOver?.pos === "after") to += 1;
                    const newOrder = [...ids];
                    newOrder.splice(from, 1);
                    const adjustedTo = from < to ? to - 1 : to;
                    newOrder.splice(adjustedTo, 0, dragProjectId);
                    setProjectOrder(newOrder);
                    localStorage.setItem("myTasks_projectOrder", JSON.stringify(newOrder));
                    setDragProjectId(null); setDragOver(null);
                  }}
                >
                  {linePos === "after" && <div className="absolute -bottom-1.5 left-0 right-0 h-0.5 bg-blue-500 rounded-full z-10 pointer-events-none" />}
                  {/* Project header */}
                  <div className="flex items-center border-b border-gray-100 bg-gray-50 hover:bg-gray-100 transition-colors">
                    <div draggable
                      onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.effectAllowed = "move"; setDragProjectId(group.project.id); }}
                      onDragEnd={() => { setDragProjectId(null); setDragOver(null); }}
                      className="pl-2 pr-1 cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 select-none" title="드래그로 순서 변경">⠿</div>
                    <button onClick={() => setCollapsedProjects((prev) => { const n = new Set(prev); n.has(group.project.id) ? n.delete(group.project.id) : n.add(group.project.id); return n; })}
                      className="flex-1 flex items-center gap-2 px-2 py-2.5 text-left">
                      <span className="text-gray-400 text-[10px]">{isCollapsed ? "▶" : "▼"}</span>
                      <span className="font-semibold text-sm text-gray-900">{group.project.name}</span>
                      <span className="text-[10px] text-gray-400 border border-gray-200 bg-white px-1.5 py-0.5 rounded-full">
                        {PROJECT_STATUS_LABEL[group.project.status] ?? group.project.status}
                      </span>
                      <button onClick={(e) => { e.stopPropagation(); sessionStorage.setItem(`erp_tab_${group.project.id}`, "tasks"); router.push(`/projects/${group.project.id}`); }}
                        className="text-[10px] text-blue-600 border border-blue-200 bg-blue-50 hover:bg-blue-100 px-1.5 py-0.5 rounded-full transition-colors">이동</button>
                      <span className="ml-auto text-xs text-gray-400">{group.tasks.length}개 태스크</span>
                    </button>
                  </div>

                  {!isCollapsed && (
                    <>
                      <div className="grid gap-0 px-4 py-1.5 border-b border-gray-100 bg-gray-50/30 text-[10px] font-semibold text-gray-400 uppercase tracking-wide"
                        style={{ gridTemplateColumns: "1fr 76px 96px 96px 200px 72px" }}>
                        <span>태스크</span><span className="text-center">상태</span>
                        <span className="text-center">시작일</span><span className="text-center">종료일</span>
                        <span className="text-center">진행률</span><span className="text-center">배당율</span>
                      </div>
                      <div className="divide-y divide-gray-50">
                        {group.tasks.map((task: any) => {
                          const multiSeg = (task.mySegments?.length ?? 0) > 1;
                          const displayStatus = task.taskStatus;
                          return (
                            <div key={task.taskId}>
                              {multiSeg && (
                                <div className="grid gap-0 px-4 bg-blue-50/40" style={{ gridTemplateColumns: "1fr 76px 96px 96px 200px 72px", height: 34 }}>
                                  <div className="flex items-center gap-1.5 min-w-0 cursor-pointer hover:bg-blue-50/60 px-2 rounded" onClick={(e) => handleTaskClick(task, e)}>
                                    {task.isMilestone && <span className="text-purple-500 text-xs shrink-0">◆</span>}
                                    <span className="text-sm font-medium text-gray-800 truncate">{task.taskName}</span>
                                    <span className="text-[10px] text-gray-400 shrink-0">({task.mySegments.length}개 세그먼트)</span>
                                  </div>
                                  <div className="flex items-center justify-center">
                                    {statusEditId === task.taskId ? (
                                      <select autoFocus value={displayStatus}
                                        onChange={(e) => { handleStatusChange(task, e.target.value); setStatusEditId(null); }}
                                        onBlur={() => setStatusEditId(null)} onKeyDown={(e) => e.key === "Escape" && setStatusEditId(null)}
                                        onClick={(e) => e.stopPropagation()}
                                        className="text-[10px] border border-blue-400 rounded px-1 py-0.5 focus:outline-none bg-white">
                                        <option value="TODO">예정</option><option value="IN_PROGRESS">진행중</option>
                                        <option value="ON_HOLD">보류</option><option value="DONE">완료</option><option value="BLOCKED">차단</option>
                                      </select>
                                    ) : (
                                      <span onClick={(e) => { e.stopPropagation(); setStatusEditId(task.taskId); }}
                                        className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium cursor-pointer hover:opacity-75 ${STATUS_COLOR[displayStatus] ?? "bg-gray-100 text-gray-600"}`}>
                                        {STATUS_LABEL[displayStatus] ?? displayStatus}
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center justify-center text-xs text-gray-400">{task.startDate ?? "—"}</div>
                                  <div className="flex items-center justify-center text-xs text-gray-400">{task.endDate ?? "—"}</div>
                                  <div className="flex items-center justify-center gap-1.5">
                                    <div className="w-24 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                      <div className="h-full bg-blue-400 rounded-full" style={{ width: `${task.overallProgress}%` }} />
                                    </div>
                                    <span className="text-[10px] text-gray-400 w-7 text-right">{task.overallProgress}%</span>
                                  </div>
                                  <div />
                                </div>
                              )}
                              {task.mySegments?.map((seg: any) => {
                                const segKey = `${task.taskId}:${seg.segmentId}`;
                                const due = dueState(seg.endDate);
                                const allocVal = seg.allocationMode === "PERCENT" ? (seg.allocationPercent ?? 100) : (seg.allocationHoursPerDay ?? 8);
                                const allocUnit = seg.allocationMode === "PERCENT" ? "%" : "h";
                                return (
                                  <div key={seg.segmentId}
                                    className={`grid gap-0 hover:bg-gray-50/60 transition-colors ${multiSeg ? "pl-6" : ""}`}
                                    style={{ gridTemplateColumns: "1fr 76px 96px 96px 200px 72px", height: 36 }}>
                                    <div className={`flex items-center gap-1.5 min-w-0 pl-4 ${!multiSeg ? "cursor-pointer hover:bg-blue-50/60 rounded" : ""}`}
                                      onClick={!multiSeg ? (e) => handleTaskClick(task, e) : undefined}>
                                      {!multiSeg && task.isMilestone && <span className="text-purple-500 text-xs shrink-0">◆</span>}
                                      <span className={`truncate ${multiSeg ? "text-xs text-gray-500" : "text-sm font-medium text-gray-800"}`}>
                                        {multiSeg ? seg.segmentName : task.taskName}
                                      </span>
                                      {!multiSeg && due === "overdue" && <span className="shrink-0 text-[10px] text-red-600 bg-red-50 px-1 rounded">기한초과</span>}
                                      {!multiSeg && due === "soon" && displayStatus !== "DONE" && <span className="shrink-0 text-[10px] text-orange-600 bg-orange-50 px-1 rounded">마감임박</span>}
                                    </div>
                                    <div className="flex items-center justify-center">
                                      {!multiSeg && (statusEditId === task.taskId ? (
                                        <select autoFocus value={displayStatus}
                                          onChange={(e) => { handleStatusChange(task, e.target.value); setStatusEditId(null); }}
                                          onBlur={() => setStatusEditId(null)} onKeyDown={(e) => e.key === "Escape" && setStatusEditId(null)}
                                          onClick={(e) => e.stopPropagation()}
                                          className="text-[10px] border border-blue-400 rounded px-1 py-0.5 focus:outline-none bg-white">
                                          <option value="TODO">예정</option><option value="IN_PROGRESS">진행중</option>
                                          <option value="ON_HOLD">보류</option><option value="DONE">완료</option><option value="BLOCKED">차단</option>
                                        </select>
                                      ) : (
                                        <span onClick={(e) => { e.stopPropagation(); setStatusEditId(task.taskId); }}
                                          className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium cursor-pointer hover:opacity-75 ${STATUS_COLOR[displayStatus] ?? "bg-gray-100 text-gray-600"}`}>
                                          {STATUS_LABEL[displayStatus] ?? displayStatus}
                                        </span>
                                      ))}
                                    </div>
                                    <div className="flex items-center justify-center">
                                      <EditCell editKey={`${segKey}:startDate`} display={seg.startDate ?? ""} inputType="date" width="w-28"
                                        editCell={editCell} setEditCell={setEditCell} saving={saving} onCommit={makeCommitHandler(task, seg)} />
                                    </div>
                                    <div className="flex items-center justify-center">
                                      <EditCell editKey={`${segKey}:endDate`} display={seg.endDate ?? ""} inputType="date" width="w-28"
                                        editCell={editCell} setEditCell={setEditCell} saving={saving} onCommit={makeCommitHandler(task, seg)} />
                                    </div>
                                    <div className="flex items-center justify-center gap-1.5 pr-1" onClick={(e) => e.stopPropagation()}>
                                      <input type="range" min={0} max={100} step={5} value={seg.progressPercent ?? 0}
                                        onChange={(e) => {
                                          const v = Number(e.target.value);
                                          setGroups((prev) => prev.map((g) => ({
                                            ...g,
                                            tasks: g.tasks.map((t: any) => t.taskId !== task.taskId ? t : {
                                              ...t,
                                              mySegments: t.mySegments.map((s: any) => s.segmentId !== seg.segmentId ? s : { ...s, progressPercent: v }),
                                            }),
                                          })));
                                        }}
                                        onMouseUp={(e) => makeCommitHandler(task, seg)(`${segKey}:progress`, String((e.target as HTMLInputElement).value))}
                                        onTouchEnd={(e) => makeCommitHandler(task, seg)(`${segKey}:progress`, String((e.target as HTMLInputElement).value))}
                                        className={`w-24 h-1.5 rounded-full cursor-pointer accent-blue-500 ${saving.has(`${segKey}:progress`) ? "opacity-40" : ""}`} />
                                      <EditCell editKey={`${segKey}:progress`} display={`${seg.progressPercent ?? 0}%`} inputType="number" width="w-10" align="right"
                                        editCell={editCell} setEditCell={setEditCell} saving={saving} onCommit={makeCommitHandler(task, seg)} />
                                    </div>
                                    <div className="flex items-center justify-center">
                                      <EditCell editKey={`${segKey}:allocation`} display={`${allocVal}${allocUnit}`} inputType="number" width="w-12" align="center"
                                        editCell={editCell} setEditCell={setEditCell} saving={saving} onCommit={makeCommitHandler(task, seg)} />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectedTask && (
        <TaskDrawer task={selectedTask} projectId={selectedProjectId}
          onClose={() => setSelectedTask(null)}
          onRefresh={async () => {
            await load();
            const fresh = await taskApi.get(selectedProjectId, selectedTask.id);
            setSelectedTask(fresh);
          }} />
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type Tab = "kanban" | "week" | "tasks";

export default function DashboardPage() {
  const { data, loading, error, load, updateProgress } = useKanban();
  const [modalCard, setModalCard] = useState<KanbanCard | null>(null);
  const [tab, setTab] = useState<Tab>("kanban");

  useEffect(() => { load(); }, []);

  const TABS: { key: Tab; label: string }[] = [
    { key: "kanban", label: "칸반" },
    { key: "week",   label: "주간" },
    { key: "tasks",  label: "작업 목록" },
  ];

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">내 대시보드</h1>
          {data && (
            <p className="text-sm text-gray-500 mt-0.5">
              {data.date} · 배정된 세그먼트 {data.totalAssigned}개
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === t.key ? "bg-blue-600 text-white" : "bg-white text-gray-600 border border-gray-300 hover:bg-gray-50"}`}>
              {t.label}
            </button>
          ))}
          {tab !== "tasks" && (
            <button onClick={load} className="p-1.5 text-gray-400 hover:text-gray-600 border border-gray-200 rounded-lg bg-white" title="새로고침">↻</button>
          )}
        </div>
      </div>

      {/* Attendance summary */}
      <AttendanceSummaryBar />

      {/* Kanban / Week: stale banner */}
      {tab !== "tasks" && data && <StaleBanner count={data.staleCount} />}

      {/* Kanban */}
      {tab === "kanban" && (
        loading ? (
          <div className="flex items-center justify-center min-h-[60vh]">
            <div className="text-gray-400 text-sm">불러오는 중...</div>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
            <div className="text-red-500 text-sm">{error}</div>
            <button onClick={load} className="text-sm text-blue-600 hover:underline">다시 시도</button>
          </div>
        ) : data ? (
          <div className="flex gap-4 overflow-x-auto pb-2">
            {(["DUE_SOON", "IN_PROGRESS", "UPCOMING", "DONE"] as const).map((col) => (
              <KanbanColumn key={col} colKey={col} cards={data.columns[col]} onUpdate={setModalCard} />
            ))}
          </div>
        ) : null
      )}

      {/* Week */}
      {tab === "week" && <WeekCalendarView />}

      {/* Tasks */}
      {tab === "tasks" && <MyTasksView />}

      {/* Progress modal */}
      {modalCard && (
        <ProgressUpdateModal card={modalCard} onClose={() => setModalCard(null)}
          onSave={async (value, reason) => { await updateProgress(modalCard.segmentId, value, reason); }} />
      )}
    </div>
  );
}
