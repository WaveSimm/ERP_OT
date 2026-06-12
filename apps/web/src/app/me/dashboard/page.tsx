"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { meApi, myTasksApi, taskApi, projectApi, myProfileApi, dashboardApi, expenseApi } from "@/lib/api";
import TaskDrawer from "@/components/TaskDrawer";
import AttendanceView from "@/components/AttendanceView";
import TransactionsPage from "@/app/expense/transactions/page";
import SettlementsPage from "@/app/expense/settlements/page";
import SourcesPage from "@/app/expense/sources/page";

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
    } catch (e: any) {
      const msg = e?.message ?? "";
      const isWorkLogRequired = e?.code === "WORK_LOG_REQUIRED_FOR_COMPLETION" || /작업일지/.test(msg);
      if (isWorkLogRequired) {
        alert(
          "이 태스크를 100%로 완료하려면 작업일지가 1건 이상 필요합니다.\n" +
          "작업 목록 탭에서 태스크 상세를 열어 작성해 주세요."
        );
      } else if (msg) {
        alert(msg);
      }
      load();
    }
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
    } catch (e: any) {
      const msg = e?.message ?? "";
      const isWorkLogRequired = e?.code === "WORK_LOG_REQUIRED_FOR_COMPLETION" || /작업일지/.test(msg);
      if (isWorkLogRequired) {
        const ok = confirm(
          "이 태스크를 100%로 완료하려면 작업일지가 1건 이상 필요합니다.\n" +
          "태스크 상세를 열어 작업일지를 작성하시겠습니까?"
        );
        if (ok) {
          try {
            const full = await taskApi.get(task.project.id, task.taskId);
            setSelectedTask(full);
            setSelectedProjectId(task.project.id);
          } catch { /* drawer 열기 실패는 silent */ }
        }
      } else {
        alert(msg || "저장 실패");
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
                          // 지연 판정: 미완료 + 종료일 < 오늘 (로컬)
                          const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; })();
                          const overdue = displayStatus !== "DONE" && displayStatus !== "CANCELLED" && task.endDate && task.endDate < today;
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
                                        className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium cursor-pointer hover:opacity-75 ${overdue ? "bg-red-100 text-red-700" : (STATUS_COLOR[displayStatus] ?? "bg-gray-100 text-gray-600")}`}>
                                        {overdue ? "지연" : (STATUS_LABEL[displayStatus] ?? displayStatus)}
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

// ─── My Projects ─────────────────────────────────────────────────────────────

const PROJ_STATUS_CFG: Record<string, { label: string; dot: string; text: string; bg: string }> = {
  PLANNING:    { label: "계획",   dot: "bg-gray-400",   text: "text-gray-600",   bg: "bg-gray-100" },
  IN_PROGRESS: { label: "진행중", dot: "bg-blue-500",   text: "text-blue-700",   bg: "bg-blue-100" },
  ON_HOLD:     { label: "보류",   dot: "bg-yellow-500", text: "text-yellow-700", bg: "bg-yellow-100" },
  COMPLETED:   { label: "완료",   dot: "bg-green-500",  text: "text-green-700",  bg: "bg-green-100" },
  CANCELLED:   { label: "취소",   dot: "bg-red-400",    text: "text-red-600",    bg: "bg-red-100" },
};

const ACTIVE_STATUSES = ["PLANNING", "IN_PROGRESS", "ON_HOLD"];

const fmtDate = (d?: string | null) => d ? d.slice(0, 10) : "—";

function ProjectIssuePopup({ projectName, issues, onClose }: { projectName: string; issues: any[]; onClose: () => void }) {
  const SEV_COLOR: Record<string, string> = {
    CRITICAL: "bg-red-100 text-red-800 border-red-200",
    WARNING: "bg-yellow-100 text-yellow-800 border-yellow-200",
    INFO: "bg-blue-100 text-blue-800 border-blue-200",
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="font-semibold text-gray-900">{projectName} — 이슈 상세</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>
        <div className="overflow-y-auto flex-1 p-4 space-y-2">
          {issues.length === 0 && <p className="text-sm text-gray-400 text-center py-6">이슈가 없습니다.</p>}
          {issues.map((iss, i) => {
            const taskNames: string[] = iss.taskName
              ? [iss.taskName]
              : (iss.metadata?.tasks as any[])?.map((t: any) => t.name).filter(Boolean) ?? [];
            return (
              <div key={i} className={`border rounded-lg px-4 py-2.5 text-sm ${SEV_COLOR[iss.severity] ?? ""}`}>
                <div className="flex items-center justify-between">
                  <span className="font-medium">{iss.title}</span>
                  <span className="text-[11px] opacity-70">{iss.severity}</span>
                </div>
                <div className="opacity-80 text-xs mt-0.5">{iss.description}</div>
                {taskNames.length > 0 && (
                  <div className="text-xs opacity-60 mt-1">태스크: {taskNames.join(", ")}</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ProjectTreeGroup({
  label, icon, accent, projects, issueMap, issues, router, defaultOpen = true,
}: {
  label: string; icon: string; accent: string;
  projects: any[]; issueMap: Record<string, { critical: number; warning: number; info: number }>;
  issues: any[]; router: ReturnType<typeof useRouter>; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [issuePopup, setIssuePopup] = useState<{ projectId: string; projectName: string } | null>(null);
  return (
    <>
      {issuePopup && (
        <ProjectIssuePopup
          projectName={issuePopup.projectName}
          issues={issues.filter(i => i.projectId === issuePopup.projectId)}
          onClose={() => setIssuePopup(null)}
        />
      )}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        {/* 그룹 헤더 */}
        <button
          onClick={() => setOpen(v => !v)}
          className={`w-full flex items-center gap-2 px-4 py-2.5 ${accent} border-b border-gray-200 hover:brightness-95 transition-all`}
        >
          <span className="text-sm">{open ? "▾" : "▸"}</span>
          <span className="text-sm">{icon}</span>
          <span className="text-sm font-semibold text-gray-800">{label}</span>
          <span className="ml-1 text-xs text-gray-400 bg-white/60 border border-gray-200 px-1.5 py-0.5 rounded-full">{projects.length}</span>
        </button>

        {open && (
          <>
            {projects.length === 0 ? (
              <div className="py-5 text-center text-xs text-gray-400">해당하는 프로젝트가 없습니다.</div>
            ) : (
              <table className="w-full table-auto">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500 border-b">
                    <th className="px-3 py-1.5 text-left w-10"></th>
                    <th className="px-3 py-1.5 text-left">프로젝트</th>
                    <th className="px-3 py-1.5 text-left w-28">진행률</th>
                    <th className="px-3 py-1.5 text-left w-24">예산</th>
                    <th className="px-3 py-1.5 text-left w-24">이슈</th>
                    <th className="px-3 py-1.5 text-right w-24">기간</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((p) => {
                    const cfg = PROJ_STATUS_CFG[p.status] ?? PROJ_STATUS_CFG.PLANNING;
                    const prog = p.overallProgress ?? 0;
                    const ic = issueMap[p.id] ?? { critical: 0, warning: 0, info: 0 };
                    const totalIssues = ic.critical + ic.warning + ic.info;
                    const budgetPct = p.plannedBudget ? Math.round((Number(p.actualBudget ?? 0) / Number(p.plannedBudget)) * 100) : null;
                    return (
                      <tr key={p.id} className="border-b hover:bg-gray-50 transition-colors cursor-pointer"
                        onClick={() => router.push(`/projects/${p.id}`)}>
                        <td className="px-3 py-2.5">
                          <span className={`inline-block w-2.5 h-2.5 rounded-full ${cfg.dot}`} />
                        </td>
                        <td className="px-3 py-2.5 min-w-[160px]">
                          <span className="text-sm font-medium text-blue-700 hover:underline">{p.name}</span>
                          <span className={`ml-2 text-[11px] px-1.5 py-0.5 rounded-full ${cfg.bg} ${cfg.text}`}>{cfg.label}</span>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-gray-200 rounded-full h-1.5 overflow-hidden">
                              <div className="h-1.5 rounded-full bg-blue-500 transition-all" style={{ width: `${prog}%` }} />
                            </div>
                            <span className="text-xs text-gray-600 w-7 text-right">{Math.round(prog)}%</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-gray-600">
                          {budgetPct != null ? (
                            <span className={budgetPct >= 110 ? "text-red-600 font-medium" : budgetPct >= 100 ? "text-yellow-600" : ""}>{budgetPct}%</span>
                          ) : <span className="text-gray-300">-</span>}
                        </td>
                        <td className="px-3 py-2.5" onClick={(e) => { if (totalIssues > 0) { e.stopPropagation(); setIssuePopup({ projectId: p.id, projectName: p.name }); } }}>
                          {totalIssues > 0 ? (
                            <button className="flex items-center gap-1 text-xs">
                              {ic.critical > 0 && <span className="bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-medium">{ic.critical}</span>}
                              {ic.warning > 0 && <span className="bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded">{ic.warning}</span>}
                              {ic.info > 0 && <span className="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">{ic.info}</span>}
                            </button>
                          ) : <span className="text-xs text-gray-300">-</span>}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-gray-400 text-right whitespace-nowrap">
                          {fmtDate(p.effectiveStartDate)} ~ {fmtDate(p.effectiveEndDate)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </>
  );
}

function ProjectListTable({ projects, issues, type, today }: { projects: any[]; issues: any[]; type: string; today: Date }) {
  const issueMap = useMemo(() => {
    const m: Record<string, { critical: number; warning: number; info: number }> = {};
    for (const issue of issues) {
      const pid = issue.projectId;
      if (!m[pid]) m[pid] = { critical: 0, warning: 0, info: 0 };
      if (issue.severity === "CRITICAL") m[pid].critical++;
      else if (issue.severity === "WARNING") m[pid].warning++;
      else m[pid].info++;
    }
    return m;
  }, [issues]);

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-xs text-gray-500">
          <th className="py-1.5 text-left px-2">상태</th>
          <th className="py-1.5 text-left px-2">프로젝트</th>
          <th className="py-1.5 text-right px-2">진행률</th>
          <th className="py-1.5 text-right px-2">이슈</th>
          {(type === "dueSoon" || type === "overdue") && <th className="py-1.5 text-right px-2">D-Day</th>}
        </tr>
      </thead>
      <tbody>
        {projects.map((p: any) => {
          const cfg = PROJ_STATUS_CFG[p.status] ?? PROJ_STATUS_CFG.PLANNING;
          const prog = p.overallProgress ?? 0;
          const ic = issueMap[p.id] ?? { critical: 0, warning: 0, info: 0 };
          const dday = p.effectiveEndDate ? Math.ceil((new Date(p.effectiveEndDate).getTime() - today.getTime()) / 86400000) : null;
          return (
            <tr key={p.id} className="border-b hover:bg-gray-50">
              <td className="py-2 px-2">
                <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${cfg.bg} ${cfg.text}`}>{cfg.label}</span>
              </td>
              <td className="py-2 px-2">
                <span className="font-medium text-gray-800">{p.name}</span>
              </td>
              <td className="py-2 px-2 text-right">{Math.round(prog)}%</td>
              <td className="py-2 px-2 text-right">
                {ic.critical > 0 && <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded mr-1">{ic.critical}</span>}
                {ic.warning > 0 && <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded mr-1">{ic.warning}</span>}
                {ic.info > 0 && <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">{ic.info}</span>}
              </td>
              {(type === "dueSoon" || type === "overdue") && (
                <td className={`py-2 px-2 text-right text-xs font-semibold ${dday != null && dday < 0 ? "text-red-600" : dday != null && dday <= 3 ? "text-orange-600" : "text-gray-500"}`}>
                  {dday != null ? (dday < 0 ? `D+${Math.abs(dday)}` : dday === 0 ? "D-Day" : `D-${dday}`) : "—"}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function MyProjectDetailPopup({ type, projects, issues, onClose }: { type: string; projects: any[]; issues: any[]; onClose: () => void }) {
  const today = new Date();
  const soonDate = new Date(today);
  soonDate.setDate(soonDate.getDate() + 7);

  const filtered = useMemo(() => {
    if (type === "projects") return projects;
    if (type === "dueSoon") return projects.filter(p => {
      if (!p.effectiveEndDate || p.status === "COMPLETED" || p.status === "CANCELLED") return false;
      const end = new Date(p.effectiveEndDate);
      return end >= today && end <= soonDate;
    });
    if (type === "overdue") return projects.filter(p => {
      if (!p.effectiveEndDate || p.status === "COMPLETED" || p.status === "CANCELLED") return false;
      return new Date(p.effectiveEndDate) < today;
    });
    return [];
  }, [type, projects]);

  const titles: Record<string, string> = {
    projects: "내 프로젝트 현황",
    issues: "내 프로젝트 이슈",
    dueSoon: "마감 임박 프로젝트 (7일 이내)",
    overdue: "기한 초과 프로젝트",
  };

  const SEV_CARD: Record<string, string> = {
    CRITICAL: "border-red-200 bg-red-50 text-red-800",
    WARNING: "border-yellow-200 bg-yellow-50 text-yellow-800",
    INFO: "border-blue-200 bg-blue-50 text-blue-800",
  };

  const SEVERITY_STYLE: Record<string, { bg: string; text: string; label: string }> = {
    CRITICAL: { bg: "bg-red-100", text: "text-red-700", label: "위험" },
    WARNING: { bg: "bg-yellow-100", text: "text-yellow-700", label: "경고" },
    INFO: { bg: "bg-blue-100", text: "text-blue-700", label: "정보" },
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900">{titles[type] ?? type}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="overflow-y-auto flex-1 p-4">
          {type === "issues" ? (
            issues.length === 0 ? (
              <div className="text-center py-10 text-sm text-gray-400">이슈가 없습니다.</div>
            ) : (
              <div className="space-y-4">
                {(() => {
                  const SEV_ORDER: Record<string, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };
                  const grouped = new Map<string, { projectName: string; items: any[] }>();
                  for (const issue of issues) {
                    const key = issue.projectId ?? "unknown";
                    if (!grouped.has(key)) grouped.set(key, { projectName: issue.projectName ?? key, items: [] });
                    grouped.get(key)!.items.push(issue);
                  }
                  for (const g of grouped.values()) {
                    g.items.sort((a: any, b: any) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9));
                  }
                  return Array.from(grouped.values()).map((group) => (
                    <div key={group.projectName}>
                      <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-gray-200">
                        <span className="text-sm font-bold text-gray-800">{group.projectName}</span>
                        <span className="text-[11px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">{group.items.length}건</span>
                      </div>
                      <div className="space-y-1.5">
                        {group.items.map((issue: any, idx: number) => {
                          const taskNames: string[] = issue.taskName
                            ? [issue.taskName]
                            : (issue.metadata?.tasks as any[])?.map((t: any) => t.name).filter(Boolean) ?? [];
                          return (
                            <div key={idx} className={`border rounded-lg px-4 py-2.5 text-sm ${SEV_CARD[issue.severity] ?? ""}`}>
                              <div className="flex items-center justify-between">
                                <span className="font-medium">{issue.title}</span>
                                <span className="text-[11px] opacity-70">{issue.severity}</span>
                              </div>
                              <div className="text-xs opacity-80 mt-0.5">{issue.description}</div>
                              {taskNames.length > 0 && (
                                <div className="text-xs opacity-60 mt-1">태스크: {taskNames.join(", ")}</div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ));
                })()}
              </div>
            )
          ) : filtered.length === 0 ? (
            <div className="text-center py-10 text-sm text-gray-400">해당하는 프로젝트가 없습니다.</div>
          ) : (
            <ProjectListTable projects={filtered} issues={issues} type={type} today={today} />
          )}
        </div>
      </div>
    </div>
  );
}

function MyProjectsSummaryCards({ projects, issues }: { projects: any[]; issues: any[] }) {
  const [detailType, setDetailType] = useState<string | null>(null);

  const issueCount = useMemo(() => {
    let critical = 0, warning = 0, info = 0;
    for (const i of issues) {
      if (i.severity === "CRITICAL") critical++;
      else if (i.severity === "WARNING") warning++;
      else info++;
    }
    return { critical, warning, info, total: critical + warning + info };
  }, [issues]);

  const stats = useMemo(() => {
    const statusCount = { planning: 0, inProgress: 0, onHold: 0, completed: 0, cancelled: 0 };
    let overdue = 0;
    let dueSoon = 0;
    const today = new Date();
    const soonDate = new Date(today);
    soonDate.setDate(soonDate.getDate() + 7);

    for (const p of projects) {
      if (p.status === "PLANNING") statusCount.planning++;
      else if (p.status === "IN_PROGRESS") statusCount.inProgress++;
      else if (p.status === "ON_HOLD") statusCount.onHold++;
      else if (p.status === "COMPLETED") statusCount.completed++;
      else if (p.status === "CANCELLED") statusCount.cancelled++;

      if (p.effectiveEndDate && p.status !== "COMPLETED" && p.status !== "CANCELLED") {
        const end = new Date(p.effectiveEndDate);
        if (end < today) overdue++;
        else if (end <= soonDate) dueSoon++;
      }
    }

    return { total: projects.length, statusCount, overdue, dueSoon };
  }, [projects]);

  const sc = stats.statusCount;
  const cardCls = "bg-white rounded-xl border shadow-sm p-4 cursor-pointer hover:ring-2 hover:ring-blue-200 transition-all";

  return (
    <>
      {detailType && <MyProjectDetailPopup type={detailType} projects={projects} issues={issues} onClose={() => setDetailType(null)} />}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {/* 프로젝트 현황 */}
        <div className={cardCls} onClick={() => setDetailType("projects")}>
          <div className="text-xs text-gray-500 mb-1">내 프로젝트</div>
          <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {sc.inProgress > 0 && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{sc.inProgress} 진행중</span>}
            {sc.planning > 0 && <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{sc.planning} 계획</span>}
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">{sc.completed} 완료</span>
            <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">{sc.onHold} 보류</span>
          </div>
        </div>

        {/* 내 이슈 */}
        <div className={cardCls} onClick={() => setDetailType("issues")}>
          <div className="text-xs text-gray-500 mb-1">내 이슈</div>
          <div className="text-2xl font-bold text-gray-900">{issueCount.total}</div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {issueCount.critical > 0 && <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">{issueCount.critical} 위험</span>}
            {issueCount.warning > 0 && <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">{issueCount.warning} 경고</span>}
            {issueCount.info > 0 && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{issueCount.info} 정보</span>}
            {issueCount.total === 0 && <span className="text-xs text-gray-400">이슈 없음</span>}
          </div>
        </div>

        {/* 마감 임박 */}
        <div className={cardCls} onClick={() => setDetailType("dueSoon")}>
          <div className="text-xs text-gray-500 mb-1">마감 임박 (7일 이내)</div>
          <div className={`text-2xl font-bold ${stats.dueSoon > 0 ? "text-orange-600" : "text-gray-400"}`}>{stats.dueSoon}</div>
          <div className="text-xs text-gray-400 mt-2">종료일 임박 프로젝트</div>
        </div>

        {/* 기한 초과 */}
        <div className={cardCls} onClick={() => setDetailType("overdue")}>
          <div className="text-xs text-gray-500 mb-1">기한 초과</div>
          <div className={`text-2xl font-bold ${stats.overdue > 0 ? "text-red-600" : "text-gray-400"}`}>{stats.overdue}</div>
          <div className="text-xs text-gray-400 mt-2">종료일이 지난 프로젝트</div>
        </div>
      </div>
    </>
  );
}

function MyProjectsView() {
  const router = useRouter();
  const [ownedProjects, setOwnedProjects]   = useState<any[]>([]);
  const [memberProjects, setMemberProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"ALL" | "ACTIVE" | "COMPLETED">("ALL");
  const [issues, setIssues] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [me, allRes, groups] = await Promise.all([
          myProfileApi.get(),
          projectApi.list(),
          myTasksApi.list(),
        ]);
        const allItems: any[] = (allRes as any).items ?? [];
        const assignedIds = new Set((groups as any[]).map((g: any) => g.project?.id).filter(Boolean));

        const owned = allItems.filter(p => p.ownerId === me.id);
        const member = allItems.filter(p => p.ownerId !== me.id && assignedIds.has(p.id));
        setOwnedProjects(owned);
        setMemberProjects(member);

        // fetch issues for all my projects
        const all = [...owned, ...member];
        const issueResults = await Promise.all(
          all.filter(p => p.status !== "CANCELLED").map(async (p) => {
            try {
              const list = await dashboardApi.getProjectIssues(p.id);
              return (list as any[]).map((issue: any) => ({ ...issue, projectName: p.name, projectId: p.id }));
            } catch { return []; }
          }),
        );
        setIssues(issueResults.flat());
      } catch {}
      setLoading(false);
    })();
  }, []);

  const applyFilter = (list: any[]) => {
    if (filter === "ACTIVE")    return list.filter(p => ACTIVE_STATUSES.includes(p.status));
    if (filter === "COMPLETED") return list.filter(p => p.status === "COMPLETED");
    return list;
  };

  const filteredOwned  = useMemo(() => applyFilter(ownedProjects),  [ownedProjects, filter]);
  const filteredMember = useMemo(() => applyFilter(memberProjects), [memberProjects, filter]);
  const allProjects = useMemo(() => [...ownedProjects, ...memberProjects], [ownedProjects, memberProjects]);

  const issueMap = useMemo(() => {
    const m: Record<string, { critical: number; warning: number; info: number }> = {};
    for (const issue of issues) {
      const pid = issue.projectId;
      if (!m[pid]) m[pid] = { critical: 0, warning: 0, info: 0 };
      if (issue.severity === "CRITICAL") m[pid].critical++;
      else if (issue.severity === "WARNING") m[pid].warning++;
      else m[pid].info++;
    }
    return m;
  }, [issues]);

  const FILTERS = [
    { key: "ALL"      as const, label: `전체 (${ownedProjects.length + memberProjects.length})` },
    { key: "ACTIVE"   as const, label: `진행중 (${[...ownedProjects, ...memberProjects].filter(p => ACTIVE_STATUSES.includes(p.status)).length})` },
    { key: "COMPLETED"as const, label: `완료 (${[...ownedProjects, ...memberProjects].filter(p => p.status === "COMPLETED").length})` },
  ];

  if (loading) return (
    <div className="flex items-center justify-center py-16">
      <div className="animate-spin w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full" />
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      {allProjects.length > 0 && <MyProjectsSummaryCards projects={allProjects} issues={issues} />}

      {/* Filter bar */}
      <div className="flex items-center gap-2">
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${filter === f.key ? "bg-blue-600 text-white" : "bg-white text-gray-600 border border-gray-300 hover:bg-gray-50"}`}>
            {f.label}
          </button>
        ))}
      </div>

      <ProjectTreeGroup label="내가 소유한 프로젝트" icon="👑" accent="bg-blue-50" projects={filteredOwned} issueMap={issueMap} issues={issues} router={router} />
      <ProjectTreeGroup label="내가 속한 프로젝트" icon="👥" accent="bg-gray-50" projects={filteredMember} issueMap={issueMap} issues={issues} router={router} defaultOpen={true} />
    </div>
  );
}

// ─── Expense View ────────────────────────────────────────────────────────────

interface ExpenseSummary {
  unclassified: number;
  unsettled: number;
  unapproved: number;
  settled: number;
  paid: number;
}

type ExpenseSubTab = "transactions" | "settlements" | "sources";

const EXPENSE_QUICK_ACTIONS: { key: ExpenseSubTab; label: string; icon: string }[] = [
  { key: "transactions", label: "정산내역관리", icon: "📋" },
  { key: "settlements",  label: "정산목록관리",  icon: "📦" },
  { key: "sources",      label: "카드 관리",     icon: "💳" },
];

function ExpenseView() {
  const [summary, setSummary] = useState<ExpenseSummary | null>(null);
  const [recentSettlements, setRecentSettlements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [subTab, setSubTab] = useState<ExpenseSubTab | null>(null);
  const [txInitialStatus, setTxInitialStatus] = useState("");

  const openTxWithStatus = (status: string) => {
    setTxInitialStatus(status);
    setSubTab("transactions");
  };

  const refreshSummary = async () => {
    try {
      const sum = await expenseApi.meSummary();
      setSummary(sum as ExpenseSummary);
    } catch {
      // 무시 — 기존 값 유지
    }
  };

  const refreshAll = async () => {
    try {
      const [sum, sts]: [any, any] = await Promise.all([
        expenseApi.meSummary().catch(() => ({ unclassified: 0, unsettled: 0, unapproved: 0, settled: 0, paid: 0 })),
        expenseApi.listSettlements({ limit: 5 }).catch(() => ({ items: [] as any[] })),
      ]);
      setSummary(sum as ExpenseSummary);
      setRecentSettlements(sts.items);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      {/* 요약 카드 5종 — 거래 진행 단계별 카운트 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {/* v1.6.4 (2026-05-16): 거래 페이지 탭 단순화에 따라 모두 TARGET/SETTLED로 통합 매핑.
            처리 단계 세분화는 후속 작업. */}
        <ExpenseSummaryCard label="미정산분류" count={summary?.unclassified ?? 0} color="red"   onClick={() => openTxWithStatus("TARGET")} />
        <ExpenseSummaryCard label="미결재"     count={summary?.unapproved ?? 0}  color="blue"  onClick={() => openTxWithStatus("TARGET")} />
        <ExpenseSummaryCard label="정산됨"     count={summary?.settled ?? 0}    color="teal"  onClick={() => openTxWithStatus("SETTLED")} />
        <ExpenseSummaryCard label="입금완료"   count={summary?.paid ?? 0}       color="green" onClick={() => openTxWithStatus("SETTLED")} />
      </div>

      {/* 빠른 작업 sub-tab 버튼 그룹 (라벨 없이) */}
      <div className="flex flex-wrap gap-2">
        {EXPENSE_QUICK_ACTIONS.map((a) => (
          <button
            key={a.key}
            onClick={() => setSubTab(subTab === a.key ? null : a.key)}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              subTab === a.key
                ? "bg-blue-600 text-white border border-blue-600"
                : "border border-gray-300 bg-white hover:bg-gray-50"
            }`}
          >
            {a.icon} {a.label}
          </button>
        ))}
        <a href="/manual-expense/index.html" target="_blank" rel="noopener noreferrer"
          title="경비정산 사용자 매뉴얼 (새 탭)"
          className="px-3 py-1.5 text-sm rounded-md border border-gray-300 bg-white hover:bg-gray-50">
          📘 매뉴얼
        </a>
      </div>

      {/* 최근 정산 — sub-tab 미선택 시만 표시 */}
      {!subTab && (
        <div className="bg-white border border-gray-200 rounded-lg p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-gray-700">최근 정산</h2>
            <button onClick={() => setSubTab("settlements")} className="text-xs text-blue-600 hover:underline">모두 보기 →</button>
          </div>
          {loading ? (
            <div className="py-8 text-center text-gray-400 text-sm">불러오는 중...</div>
          ) : recentSettlements.length === 0 ? (
            <div className="py-8 text-center text-gray-400 text-sm">아직 작성된 정산이 없습니다.</div>
          ) : (
            <div className="space-y-2">
              {recentSettlements.map((s: any) => (
                <Link key={s.id} href={`/expense/settlements/${s.id}`}
                  className="flex items-center justify-between px-3 py-2 hover:bg-gray-50 rounded-md transition-colors">
                  <div>
                    <div className="text-sm font-medium text-gray-900">{s.title}</div>
                    <div className="text-xs text-gray-500">
                      {s.periodStart ? `${fmtDate(s.periodStart)} ~ ${fmtDate(s.periodEnd)}` : "기간 미설정"} · {s.totalCount ?? 0}건
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold tabular-nums">
                      {Number(s.totalAmount ?? 0).toLocaleString()}원
                    </span>
                    <ExpenseSettlementStatusBadge status={s.status} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 빠른 작업 sub-page 렌더 (선택 시 하단에 추가 표시) */}
      {subTab && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          {subTab === "transactions"  && <TransactionsPage initialStatus={txInitialStatus} onChange={refreshSummary} />}
          {subTab === "settlements"   && <SettlementsPage />}
          {subTab === "sources"       && <SourcesPage />}
        </div>
      )}
    </div>
  );
}

function ExpenseSummaryCard({ label, count, color, onClick }: { label: string; count: number; color: "red" | "amber" | "blue" | "teal" | "green"; onClick: () => void }) {
  const colorMap = {
    red:   "border-red-200 bg-red-50 text-red-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    blue:  "border-blue-200 bg-blue-50 text-blue-700",
    teal:  "border-teal-200 bg-teal-50 text-teal-700",
    green: "border-green-200 bg-green-50 text-green-700",
  };
  return (
    <button type="button" onClick={onClick} className={`w-full text-left border rounded-lg p-4 hover:shadow-md transition-shadow ${colorMap[color]}`}>
      <div className="text-xs font-medium opacity-80">{label}</div>
      <div className="text-2xl font-bold mt-1 tabular-nums">{count}</div>
    </button>
  );
}

function ExpenseSettlementStatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; cls: string }> = {
    DRAFT:     { label: "작성중",     cls: "bg-gray-100 text-gray-700" },
    SUBMITTED: { label: "결재중",     cls: "bg-blue-100 text-blue-700" },
    APPROVED:  { label: "승인",       cls: "bg-emerald-100 text-emerald-700" },
    RECEIVED:  { label: "재무팀접수", cls: "bg-cyan-100 text-cyan-700" },
    PAID:      { label: "💰 입금",    cls: "bg-green-100 text-green-700" },
    REJECTED:  { label: "반려",       cls: "bg-red-100 text-red-700" },
  };
  const c = config[status] ?? { label: status, cls: "bg-gray-100" };
  return <span className={`px-2 py-0.5 text-xs font-medium rounded ${c.cls}`}>{c.label}</span>;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type Tab = "kanban" | "week" | "tasks" | "projects" | "expense" | "attendance";

const DASHBOARD_TAB_KEY = "erp_tab_dashboard";

const VALID_TABS: Tab[] = ["kanban", "week", "tasks", "projects", "expense", "attendance"];

export default function DashboardPage() {
  const { data, loading, error, load, updateProgress } = useKanban();
  const [modalCard, setModalCard] = useState<KanbanCard | null>(null);
  const [tab, setTab] = useState<Tab>("kanban");
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");

  useEffect(() => {
    // URL ?tab= 우선, 없으면 sessionStorage 마지막 탭
    if (tabParam && VALID_TABS.includes(tabParam as Tab)) {
      setTab(tabParam as Tab);
      try { sessionStorage.setItem(DASHBOARD_TAB_KEY, tabParam); } catch {}
      return;
    }
    try {
      const saved = sessionStorage.getItem(DASHBOARD_TAB_KEY) as Tab;
      if (saved) setTab(saved);
    } catch {}
  }, [tabParam]);

  useEffect(() => { load(); }, []);

  const TABS: { key: Tab; label: string }[] = [
    { key: "attendance", label: "근태" },
    { key: "kanban",     label: "칸반" },
    { key: "week",       label: "주간" },
    { key: "tasks",      label: "작업 목록" },
    { key: "projects",   label: "내 프로젝트" },
    { key: "expense",    label: "경비" },
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
        {(tab === "kanban" || tab === "week") && (
          <button onClick={load} className="p-1.5 text-gray-400 hover:text-gray-600 border border-gray-200 rounded-lg bg-white" title="새로고침">↻</button>
        )}
      </div>

      {/* Tabs — 프로젝트 상세와 동일한 언더라인 스타일 */}
      <div className="flex gap-1 border-b border-gray-200 -mb-2">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => { setTab(t.key); try { sessionStorage.setItem(DASHBOARD_TAB_KEY, t.key); } catch {} }}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Kanban / Week: stale banner */}
      {tab === "kanban" && data && <StaleBanner count={data.staleCount} />}

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

      {/* My Projects */}
      {tab === "projects" && <MyProjectsView />}

      {/* Expense */}
      {tab === "expense" && <ExpenseView />}

      {/* Attendance */}
      {tab === "attendance" && <AttendanceView />}

      {/* Progress modal */}
      {modalCard && (
        <ProgressUpdateModal card={modalCard} onClose={() => setModalCard(null)}
          onSave={async (value, reason) => { await updateProgress(modalCard.segmentId, value, reason); }} />
      )}
    </div>
  );
}
