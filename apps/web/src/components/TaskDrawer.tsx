"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { taskApi, commentApi, resourceApi } from "@/lib/api";
import clsx from "clsx";
import DateInput from "./DateInput";

const STATUS_OPTIONS = [
  { value: "TODO",        label: "예정",  color: "bg-gray-100 text-gray-700" },
  { value: "IN_PROGRESS", label: "진행중", color: "bg-blue-100 text-blue-700" },
  { value: "ON_HOLD",     label: "보류",  color: "bg-yellow-100 text-yellow-700" },
  { value: "DONE",        label: "완료",  color: "bg-green-100 text-green-700" },
  { value: "BLOCKED",     label: "차단",  color: "bg-red-100 text-red-700" },
];

const DEP_TYPES: Record<string, string> = {
  FS: "FS (완료→시작)",
  SS: "SS (시작→시작)",
  FF: "FF (완료→완료)",
  SF: "SF (시작→완료)",
};

interface Props {
  task: any;
  projectId: string;
  isParent?: boolean;
  hiddenSegIds?: Set<string>;
  onToggleSeg?: (segId: string) => void;
  onClose: () => void;
  onRefresh: () => void;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SegmentCard({
  seg, projectId, taskId, saving, setSaving, onRefresh, onDelete, readonly = false,
  isHidden, onToggleVisibility,
}: {
  seg: any; projectId: string; taskId: string;
  saving: string | null; setSaving: (s: string | null) => void;
  onRefresh: () => void; onDelete: (segId: string) => void; readonly?: boolean;
  isHidden?: boolean; onToggleVisibility?: () => void;
}) {
  const [assignments, setAssignments] = useState<any[]>([]);
  const [resources, setResources] = useState<any[]>([]);
  const [showAddAssign, setShowAddAssign] = useState(false);
  const [assignSearch, setAssignSearch] = useState("");
  const [newAssign, setNewAssign] = useState({ resourceId: "", allocationMode: "PERCENT" as "PERCENT" | "HOURS", allocationPercent: 100, allocationHoursPerDay: 8 });

  // 인라인 편집 로컬 상태
  const [name, setName] = useState(seg.name);
  const [startDate, setStartDate] = useState(seg.startDate);
  const [endDate, setEndDate] = useState(seg.endDate);
  const [progress, setProgress] = useState<number>(seg.progressPercent);
  const [errorPopup, setErrorPopup] = useState<{ message: string; onDismiss: () => void } | null>(null);
  // ref for save-on-blur without stale closures
  const latestDates = useRef({ startDate: seg.startDate, endDate: seg.endDate });

  const revertSegFields = () => {
    setName(seg.name);
    setStartDate(seg.startDate);
    setEndDate(seg.endDate);
    setProgress(seg.progressPercent);
    latestDates.current = { startDate: seg.startDate, endDate: seg.endDate };
  };

  useEffect(() => {
    loadAssignments();
    resourceApi.list({ isActive: true }).then(setResources).catch(() => {});
  }, [seg.id]);

  const loadAssignments = async () => {
    try { setAssignments(await taskApi.listAssignments(projectId, taskId, seg.id)); }
    catch { setAssignments([]); }
  };

  const saveSegField = async (fields: Record<string, any>) => {
    setSaving("seg-" + seg.id);
    try {
      await taskApi.updateSegment(projectId, taskId, seg.id, { ...fields, changeReason: "일정 수정" });
      onRefresh();
    } catch (e: any) {
      setErrorPopup({ message: e.message, onDismiss: revertSegFields });
    }
    finally { setSaving(null); }
  };

  const saveAssignAlloc = async (resourceId: string, mode: string, val: number) => {
    const payload: any = { resourceId, allocationMode: mode };
    if (mode === "PERCENT") payload.allocationPercent = val;
    else payload.allocationHoursPerDay = val;
    try { await taskApi.upsertAssignment(projectId, taskId, seg.id, payload); }
    catch (e: any) {
      setErrorPopup({ message: e.message, onDismiss: loadAssignments });
    }
  };

  const handleAddAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAssign.resourceId) return;
    setSaving("assign-" + seg.id);
    try {
      const payload: any = { resourceId: newAssign.resourceId, allocationMode: newAssign.allocationMode };
      if (newAssign.allocationMode === "PERCENT") payload.allocationPercent = newAssign.allocationPercent;
      else payload.allocationHoursPerDay = newAssign.allocationHoursPerDay;
      await taskApi.upsertAssignment(projectId, taskId, seg.id, payload);
      setShowAddAssign(false);
      setAssignSearch("");
      setNewAssign({ resourceId: "", allocationMode: "PERCENT", allocationPercent: 100, allocationHoursPerDay: 8 });
      await loadAssignments();
      onRefresh();
    } catch (e: any) {
      setErrorPopup({ message: e.message, onDismiss: () => setErrorPopup(null) });
    }
    finally { setSaving(null); }
  };

  const handleRemoveAssign = async (resourceId: string) => {
    if (!confirm("이 자원 배정을 삭제하시겠습니까?")) return;
    try { await taskApi.removeAssignment(projectId, taskId, seg.id, resourceId); await loadAssignments(); onRefresh(); }
    catch (e: any) { alert(e.message); }
  };

  const unusedResources = resources.filter((r) => !assignments.some((a) => a.resourceId === r.id));
  const isSaving = saving === "seg-" + seg.id;

  return (
    <div className={clsx("border rounded-lg p-3 space-y-2", isHidden ? "border-gray-100 bg-gray-50/50 opacity-60" : "border-gray-200")}>
      {/* 구간명 + 토글 + 삭제 */}
      <div className="flex items-center gap-2">
        {readonly ? (
          <p className="flex-1 text-sm font-medium text-gray-800">{seg.name}</p>
        ) : (
          <input
            type="text" value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name !== seg.name && saveSegField({ name })}
            className="flex-1 text-sm font-medium text-gray-800 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-blue-500 focus:outline-none py-0.5"
          />
        )}
        {onToggleVisibility && (
          <button
            onClick={onToggleVisibility}
            title={isHidden ? "타임라인에서 숨겨짐 — 클릭하여 표시" : "타임라인에 표시 중 — 클릭하여 숨기기"}
            className={clsx(
              "text-xs px-1.5 py-0.5 rounded border font-medium shrink-0 transition-colors",
              isHidden
                ? "text-gray-400 border-gray-200 bg-white hover:border-blue-300 hover:text-blue-500"
                : "text-blue-500 border-blue-200 bg-blue-50 hover:border-gray-300 hover:text-gray-400"
            )}
          >
            {isHidden ? "숨김" : "표시"}
          </button>
        )}
        {!readonly && (
          <button onClick={() => onDelete(seg.id)} className="text-gray-300 hover:text-red-500 text-sm shrink-0" title="구간 삭제">🗑</button>
        )}
      </div>

      {/* 날짜 */}
      {readonly ? (
        <p className="text-xs text-gray-500">{seg.startDate} ~ {seg.endDate}</p>
      ) : (
        <div className="flex items-center gap-1.5">
          <DateInput
            value={startDate}
            onChange={(v) => { setStartDate(v); latestDates.current.startDate = v; }}
            onBlur={() => {
              const { startDate: s, endDate: e } = latestDates.current;
              if (s !== seg.startDate || e !== seg.endDate) saveSegField({ startDate: s, endDate: e });
            }}
            disabled={isSaving}
          />
          <span className="text-xs text-gray-400">~</span>
          <DateInput
            value={endDate}
            onChange={(v) => { setEndDate(v); latestDates.current.endDate = v; }}
            onBlur={() => {
              const { startDate: s, endDate: e } = latestDates.current;
              if (s !== seg.startDate || e !== seg.endDate) saveSegField({ startDate: s, endDate: e });
            }}
            disabled={isSaving}
          />
        </div>
      )}

      {/* 진행률 */}
      <div className="flex items-center gap-2">
        {readonly ? (
          <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full bg-blue-300 rounded-full" style={{ width: `${seg.progressPercent}%` }} />
          </div>
        ) : (
          <>
            <input
              type="range" min={0} max={100} step={5} value={progress}
              onChange={(e) => setProgress(Number(e.target.value))}
              onMouseUp={() => saveSegField({ progressPercent: progress })}
              onTouchEnd={() => saveSegField({ progressPercent: progress })}
              className="flex-1 accent-blue-600"
            />
            <input
              type="number" min={0} max={100} value={progress}
              onChange={(e) => setProgress(Math.min(100, Math.max(0, Number(e.target.value))))}
              onBlur={() => saveSegField({ progressPercent: progress })}
              onFocus={(e) => (e.target as HTMLInputElement).select()}
              className="w-12 text-xs border border-gray-200 rounded px-1.5 py-1 text-right focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </>
        )}
        <span className="text-xs text-gray-500 shrink-0">%</span>
      </div>

      {/* 저장 오류 팝업 */}
      {errorPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={() => { errorPopup.onDismiss(); setErrorPopup(null); }}>
          <div className="bg-white rounded-xl shadow-xl px-6 py-5 max-w-xs w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold text-gray-800 mb-1">저장 실패</p>
            <p className="text-sm text-red-600 mb-4">{errorPopup.message}</p>
            <button
              onClick={() => { errorPopup.onDismiss(); setErrorPopup(null); }}
              className="w-full bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700"
            >
              확인
            </button>
          </div>
        </div>
      )}

      {/* 담당 자원 */}
      <div className="pt-1 space-y-1">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-gray-400 uppercase">담당 자원</p>
          {!readonly && <button onClick={() => setShowAddAssign(!showAddAssign)} className="text-xs text-blue-600 hover:underline">+ 배정</button>}
        </div>
        {assignments.length === 0 && !showAddAssign && (
          <p className="text-xs text-gray-300">배정된 자원 없음</p>
        )}
        {assignments.map((a: any) => (
          <div key={a.resourceId} className="flex items-center gap-1.5 bg-gray-50 rounded px-2 py-1">
            <span className="text-xs shrink-0">{a.resourceType === "EQUIPMENT" ? "🔧" : "👤"}</span>
            <span className="text-xs font-medium text-gray-700 flex-1 truncate">{a.resourceName}</span>
            {readonly ? (
              <span className="text-xs text-gray-400">{a.allocationMode === "PERCENT" ? `${a.allocationPercent ?? 100}%` : `${a.allocationHoursPerDay ?? 8}h/일`}</span>
            ) : (
              <>
                <select
                  value={a.allocationMode ?? "PERCENT"}
                  onChange={(e) => saveAssignAlloc(a.resourceId, e.target.value, e.target.value === "PERCENT" ? (a.allocationPercent ?? 100) : (a.allocationHoursPerDay ?? 8))}
                  className="text-xs border border-gray-200 rounded px-1 py-0.5 focus:outline-none"
                >
                  <option value="PERCENT">%</option>
                  <option value="HOURS">h/일</option>
                </select>
                <input
                  type="number"
                  min={a.allocationMode === "HOURS" ? 0.5 : 1}
                  max={a.allocationMode === "HOURS" ? 24 : 200}
                  step={a.allocationMode === "HOURS" ? 0.5 : 1}
                  defaultValue={a.allocationMode === "PERCENT" ? (a.allocationPercent ?? 100) : (a.allocationHoursPerDay ?? 8)}
                  onBlur={(e) => saveAssignAlloc(a.resourceId, a.allocationMode ?? "PERCENT", Number(e.target.value))}
                  onFocus={(e) => (e.target as HTMLInputElement).select()}
                  className="w-14 text-xs border border-gray-200 rounded px-1.5 py-0.5 text-right focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <button onClick={() => handleRemoveAssign(a.resourceId)} className="text-gray-300 hover:text-red-500 text-xs shrink-0">×</button>
              </>
            )}
          </div>
        ))}
        {showAddAssign && (
          <form onSubmit={handleAddAssign} className="p-2 bg-blue-50 rounded-lg space-y-2">
            <input
              autoFocus
              type="text"
              value={assignSearch}
              onChange={(e) => setAssignSearch(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder="자원 검색..."
              className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <div className="max-h-36 overflow-y-auto border border-gray-200 rounded bg-white">
              {unusedResources
                .filter((r: any) => r.name.toLowerCase().includes(assignSearch.toLowerCase()))
                .map((r: any) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setNewAssign({ ...newAssign, resourceId: r.id })}
                    className={clsx(
                      "w-full text-left px-2 py-1.5 text-xs hover:bg-blue-50 transition-colors",
                      newAssign.resourceId === r.id ? "bg-blue-100 text-blue-700 font-medium" : "text-gray-700"
                    )}
                  >
                    {r.type === "EQUIPMENT" ? "🔧" : "👤"} {r.name}
                  </button>
                ))}
              {unusedResources.filter((r: any) => r.name.toLowerCase().includes(assignSearch.toLowerCase())).length === 0 && (
                <p className="text-xs text-gray-400 px-2 py-2 text-center">검색 결과 없음</p>
              )}
            </div>
            {newAssign.resourceId && (
              <p className="text-xs text-blue-600 truncate">
                선택: {unusedResources.find((r: any) => r.id === newAssign.resourceId)?.name}
              </p>
            )}
            <div className="flex gap-2">
              <select value={newAssign.allocationMode} onChange={(e) => setNewAssign({ ...newAssign, allocationMode: e.target.value as "PERCENT" | "HOURS" })}
                className="px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none">
                <option value="PERCENT">% 배정</option>
                <option value="HOURS">시간/일</option>
              </select>
              {newAssign.allocationMode === "PERCENT" ? (
                <input type="number" min={1} max={200} value={newAssign.allocationPercent}
                  onChange={(e) => setNewAssign({ ...newAssign, allocationPercent: Number(e.target.value) })}
                  onFocus={(e) => (e.target as HTMLInputElement).select()}
                  className="w-20 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none" placeholder="%" />
              ) : (
                <input type="number" min={0.5} max={24} step={0.5} value={newAssign.allocationHoursPerDay}
                  onChange={(e) => setNewAssign({ ...newAssign, allocationHoursPerDay: Number(e.target.value) })}
                  onFocus={(e) => (e.target as HTMLInputElement).select()}
                  className="w-20 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none" placeholder="h/일" />
              )}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => { setShowAddAssign(false); setAssignSearch(""); }} className="flex-1 py-1 border border-gray-300 rounded text-xs hover:bg-gray-50">취소</button>
              <button type="submit" disabled={saving === "assign-" + seg.id || !newAssign.resourceId}
                className="flex-1 py-1 bg-blue-600 text-white rounded text-xs font-medium disabled:opacity-50">
                {saving === "assign-" + seg.id ? "저장..." : "배정"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── TaskDrawer ───────────────────────────────────────────────────────────────

export default function TaskDrawer({ task, projectId, isParent = false, hiddenSegIds, onToggleSeg, onClose, onRefresh }: Props) {
  const [comments, setComments] = useState<any[]>([]);
  const [newComment, setNewComment] = useState("");
  const [postingComment, setPostingComment] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showAddSeg, setShowAddSeg] = useState(false);
  const [segFormResources, setSegFormResources] = useState<any[]>([]);
  const [segFormAssigns, setSegFormAssigns] = useState<any[]>([]);
  const [segResSearch, setSegResSearch] = useState("");

  const nextDay = (dateStr: string) => {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  };
  const defaultSeg = () => {
    const segs: any[] = task.segments ?? [];
    const last = segs[segs.length - 1];
    const start = last?.endDate ? nextDay(last.endDate) : "";
    return { name: `${task.name} ${segs.length + 1}`, startDate: start, endDate: start };
  };
  const defaultAssigns = () => {
    const segs: any[] = task.segments ?? [];
    const last = segs[segs.length - 1];
    return (last?.assignments ?? []).map((a: any) => ({
      resourceId: a.resourceId,
      resourceName: a.resourceName ?? "",
      allocationMode: a.allocationMode ?? "PERCENT",
      allocationPercent: a.allocationPercent ?? 100,
      allocationHoursPerDay: a.allocationHoursPerDay ?? 8,
    }));
  };
  const [newSeg, setNewSeg] = useState(defaultSeg);

  // 세그먼트 평균 진행율 (리프 태스크: 수동 입력 대신 구간 평균으로 자동 계산)
  const segAvgProgress = useMemo(() => {
    const segs: any[] = task.segments ?? [];
    if (segs.length === 0) return task.overallProgress ?? 0;
    const avg = segs.reduce((sum: number, s: any) => sum + (s.progressPercent ?? 0), 0) / segs.length;
    return Math.round(avg * 10) / 10;
  }, [task.segments, task.overallProgress]);

  // 하위 태스크 자원 집계 (상위 태스크 전용)
  const childResources = useMemo(() => {
    if (!isParent) return [];
    const seen = new Set<string>();
    const result: any[] = [];
    function collect(t: any) {
      for (const seg of (t.segments ?? [])) {
        for (const a of (seg.assignments ?? [])) {
          if (a.resourceId && !seen.has(a.resourceId)) {
            seen.add(a.resourceId);
            result.push(a);
          }
        }
      }
      for (const child of (t._children ?? [])) collect(child);
    }
    for (const child of (task._children ?? [])) collect(child);
    return result;
  }, [isParent, task]);

  // 상위 태스크 직접 자원 배정 (첫 번째 세그먼트 사용)
  const parentSegId = isParent ? (task.segments?.[0]?.id ?? null) : null;
  const [parentSegAssignments, setParentSegAssignments] = useState<any[]>([]);
  const [allResources, setAllResources] = useState<any[]>([]);
  const [showAddParentRes, setShowAddParentRes] = useState(false);
  const [parentResSearch, setParentResSearch] = useState("");
  const [newParentRes, setNewParentRes] = useState({ resourceId: "", allocationMode: "PERCENT" as "PERCENT" | "HOURS", allocationPercent: 100, allocationHoursPerDay: 8 });

  useEffect(() => {
    if (!isParent || !parentSegId) return;
    taskApi.listAssignments(projectId, task.id, parentSegId).then(setParentSegAssignments).catch(() => {});
    resourceApi.list({ isActive: true }).then(setAllResources).catch(() => {});
  }, [isParent, parentSegId]);

  const handleAddParentRes = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!parentSegId || !newParentRes.resourceId) return;
    setSaving("parent-res");
    try {
      const payload: any = { resourceId: newParentRes.resourceId, allocationMode: newParentRes.allocationMode };
      if (newParentRes.allocationMode === "PERCENT") payload.allocationPercent = newParentRes.allocationPercent;
      else payload.allocationHoursPerDay = newParentRes.allocationHoursPerDay;
      await taskApi.upsertAssignment(projectId, task.id, parentSegId, payload);
      setShowAddParentRes(false);
      setParentResSearch("");
      setNewParentRes({ resourceId: "", allocationMode: "PERCENT", allocationPercent: 100, allocationHoursPerDay: 8 });
      setParentSegAssignments(await taskApi.listAssignments(projectId, task.id, parentSegId));
    } catch (e: any) { alert(e.message); }
    finally { setSaving(null); }
  };

  const handleRemoveParentRes = async (resourceId: string) => {
    if (!parentSegId) return;
    try {
      await taskApi.removeAssignment(projectId, task.id, parentSegId, resourceId);
      setParentSegAssignments((prev) => prev.filter((a) => a.resourceId !== resourceId));
    } catch (e: any) { alert(e.message); }
  };

  // Dependencies state
  const [deps, setDeps] = useState<any>(null);
  const [showAddDep, setShowAddDep] = useState(false);
  const [newDep, setNewDep] = useState({ predecessorId: "", type: "FS", lagDays: 0 });

  useEffect(() => { loadComments(); loadDeps(); }, [task.id]);

  useEffect(() => {
    if (!showHistory) return;
    setHistoryLoading(true);
    taskApi.history(projectId, task.id)
      .then(setHistory)
      .catch(() => setHistory([]))
      .finally(() => setHistoryLoading(false));
  }, [task.id, showHistory]);

  const loadComments = async () => {
    try { setComments(await commentApi.list(task.id)); } catch { setComments([]); }
  };

  const loadDeps = async () => {
    try { setDeps(await taskApi.listDependencies(projectId, task.id)); } catch { setDeps(null); }
  };

  const handleStatusChange = async (status: string) => {
    setSaving("status");
    try {
      await taskApi.update(projectId, task.id, { status });
      onRefresh();
    } catch (e: any) { alert(e.message); }
    finally { setSaving(null); }
  };

  const handleDeleteSegment = async (segId: string) => {
    if (!confirm("이 구간을 삭제하시겠습니까?")) return;
    try {
      await taskApi.deleteSegment(projectId, task.id, segId);
      onRefresh();
    } catch (e: any) { alert(e.message); }
  };

  const handleAddSegment = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving("seg");
    try {
      const segment = await taskApi.createSegment(projectId, task.id, newSeg);
      // 자원 배정
      for (const a of segFormAssigns) {
        const payload: any = { resourceId: a.resourceId, allocationMode: a.allocationMode };
        if (a.allocationMode === "PERCENT") payload.allocationPercent = a.allocationPercent;
        else payload.allocationHoursPerDay = a.allocationHoursPerDay;
        await taskApi.upsertAssignment(projectId, task.id, segment.id, payload);
      }
      const addedEndDate = newSeg.endDate;
      setShowAddSeg(false);
      onRefresh();
      const nextStart = addedEndDate ? nextDay(addedEndDate) : "";
      const nextCount = (task.segments?.length ?? 0) + 2;
      setNewSeg({ name: `${task.name} ${nextCount}`, startDate: nextStart, endDate: nextStart });
    } catch (e: any) { alert(e.message); }
    finally { setSaving(null); }
  };

  const handleAddDep = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDep.predecessorId) return;
    setSaving("dep");
    try {
      await taskApi.addDependency(projectId, task.id, newDep);
      setShowAddDep(false);
      setNewDep({ predecessorId: "", type: "FS", lagDays: 0 });
      await loadDeps();
      onRefresh();
    } catch (e: any) { alert(e.message); }
    finally { setSaving(null); }
  };

  const handleRemoveDep = async (predecessorId: string) => {
    if (!confirm("이 의존 관계를 삭제하시겠습니까?")) return;
    try {
      await taskApi.removeDependency(projectId, task.id, predecessorId);
      await loadDeps();
      onRefresh();
    } catch (e: any) { alert(e.message); }
  };

  const handleComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim()) return;
    setPostingComment(true);
    try {
      await commentApi.create(task.id, newComment.trim());
      setNewComment("");
      await loadComments();
      onRefresh();
    } catch (e: any) { alert(e.message); }
    finally { setPostingComment(false); }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!confirm("댓글을 삭제하시겠습니까?")) return;
    try {
      await commentApi.delete(task.id, commentId);
      await loadComments();
      onRefresh();
    } catch (e: any) { alert(e.message); }
  };

  const startEditComment = (c: any) => {
    setEditingCommentId(c.id);
    setEditingContent(c.content);
  };

  const handleUpdateComment = async (commentId: string) => {
    const trimmed = editingContent.trim();
    if (!trimmed) return;
    try {
      await commentApi.update(task.id, commentId, trimmed);
      setEditingCommentId(null);
      await loadComments();
      onRefresh();
    } catch (e: any) { alert(e.message); }
  };

  const cancelEditComment = () => {
    setEditingCommentId(null);
    setEditingContent("");
  };

  return (
    <>
      {/* Backdrop — pointer-events-none so clicks pass through to task rows */}
      <div className="fixed inset-0 bg-black/20 z-30 pointer-events-none" />

      {/* Drawer */}
      <div className="fixed right-0 top-0 bottom-0 w-[520px] bg-white shadow-2xl z-40 flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-gray-900 text-lg leading-tight">{task.name}</h2>
            {task.milestoneName && (
              <p className="text-xs text-gray-500 mt-0.5">📌 {task.milestoneName}</p>
            )}
          </div>
          <button
            onClick={async () => {
              setShowHistory(true);
            }}
            className="text-xs text-gray-500 hover:text-blue-600 border border-gray-200 hover:border-blue-300 px-2.5 py-1 rounded-lg transition-colors shrink-0"
          >
            이력
          </button>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl mt-0.5">×</button>
        </div>

        {/* Status + Progress (always visible) */}
        <div className="px-6 py-3 border-b border-gray-100 space-y-3 bg-gray-50/50">
          <div className="flex gap-2 flex-wrap">
            {STATUS_OPTIONS.map((s) => (
              <button
                key={s.value}
                onClick={() => handleStatusChange(s.value)}
                disabled={saving === "status"}
                className={clsx(
                  "px-3 py-1 rounded-lg text-xs font-medium transition-all border-2",
                  task.status === s.value
                    ? `${s.color} border-current`
                    : "bg-white border-gray-200 text-gray-600 hover:border-gray-300",
                )}
              >
                {s.label}
              </button>
            ))}
            {task.isCritical && (
              <span className="px-2 py-1 bg-red-100 text-red-700 rounded-lg text-xs font-medium border-2 border-red-200">
                🔴 크리티컬
              </span>
            )}
          </div>
          {isParent ? (
            <div className="flex items-center gap-3 pointer-events-none select-none">
              <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-blue-200 rounded-full" style={{ width: `${task.overallProgress}%` }} />
              </div>
              <span className="text-sm font-bold text-gray-400 w-10 text-right">
                {task.overallProgress.toFixed(0)}%
              </span>
              <span className="text-xs text-gray-300">(하위 태스크 집계)</span>
            </div>
          ) : (
            <div className="flex items-center gap-3 pointer-events-none select-none">
              <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-blue-200 rounded-full transition-all" style={{ width: `${segAvgProgress}%` }} />
              </div>
              <span className="text-sm font-bold text-gray-400 w-10 text-right">
                {segAvgProgress.toFixed(0)}%
              </span>
              {(task.segments?.length ?? 0) > 0 && (
                <span className="text-xs text-gray-300 shrink-0">(구간 평균)</span>
              )}
            </div>
          )}
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">

          {/* ── 구간 ── */}
          <div className="px-6 py-4 space-y-4">
              {!isParent && (
                <div className="flex justify-end">
                  <button onClick={() => {
                    if (!showAddSeg) {
                      resourceApi.list({ isActive: true }).then(setSegFormResources).catch(() => {});
                      setSegFormAssigns(defaultAssigns());
                      setSegResSearch("");
                    }
                    setShowAddSeg(!showAddSeg);
                  }} className="text-xs text-blue-600 hover:underline font-medium">
                    + 구간 추가
                  </button>
                </div>
              )}
              {isParent && (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  하위 태스크를 보유한 상위 태스크입니다. 일정과 진행률은 하위 태스크에서 자동 집계됩니다.
                </p>
              )}

              {/* 상위 태스크 집계 요약 카드 */}
              {isParent && (
                <div className="border border-gray-200 rounded-lg p-3 space-y-3 bg-gray-50/50">
                  <div>
                    <p className="text-sm font-medium text-gray-800">전체 기간 (하위 집계)</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {task.effectiveStartDate ?? "—"} ~ {task.effectiveEndDate ?? "—"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-400 rounded-full" style={{ width: `${task.overallProgress ?? 0}%` }} />
                    </div>
                    <span className="text-xs text-gray-500 w-8 text-right">{(task.overallProgress ?? 0).toFixed(0)}%</span>
                  </div>
                  {/* 하위 태스크 자원 (read-only) */}
                  {childResources.length > 0 && (
                    <div className="pt-1 space-y-1.5">
                      <p className="text-xs font-semibold text-gray-400 uppercase">하위 태스크 자원</p>
                      {childResources.map((a: any) => (
                        <div key={a.resourceId} className="flex items-center justify-between bg-white rounded px-2 py-1 border border-gray-100">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs">{a.resourceType === "EQUIPMENT" ? "🔧" : "👤"}</span>
                            <span className="text-xs font-medium text-gray-600">{a.resourceName}</span>
                          </div>
                          <span className="text-xs text-gray-400">{a.displayText}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 직접 배정 (편집 가능) */}
                  <div className="pt-1 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-gray-400 uppercase">직접 배정</p>
                      {parentSegId && (
                        <button onClick={() => setShowAddParentRes(!showAddParentRes)} className="text-xs text-blue-600 hover:underline">+ 배정</button>
                      )}
                    </div>
                    {parentSegAssignments.length === 0 && !showAddParentRes && (
                      <p className="text-xs text-gray-300 py-0.5">직접 배정된 자원 없음</p>
                    )}
                    {parentSegAssignments.map((a: any) => (
                      <div key={a.resourceId} className="flex items-center justify-between bg-white rounded px-2 py-1 border border-gray-100">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs">{a.resourceType === "EQUIPMENT" ? "🔧" : "👤"}</span>
                          <span className="text-xs font-medium text-gray-700">{a.resourceName}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500">{a.displayText}</span>
                          <button onClick={() => handleRemoveParentRes(a.resourceId)} className="text-gray-300 hover:text-red-500 text-xs">×</button>
                        </div>
                      </div>
                    ))}
                    {showAddParentRes && (
                      <form onSubmit={handleAddParentRes} className="p-2 bg-blue-50 rounded-lg space-y-2">
                        <input
                          autoFocus
                          type="text"
                          value={parentResSearch}
                          onChange={(e) => setParentResSearch(e.target.value)}
                          onKeyDown={(e) => e.stopPropagation()}
                          placeholder="자원 검색..."
                          className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                        <div className="max-h-36 overflow-y-auto border border-gray-200 rounded bg-white">
                          {allResources
                            .filter((r: any) =>
                              !parentSegAssignments.some((a) => a.resourceId === r.id) &&
                              r.name.toLowerCase().includes(parentResSearch.toLowerCase())
                            )
                            .map((r: any) => (
                              <button
                                key={r.id}
                                type="button"
                                onClick={() => setNewParentRes({ ...newParentRes, resourceId: r.id })}
                                className={clsx(
                                  "w-full text-left px-2 py-1.5 text-xs hover:bg-blue-50 transition-colors",
                                  newParentRes.resourceId === r.id ? "bg-blue-100 text-blue-700 font-medium" : "text-gray-700"
                                )}
                              >
                                {r.type === "EQUIPMENT" ? "🔧" : "👤"} {r.name}
                              </button>
                            ))}
                          {allResources.filter((r: any) =>
                            !parentSegAssignments.some((a) => a.resourceId === r.id) &&
                            r.name.toLowerCase().includes(parentResSearch.toLowerCase())
                          ).length === 0 && (
                            <p className="text-xs text-gray-400 px-2 py-2 text-center">검색 결과 없음</p>
                          )}
                        </div>
                        {newParentRes.resourceId && (
                          <p className="text-xs text-blue-600 truncate">
                            선택: {allResources.find((r: any) => r.id === newParentRes.resourceId)?.name}
                          </p>
                        )}
                        <div className="flex gap-2">
                          <select
                            value={newParentRes.allocationMode}
                            onChange={(e) => setNewParentRes({ ...newParentRes, allocationMode: e.target.value as "PERCENT" | "HOURS" })}
                            className="px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none"
                          >
                            <option value="PERCENT">% 배정</option>
                            <option value="HOURS">시간/일</option>
                          </select>
                          {newParentRes.allocationMode === "PERCENT" ? (
                            <input type="number" min={1} max={200} value={newParentRes.allocationPercent}
                              onChange={(e) => setNewParentRes({ ...newParentRes, allocationPercent: Number(e.target.value) })}
                              onFocus={(e) => (e.target as HTMLInputElement).select()}
                              className="w-20 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none" placeholder="%" />
                          ) : (
                            <input type="number" min={0.5} max={24} step={0.5} value={newParentRes.allocationHoursPerDay}
                              onChange={(e) => setNewParentRes({ ...newParentRes, allocationHoursPerDay: Number(e.target.value) })}
                              onFocus={(e) => (e.target as HTMLInputElement).select()}
                              className="w-20 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none" placeholder="h/일" />
                          )}
                        </div>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => { setShowAddParentRes(false); setParentResSearch(""); }}
                            className="flex-1 py-1 border border-gray-300 rounded text-xs hover:bg-gray-50">취소</button>
                          <button type="submit" disabled={saving === "parent-res" || !newParentRes.resourceId}
                            className="flex-1 py-1 bg-blue-600 text-white rounded text-xs font-medium disabled:opacity-50">
                            {saving === "parent-res" ? "저장..." : "배정"}
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                </div>
              )}

              {showAddSeg && (
                <form onSubmit={handleAddSegment} className="p-3 bg-blue-50 rounded-lg space-y-2">
                  <input
                    type="text" value={newSeg.name}
                    onChange={(e) => setNewSeg({ ...newSeg, name: e.target.value })}
                    placeholder="구간명"
                    className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <div className="flex gap-2">
                    <DateInput
                      value={newSeg.startDate}
                      onChange={(v) => setNewSeg({ ...newSeg, startDate: v })}
                      className="flex-1"
                    />
                    <DateInput
                      value={newSeg.endDate}
                      onChange={(v) => setNewSeg({ ...newSeg, endDate: v })}
                      className="flex-1"
                    />
                  </div>
                  {/* 자원 배정 */}
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold text-gray-500 uppercase">자원 배정</p>
                    {/* 선택된 자원 목록 */}
                    {segFormAssigns.map((a, i) => (
                      <div key={a.resourceId} className="flex items-center gap-1.5 bg-white rounded px-2 py-1 border border-gray-200">
                        <span className="text-xs font-medium text-gray-700 flex-1 truncate">{a.resourceName}</span>
                        <select
                          value={a.allocationMode}
                          onChange={(e) => setSegFormAssigns(segFormAssigns.map((x, j) => j === i ? { ...x, allocationMode: e.target.value } : x))}
                          className="text-xs border border-gray-200 rounded px-1 py-0.5 focus:outline-none"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <option value="PERCENT">%</option>
                          <option value="HOURS">h/일</option>
                        </select>
                        <input
                          type="number"
                          min={a.allocationMode === "HOURS" ? 0.5 : 1}
                          max={a.allocationMode === "HOURS" ? 24 : 200}
                          step={a.allocationMode === "HOURS" ? 0.5 : 1}
                          value={a.allocationMode === "PERCENT" ? a.allocationPercent : a.allocationHoursPerDay}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            setSegFormAssigns(segFormAssigns.map((x, j) => j === i
                              ? { ...x, allocationPercent: x.allocationMode === "PERCENT" ? v : x.allocationPercent, allocationHoursPerDay: x.allocationMode === "HOURS" ? v : x.allocationHoursPerDay }
                              : x));
                          }}
                          onFocus={(e) => (e.target as HTMLInputElement).select()}
                          className="w-14 text-xs border border-gray-200 rounded px-1.5 py-0.5 text-right focus:outline-none"
                          onClick={(e) => e.stopPropagation()}
                        />
                        <button type="button" onClick={() => setSegFormAssigns(segFormAssigns.filter((_, j) => j !== i))}
                          className="text-gray-300 hover:text-red-500 text-xs shrink-0">×</button>
                      </div>
                    ))}
                    {/* 자원 검색 추가 */}
                    <input
                      type="text" value={segResSearch}
                      onChange={(e) => setSegResSearch(e.target.value)}
                      onKeyDown={(e) => e.stopPropagation()}
                      placeholder="자원 검색하여 추가..."
                      className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    {segResSearch && (
                      <div className="max-h-28 overflow-y-auto border border-gray-200 rounded bg-white">
                        {segFormResources
                          .filter((r) => r.name.toLowerCase().includes(segResSearch.toLowerCase()) && !segFormAssigns.some((a) => a.resourceId === r.id))
                          .map((r) => (
                            <button key={r.id} type="button"
                              onClick={() => {
                                setSegFormAssigns([...segFormAssigns, { resourceId: r.id, resourceName: r.name, allocationMode: "PERCENT", allocationPercent: 100, allocationHoursPerDay: 8 }]);
                                setSegResSearch("");
                              }}
                              className="w-full text-left px-2 py-1.5 text-xs hover:bg-blue-50 text-gray-700">
                              {r.type === "EQUIPMENT" ? "🔧" : "👤"} {r.name}
                            </button>
                          ))}
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <button type="button" onClick={() => setShowAddSeg(false)}
                      className="flex-1 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">취소</button>
                    <button type="submit" disabled={saving === "seg"}
                      className="flex-1 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
                      {saving === "seg" ? "저장 중..." : "추가"}
                    </button>
                  </div>
                </form>
              )}

              {!isParent && <div className="space-y-2">
                {(task.segments ?? []).length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-3">구간이 없습니다.</p>
                ) : (
                  (task.segments ?? []).map((seg: any) => (
                    <SegmentCard
                      key={seg.id}
                      seg={seg}
                      projectId={projectId}
                      taskId={task.id}
                      saving={saving}
                      setSaving={setSaving}
                      onRefresh={onRefresh}
                      onDelete={handleDeleteSegment}
                      readonly={isParent}
                      isHidden={hiddenSegIds?.has(seg.id)}
                      onToggleVisibility={onToggleSeg ? () => onToggleSeg(seg.id) : undefined}
                    />
                  ))
                )}
              </div>}
          </div>

          <div className="border-t border-gray-100" />

          {/* ── 의존 관계 ── */}
          <div className="px-6 py-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-gray-500 uppercase">의존 관계</h3>
              <button onClick={() => setShowAddDep(!showAddDep)} className="text-xs text-blue-600 hover:underline">+ 추가</button>
            </div>

            {showAddDep && (
              <form onSubmit={handleAddDep} className="p-3 bg-blue-50 rounded-lg space-y-2">
                <select value={newDep.predecessorId} onChange={(e) => setNewDep({ ...newDep, predecessorId: e.target.value })} required
                  className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded focus:outline-none">
                  <option value="">-- 선행 태스크 선택 --</option>
                  {(deps?.allTasks ?? [])
                    .filter((t: any) => !deps?.predecessors.some((p: any) => p.predecessorId === t.id))
                    .map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <div className="flex gap-2">
                  <select value={newDep.type} onChange={(e) => setNewDep({ ...newDep, type: e.target.value })}
                    className="flex-1 px-2 py-1.5 text-xs border border-gray-300 rounded focus:outline-none">
                    {Object.entries(DEP_TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <input type="number" value={newDep.lagDays} onChange={(e) => setNewDep({ ...newDep, lagDays: Number(e.target.value) })}
                    onFocus={(e) => (e.target as HTMLInputElement).select()}
                    className="w-20 px-2 py-1.5 text-xs border border-gray-300 rounded focus:outline-none" placeholder="lag일" />
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setShowAddDep(false)} className="flex-1 py-1 border border-gray-300 rounded text-xs hover:bg-gray-50">취소</button>
                  <button type="submit" disabled={saving === "dep"} className="flex-1 py-1 bg-blue-600 text-white rounded text-xs font-medium disabled:opacity-50">
                    {saving === "dep" ? "저장..." : "추가"}
                  </button>
                </div>
              </form>
            )}

            {!deps ? (
              <div className="flex justify-center py-6"><div className="animate-spin w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full" /></div>
            ) : (
              <div className="space-y-1.5">
                {/* 선행 태스크 */}
                {deps.predecessors.length === 0 && deps.successors.length === 0 && (
                  <p className="text-xs text-gray-400">의존 관계 없음</p>
                )}
                {deps.predecessors.map((p: any) => (
                  <div key={p.predecessorId} className="flex items-center gap-2 bg-orange-50 border border-orange-100 rounded-lg px-2 py-1.5">
                    <span className="text-xs text-orange-400 shrink-0">선행</span>
                    <span className="text-xs font-medium text-gray-800 flex-1 truncate">{p.predecessor.name}</span>
                    <select
                      defaultValue={p.type}
                      onBlur={async (e) => {
                        const newType = e.target.value;
                        if (newType === p.type) return;
                        await taskApi.removeDependency(projectId, task.id, p.predecessorId);
                        await taskApi.addDependency(projectId, task.id, { predecessorId: p.predecessorId, type: newType, lagDays: p.lagDays });
                        await loadDeps(); onRefresh();
                      }}
                      className="text-xs border border-orange-200 rounded px-1 py-0.5 bg-white focus:outline-none"
                    >
                      {Object.entries(DEP_TYPES).map(([v, l]) => <option key={v} value={v}>{v}</option>)}
                    </select>
                    <input
                      type="number"
                      defaultValue={p.lagDays}
                      onFocus={(e) => (e.target as HTMLInputElement).select()}
                      onBlur={async (e) => {
                        const newLag = Number(e.target.value);
                        if (newLag === p.lagDays) return;
                        await taskApi.removeDependency(projectId, task.id, p.predecessorId);
                        await taskApi.addDependency(projectId, task.id, { predecessorId: p.predecessorId, type: p.type, lagDays: newLag });
                        await loadDeps(); onRefresh();
                      }}
                      className="w-14 text-xs border border-orange-200 rounded px-1.5 py-0.5 text-right bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                      title="lag (일)"
                    />
                    <span className="text-xs text-gray-400 shrink-0">일</span>
                    <button onClick={() => handleRemoveDep(p.predecessorId)} className="text-gray-300 hover:text-red-500 text-xs shrink-0">×</button>
                  </div>
                ))}
                {/* 후행 태스크 (읽기 전용) */}
                {deps.successors.map((s: any) => (
                  <div key={s.successorId} className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-lg px-2 py-1.5">
                    <span className="text-xs text-blue-400 shrink-0">후행</span>
                    <span className="text-xs font-medium text-gray-800 flex-1 truncate">{s.successor.name}</span>
                    <span className="text-xs text-gray-500">{s.type}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-gray-100" />

          {/* ── 댓글 ── */}
          <div className="px-6 py-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase mb-4">댓글 ({comments.length})</h3>
              <form onSubmit={handleComment} className="flex gap-2 mb-4">
                <input
                  type="text" value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="댓글을 입력하세요..."
                  className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button type="submit" disabled={postingComment || !newComment.trim()}
                  className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50">
                  등록
                </button>
              </form>

              <div className="space-y-3">
                {comments.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">댓글이 없습니다.</p>
                ) : (
                  comments.map((c: any) => (
                    <div key={c.id} className="flex gap-2 group">
                      <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-xs font-medium text-gray-600 shrink-0 mt-0.5">
                        {(c.authorId ?? "?").slice(-2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-gray-700">{c.authorId}</span>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <span className="text-xs text-gray-400">
                              {new Date(c.createdAt).toLocaleDateString("ko-KR")}
                            </span>
                            {editingCommentId !== c.id && (
                              <button onClick={() => handleDeleteComment(c.id)}
                                className="text-gray-300 hover:text-red-500 text-xs">×</button>
                            )}
                          </div>
                        </div>
                        {editingCommentId === c.id ? (
                          <div className="mt-1 space-y-1.5">
                            <textarea
                              autoFocus
                              value={editingContent}
                              onChange={(e) => setEditingContent(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleUpdateComment(c.id); }
                                if (e.key === "Escape") cancelEditComment();
                              }}
                              rows={2}
                              className="w-full px-2.5 py-1.5 text-sm border border-blue-400 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            <div className="flex gap-1.5">
                              <button
                                onClick={() => handleUpdateComment(c.id)}
                                disabled={!editingContent.trim()}
                                className="px-3 py-1 bg-blue-600 text-white text-xs rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
                              >저장</button>
                              <button
                                onClick={cancelEditComment}
                                className="px-3 py-1 border border-gray-300 text-xs rounded-lg hover:bg-gray-50"
                              >취소</button>
                            </div>
                          </div>
                        ) : (
                          <p
                            onClick={() => startEditComment(c)}
                            className="text-sm text-gray-800 mt-0.5 cursor-pointer hover:bg-gray-50 rounded px-1 -mx-1 py-0.5 transition-colors"
                            title="클릭하여 수정"
                          >{c.content}</p>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
          </div>
        </div>
      </div>

      {/* 이력 모달 */}
      {showHistory && (
        <div className="fixed right-0 top-0 bottom-0 w-[520px] bg-white z-50 flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-3">
            <button onClick={() => setShowHistory(false)} className="text-gray-400 hover:text-gray-600 text-lg">←</button>
            <div>
              <h3 className="font-bold text-gray-900 text-base truncate max-w-[340px]">{task.name}</h3>
              <p className="text-xs text-gray-400">변경 이력</p>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {historyLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="animate-spin w-6 h-6 border-3 border-blue-600 border-t-transparent rounded-full" />
              </div>
            ) : history.length === 0 ? (
              <div className="text-center py-16 text-gray-400 text-sm">변경 이력이 없습니다.</div>
            ) : (
              <div className="space-y-2">
                {history.map((h: any) => (
                  <div key={h.id} className="border border-gray-100 rounded-lg px-4 py-3 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={clsx(
                          "text-xs font-medium px-2 py-0.5 rounded-full shrink-0",
                          h.changeType === "DATE_CHANGED" ? "bg-blue-50 text-blue-700" :
                          h.changeType === "PROGRESS_UPDATED" ? "bg-green-50 text-green-700" :
                          h.changeType === "ASSIGNMENT_CHANGED" ? "bg-purple-50 text-purple-700" :
                          h.changeType === "SEGMENT_ADDED" ? "bg-teal-50 text-teal-700" :
                          h.changeType === "SEGMENT_REMOVED" ? "bg-red-50 text-red-700" :
                          h.changeType === "COMMENT_ADDED" ? "bg-orange-50 text-orange-700" :
                          h.changeType === "COMMENT_EDITED" ? "bg-orange-50 text-orange-700" :
                          h.changeType === "COMMENT_DELETED" ? "bg-red-50 text-red-700" :
                          "bg-gray-100 text-gray-600"
                        )}>
                          {h.changeType === "DATE_CHANGED" ? "일정 변경" :
                           h.changeType === "PROGRESS_UPDATED" ? "진행률 변경" :
                           h.changeType === "ASSIGNMENT_CHANGED" ? "자원 변경" :
                           h.changeType === "SEGMENT_ADDED" ? "구간 추가" :
                           h.changeType === "SEGMENT_REMOVED" ? "구간 삭제" :
                           h.changeType === "COMMENT_ADDED" ? "댓글 작성" :
                           h.changeType === "COMMENT_EDITED" ? "댓글 수정" :
                           h.changeType === "COMMENT_DELETED" ? "댓글 삭제" :
                           h.changeType}
                        </span>
                        <span className="text-xs text-gray-400 truncate">{h.changedByName ?? h.changedBy}</span>
                      </div>
                      <span className="text-xs text-gray-400 shrink-0">
                        {new Date(h.changedAt).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    {h.field && (
                      <div className="flex items-center gap-2 text-xs text-gray-600">
                        <span className="text-gray-400">
                          {h.field === "startDate" ? "시작일" :
                           h.field === "endDate" ? "종료일" :
                           h.field === "progressPercent" ? "진행률" :
                           h.field === "assignment" ? "자원 배정" :
                           h.field === "segment" ? "구간" :
                           h.field === "comment" ? "댓글" : h.field}
                        </span>
                        {h.oldValue && <span className="line-through text-gray-400">{["startDate","endDate"].includes(h.field) ? h.oldValue.slice(0,10) : h.oldValue}</span>}
                        {h.oldValue && h.newValue && <span className="text-gray-300">→</span>}
                        {h.newValue && <span className="font-medium text-gray-700">{["startDate","endDate"].includes(h.field) ? h.newValue.slice(0,10) : h.newValue}</span>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
