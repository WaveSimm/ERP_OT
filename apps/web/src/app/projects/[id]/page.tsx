"use client";

import { useEffect, useState, useCallback, useRef, Fragment } from "react";
import { useRouter, useParams } from "next/navigation";
import { projectApi, taskApi, resourceApi, baselineApi, commentApi, templateApi } from "@/lib/api";
import dynamic from "next/dynamic";
import AddTaskModal from "@/components/AddTaskModal";
import TaskDrawer from "@/components/TaskDrawer";
import DateInput from "@/components/DateInput";
import AppLayout from "@/components/AppLayout";
import CommentPopover from "@/components/CommentPopover";
import ResourcePickerPopover from "@/components/ResourcePickerPopover";
import ImpactPanel from "@/components/ImpactPanel";
import TemplateWizard from "@/components/TemplateWizard";

const GanttChart = dynamic(() => import("@/components/GanttChart"), { ssr: false });

function toStr(d: Date) { return d.toISOString().slice(0, 10); }
function ganttWeekRange(offsetWeeks: number) {
  const today = new Date();
  const dow = today.getDay();
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(today);
  mon.setDate(today.getDate() + diffToMon + offsetWeeks * 7);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  return { start: toStr(mon), end: toStr(sun) };
}
function ganttMonthRange(offsetMonths: number) {
  const d = new Date();
  d.setMonth(d.getMonth() + offsetMonths);
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { start: toStr(start), end: toStr(end) };
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  PLANNING:    { label: "계획",   color: "bg-gray-100 text-gray-700" },
  IN_PROGRESS: { label: "진행중", color: "bg-blue-100 text-blue-700" },
  ON_HOLD:     { label: "보류",   color: "bg-yellow-100 text-yellow-700" },
  COMPLETED:   { label: "완료",   color: "bg-green-100 text-green-700" },
  CANCELLED:   { label: "취소",   color: "bg-red-100 text-red-700" },
};

const TASK_STATUS_COLORS: Record<string, string> = {
  TODO: "bg-gray-100 text-gray-600",
  IN_PROGRESS: "bg-blue-100 text-blue-700",
  ON_HOLD: "bg-yellow-100 text-yellow-700",
  DONE: "bg-green-100 text-green-700",
  BLOCKED: "bg-red-100 text-red-700",
};
const TASK_STATUS_LABELS: Record<string, string> = {
  TODO: "예정", IN_PROGRESS: "진행중", ON_HOLD: "보류", DONE: "완료", BLOCKED: "차단",
};

// 자원 이름 → 아바타 배경색 (해시 기반)
const AVATAR_COLORS = [
  "bg-blue-500", "bg-emerald-500", "bg-violet-500", "bg-orange-500",
  "bg-rose-500", "bg-cyan-500", "bg-amber-500", "bg-teal-500",
];
function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export default function ProjectDetailPage() {
  const router = useRouter();
  const params = useParams();
  const projectId = params.id as string;

  const [ganttData, setGanttData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // 프로젝트 스위처
  const [allProjects, setAllProjects] = useState<any[]>([]);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);
  const [showAddTask, setShowAddTask] = useState(false);
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [inlineTaskName, setInlineTaskName] = useState("");
  const [inlineAdding, setInlineAdding] = useState(false);

  type TabType = "gantt" | "tasks" | "activity";
  const TAB_KEY = `erp_tab_${projectId}`;
  const savedTab = typeof window !== "undefined"
    ? (sessionStorage.getItem(TAB_KEY) as TabType | null)
    : null;
  const [activeTab, setActiveTab] = useState<TabType>(savedTab ?? "gantt");

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    sessionStorage.setItem(TAB_KEY, tab);
  };
  const [activities, setActivities] = useState<any[]>([]);
  const [activityTick, setActivityTick] = useState(0);
  const [runningCpm, setRunningCpm] = useState(false);
  const [cpmResult, setCpmResult] = useState<any>(null);

  // Baseline overlay
  const [baselines, setBaselines] = useState<any[]>([]);
  const [activeBaselineId, setActiveBaselineId] = useState<string | null>(null);
  const [baselineSegments, setBaselineSegments] = useState<any[]>([]);

  // Panels
  const [showImpactPanel, setShowImpactPanel] = useState(false);
  const [showTemplateWizard, setShowTemplateWizard] = useState(false);
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [saveTplName, setSaveTplName] = useState("");
  const [saveTplCategory, setSaveTplCategory] = useState("");
  const [saveTplIncludeAssignments, setSaveTplIncludeAssignments] = useState(false);
  const [saveTplLoading, setSaveTplLoading] = useState(false);
  const [saveTplError, setSaveTplError] = useState("");

  // Comment content map: commentId → content (for activity feed)
  const [commentContentMap, setCommentContentMap] = useState<Record<string, string>>({});


  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await projectApi.gantt(projectId);
      setGanttData(data);
      // 최초 로드 시에만 프로젝트 전체 기간으로 초기화
      setViewStart((prev) => prev || data?.project?.effectiveStartDate || "");
      setViewEnd((prev) => prev || data?.project?.effectiveEndDate || "");
    } catch (e: any) {
      if (e.message === "Unauthorized") return;
      setError(e.message ?? "데이터를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // 드로어·인라인 편집용: 스피너 없이 ganttData만 갱신
  const loadSilent = useCallback(async () => {
    try {
      const data = await projectApi.gantt(projectId);
      setGanttData(data);
    } catch { /* ignore */ }
  }, [projectId]);

  const loadActivities = useCallback(async () => {
    try {
      const data = await projectApi.activities(projectId);
      setActivities(data.items ?? []);
    } catch {
      setActivities([]);
    }
  }, [projectId]);

  // 어떤 액션이든 완료 후 호출 → activityTick 증가 → loadActivities useEffect 재실행
  const refreshActivities = useCallback(() => {
    setActivityTick((n) => n + 1);
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("erp_token");
    if (!token) { router.push("/login"); return; }
    load();
    projectApi.list().then((r: any) => setAllProjects(r.items ?? [])).catch(() => {});
  }, [load, router]);

  useEffect(() => {
    if (!showProjectPicker) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowProjectPicker(false);
        setProjectSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showProjectPicker]);

  useEffect(() => {
    loadActivities();
    if (activeTab !== "activity") return;
    const interval = setInterval(loadActivities, 15000);
    return () => clearInterval(interval);
  }, [activeTab, loadActivities, activityTick]);

  // baseline 목록 로딩
  useEffect(() => {
    baselineApi.list(projectId).then(setBaselines).catch(() => {});
  }, [projectId]);

  // 활동 피드 댓글 내용 조회 (metadata가 null인 기존 데이터 대응)
  useEffect(() => {
    const commentActivities = activities.filter(
      (a) => a.action === "COMMENT_CREATED" || a.action === "COMMENT_UPDATED",
    );
    if (!commentActivities.length || !ganttData?.tasks?.length) return;
    const commentIds = new Set(commentActivities.map((a: any) => a.entityId));
    Promise.all(
      (ganttData.tasks as any[]).map((t: any) =>
        commentApi.list(t.id).catch(() => [] as any[]),
      ),
    ).then((results) => {
      const map: Record<string, string> = {};
      for (const comments of results) {
        for (const c of comments as any[]) {
          if (commentIds.has(c.id)) map[c.id] = c.content;
        }
      }
      setCommentContentMap(map);
    });
  }, [activities, ganttData?.tasks]);

  // active baseline 변경 시 세그먼트 로딩
  useEffect(() => {
    if (!activeBaselineId) { setBaselineSegments([]); return; }
    baselineApi.get(projectId, activeBaselineId).then((bl: any) => {
      const segs = (bl.taskBaselines ?? []).flatMap((tb: any) =>
        (tb.segmentSnapshots ?? []).map((ss: any) => ({
          taskId: tb.taskId,
          startDate: ss.startDate,
          endDate: ss.endDate,
          name: bl.name,
        }))
      );
      setBaselineSegments(segs);
    }).catch(() => setBaselineSegments([]));
  }, [projectId, activeBaselineId]);

  const handleStatusChange = async (status: string) => {
    try {
      await projectApi.update(projectId, { status });
      await load();
      refreshActivities();
    } catch (e: any) {
      alert(e.message ?? "상태 변경 실패");
    }
  };

  const handleDeleteTask = async (taskId: string, taskName: string) => {
    if (!confirm(`"${taskName}" 태스크를 삭제하시겠습니까?`)) return;
    try {
      await taskApi.delete(projectId, taskId);
      await load();
      refreshActivities();
    } catch (e: any) {
      alert(e.message ?? "삭제 실패");
    }
  };

  const handleDeleteSelected = async () => {
    if (selected.size === 0) return;
    if (!confirm(`선택한 ${selected.size}개 태스크를 삭제하시겠습니까?`)) return;
    try {
      await Promise.all(Array.from(selected).map((id) => taskApi.delete(projectId, id)));
      setSelected(new Set());
      await load();
      refreshActivities();
    } catch (e: any) {
      alert(e.message ?? "삭제 실패");
    }
  };

  const handleRunCpm = async () => {
    setRunningCpm(true);
    setCpmResult(null);
    try {
      const result = await projectApi.runCpm(projectId);
      setCpmResult(result);
      await load();
      refreshActivities();
    } catch (e: any) {
      alert(e.message ?? "CPM 실행 실패");
    } finally {
      setRunningCpm(false);
    }
  };

  // ── 컬럼 순서 ────────────────────────────────────────────────────────────────
  type ColId = "status" | "dates" | "progress" | "resources" | "note";
  const COL_CFG: Record<ColId, { label: string; width: string }> = {
    status:    { label: "상태",   width: "w-20" },
    dates:     { label: "기간",   width: "w-40" },
    progress:  { label: "진행률", width: "w-28" },
    resources: { label: "자원",   width: "w-24" },
    note:      { label: "비고",   width: "w-32" },
  };
  const DEFAULT_COL_ORDER: ColId[] = ["status", "dates", "progress", "resources", "note"];
  const [colOrder, setColOrder] = useState<ColId[]>(() => {
    try {
      const saved: string[] = JSON.parse(localStorage.getItem("erp_task_cols_v1") ?? "null") ?? DEFAULT_COL_ORDER;
      // migrate: replace legacy "cpm" with "note"
      const migrated = saved.map((c) => c === "cpm" ? "note" : c) as ColId[];
      return migrated.filter((c) => c in COL_CFG);
    } catch { return DEFAULT_COL_ORDER; }
  });
  const [colDragging, setColDragging] = useState<ColId | null>(null);
  const [colDropGap, setColDropGap] = useState<{ id: ColId; pos: "before" | "after" } | null>(null);

  const handleColDragStart = (e: React.DragEvent, col: ColId) => {
    setColDragging(col);
    e.dataTransfer.effectAllowed = "move";
  };
  const handleColDragOver = (e: React.DragEvent, col: ColId) => {
    e.preventDefault();
    if (col === colDragging) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setColDropGap({ id: col, pos: (e.clientX - rect.left) / rect.width < 0.5 ? "before" : "after" });
  };
  const handleColDrop = (e: React.DragEvent, _col: ColId) => {
    e.preventDefault();
    if (!colDragging || !colDropGap) { setColDragging(null); setColDropGap(null); return; }
    const without = colOrder.filter((c) => c !== colDragging);
    const idx = without.indexOf(colDropGap.id);
    const at = colDropGap.pos === "before" ? idx : idx + 1;
    const next = [...without];
    next.splice(at, 0, colDragging);
    setColOrder(next);
    localStorage.setItem("erp_task_cols_v1", JSON.stringify(next));
    setColDragging(null);
    setColDropGap(null);
  };

  // ── 다중 선택 state ──────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const lastSelectedRef = useRef<string | null>(null);

  // ── 드래그 state ─────────────────────────────────────────────────────────────
  const [dragIds, setDragIds] = useState<string[]>([]);
  const [dropGap, setDropGap] = useState<{ taskId: string; pos: "before" | "after" } | null>(null);

  const clearDragState = () => { setDragIds([]); setDropGap(null); };

  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    const ids = selected.has(taskId) ? [...selected] : [taskId];
    setDragIds(ids);
    if (!selected.has(taskId)) setSelected(new Set([taskId]));
    e.dataTransfer.effectAllowed = "move";
  };

  const handleRowDragOver = (e: React.DragEvent, taskId: string) => {
    e.preventDefault();
    if (dragIds.includes(taskId)) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const pos = (e.clientY - rect.top) / rect.height < 0.5 ? "before" : "after";
    if (dropGap?.taskId !== taskId || dropGap.pos !== pos) setDropGap({ taskId, pos });
  };

  // ── 인라인 편집 ──────────────────────────────────────────────────────────────
  const [editingCell, setEditingCell] = useState<{ taskId: string; col: "status" | "progress" | "dates" | "note" } | null>(null);
  const [editVal, setEditVal] = useState<any>(null);
  // ref: 항상 최신 editVal 유지 (stale closure 방지)
  const editValRef = useRef<number>(0);
  // ref: 저장 중 onBlur 이중 실행 방지
  const progressSavingRef = useRef(false);

  const startEdit = (taskId: string, col: "status" | "progress" | "dates" | "note", val: any) => {
    setEditingCell({ taskId, col });
    setEditVal(val);
    if (col === "progress") { editValRef.current = Number(val) || 0; progressSavingRef.current = false; }
  };
  const cancelEdit = () => { setEditingCell(null); setEditVal(null); };

  const saveStatus = async (taskId: string, status: string) => {
    cancelEdit();
    await taskApi.update(projectId, taskId, { status }).catch(() => {});
    await load();
  };

  const saveProgress = async (taskId: string, progress: number) => {
    if (progressSavingRef.current) return;
    progressSavingRef.current = true;
    const rounded = Math.round(progress);
    cancelEdit();
    // 낙관적 업데이트: API 완료 전에 로컬 상태 즉시 반영
    setGanttData((prev: any) => prev ? {
      ...prev,
      tasks: (prev.tasks ?? []).map((t: any) =>
        t.id === taskId ? { ...t, overallProgress: rounded } : t
      ),
    } : prev);
    await taskApi.update(projectId, taskId, { overallProgress: rounded, isManualProgress: true }).catch(() => {});
    progressSavingRef.current = false;
    await loadSilent();
  };

  const createInlineTask = async () => {
    const name = inlineTaskName.trim();
    if (!name) { setInlineTaskName(""); setInlineAdding(false); return; }
    setInlineAdding(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const end = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
      // 마지막 태스크 기준: 같은 레벨(parentId)의 sortOrder 최대값 + 1
      const allTasks: any[] = ganttData?.tasks ?? [];
      const lastVisible = flatItems[flatItems.length - 1];
      const parentId = lastVisible?.task?.parentId ?? null;
      const siblings = allTasks.filter((t: any) => (t.parentId ?? null) === parentId);
      const maxOrder = siblings.reduce((m: number, t: any) => Math.max(m, t.sortOrder ?? 0), 0);
      const task = await taskApi.create(projectId, { name, parentId: parentId ?? undefined, sortOrder: maxOrder + 1 });
      await taskApi.createSegment(projectId, task.id, { name, startDate: today, endDate: end });
      setInlineTaskName("");
      await load();
    } catch { /* ignore */ }
    finally { setInlineAdding(false); }
  };

  const saveNote = async (taskId: string, note: string) => {
    cancelEdit();
    await taskApi.update(projectId, taskId, { description: note.trim() || null }).catch(() => {});
    await load();
  };

  const saveDates = async (task: any, start: string, end: string) => {
    if (!start || !end || start > end) { cancelEdit(); return; }
    const segs: any[] = task.segments ?? [];
    if (segs.length === 0) { cancelEdit(); return; }
    cancelEdit();
    const cr = "인라인 수정";
    if (segs.length === 1) {
      await taskApi.updateSegment(projectId, task.id, segs[0].id, { startDate: start, endDate: end, changeReason: cr }).catch(() => {});
    } else {
      const sorted = [...segs].sort((a: any, b: any) => a.startDate < b.startDate ? -1 : 1);
      await Promise.all([
        taskApi.updateSegment(projectId, task.id, sorted[0].id, { startDate: start, changeReason: cr }).catch(() => {}),
        taskApi.updateSegment(projectId, task.id, sorted.at(-1).id, { endDate: end, changeReason: cr }).catch(() => {}),
      ]);
    }
    await load();
  };

  const handleRowDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    if (!dropGap || dragIds.length === 0) { clearDragState(); return; }

    const allIds = flatItems.map((fi) => fi.task.id);
    const withoutDragged = allIds.filter((id) => !dragIds.includes(id));
    const targetIdx = withoutDragged.indexOf(dropGap.taskId);
    if (targetIdx === -1) { clearDragState(); return; }

    const insertAt = dropGap.pos === "before" ? targetIdx : targetIdx + 1;
    const draggedInOrder = allIds.filter((id) => dragIds.includes(id));
    const newOrder = [...withoutDragged];
    newOrder.splice(insertAt, 0, ...draggedInOrder);

    // 드롭 대상의 parentId를 따라가 → 계층이 자동으로 결정됨
    const targetTask = flatItems.find((fi) => fi.task.id === dropGap.taskId)?.task;
    const newParentId: string | null = targetTask?.parentId ?? null;

    clearDragState();
    await Promise.all(
      newOrder.map((id, idx) => {
        const updates: Record<string, unknown> = { sortOrder: (idx + 1) * 10 };
        if (draggedInOrder.includes(id)) updates.parentId = newParentId;
        return taskApi.update(projectId, id, updates).catch(() => {});
      }),
    );
    setSelected(new Set(draggedInOrder));
    await load();
  };

  // ── 자원 목록 ────────────────────────────────────────────────────────────────
  const [resources, setResources] = useState<any[]>([]);
  useEffect(() => {
    resourceApi.list({ isActive: true }).then(setResources).catch(() => {});
  }, []);

  // ── 타임라인 표시 범위 ──────────────────────────────────────────────────────
  const [viewStart, setViewStart] = useState("");
  const [viewEnd, setViewEnd] = useState("");

  // ── 타임라인 구간 가시성 ─────────────────────────────────────────────────────
  const [hiddenSegIds, setHiddenSegIds] = useState<Set<string>>(new Set());
  const toggleSegVisibility = (segId: string) =>
    setHiddenSegIds((prev) => {
      const next = new Set(prev);
      if (next.has(segId)) next.delete(segId); else next.add(segId);
      return next;
    });

  // 상위 태스크 rollup: 하위 태스크의 기간/진행률을 집계
  const rolledUpTasks: any[] = (() => {
    const taskList: any[] = ganttData?.tasks ?? [];
    if (taskList.length === 0) return [];

    // 트리 구성
    const map = new Map(taskList.map((t: any) => [t.id, { ...t, _children: [] as any[] }]));
    for (const t of map.values()) {
      if (t.parentId && map.has(t.parentId)) {
        map.get(t.parentId)!._children.push(t);
      }
    }

    // 하위 태스크의 모든 세그먼트 수집 (재귀)
    function collectAllSegments(task: any): any[] {
      return [...task.segments, ...task._children.flatMap((c: any) => collectAllSegments(c))];
    }

    // 하위 태스크의 모든 자원 수집 (재귀, 중복 제거)
    function collectAllResources(task: any): Map<string, any> {
      const map = new Map<string, any>();
      for (const seg of task.segments ?? []) {
        for (const a of seg.assignments ?? []) {
          if (a.resourceId && !map.has(a.resourceId)) map.set(a.resourceId, a);
        }
      }
      for (const child of task._children ?? []) {
        for (const [id, a] of collectAllResources(child)) {
          if (!map.has(id)) map.set(id, a);
        }
      }
      return map;
    }

    // Bottom-up rollup: 리프는 세그먼트 평균, 상위는 자식 평균으로 집계
    function rollup(task: any): void {
      const children: any[] = task._children;
      if (children.length === 0) {
        // 리프 태스크: 자신의 세그먼트 progressPercent 평균
        const segs: any[] = task.segments ?? [];
        if (segs.length > 0) {
          const avg = segs.reduce((sum: number, s: any) => sum + (s.progressPercent ?? 0), 0) / segs.length;
          task.overallProgress = Math.round(avg * 10) / 10;
        }
        return;
      }
      children.forEach(rollup); // 자식 먼저 처리

      // 날짜: 하위 태스크 세그먼트만 (부모 자신의 segments 제외)
      const allSegs = children.flatMap((c: any) => collectAllSegments(c));
      if (allSegs.length > 0) {
        const starts = allSegs.map((s: any) => s.startDate);
        const ends = allSegs.map((s: any) => s.endDate);
        task.effectiveStartDate = starts.reduce((a: string, b: string) => (a < b ? a : b));
        task.effectiveEndDate = ends.reduce((a: string, b: string) => (a > b ? a : b));
        // 상위 태스크 진행률은 항상 직계 자식 평균으로 계산 (수동 입력 불가)
        const avg = children.reduce((sum: number, c: any) => sum + c.overallProgress, 0) / children.length;
        task.overallProgress = Math.round(avg * 10) / 10;
      }

      // 상태 롤업: 자식 상태 기반으로 부모 상태 결정
      const statuses = children.map((c: any) => c.status);
      if (statuses.some((s: string) => s === "BLOCKED")) {
        task.status = "BLOCKED";
      } else if (statuses.some((s: string) => s === "ON_HOLD")) {
        task.status = "ON_HOLD";
      } else if (statuses.every((s: string) => s === "DONE")) {
        task.status = "DONE";
      } else if (statuses.some((s: string) => s === "DONE" || s === "IN_PROGRESS")) {
        task.status = "IN_PROGRESS";
      } else {
        task.status = "TODO";
      }

      // 자원: 모든 하위 자원 집계 (부모 자신 자원 포함)
      task._rolledUpResources = Array.from(collectAllResources(task).values());
    }

    for (const t of map.values()) {
      if (!t.parentId || !map.has(t.parentId)) rollup(t);
    }

    return taskList.map((t: any) => map.get(t.id) ?? t);
  })();

  // 자식이 있는 태스크 ID 집합 (진행률 수동 입력 차단용)
  const parentTaskIds = new Set<string>(
    (ganttData?.tasks ?? []).filter((t: any) => t.parentId).map((t: any) => t.parentId)
  );

  // 계층 트리 구성 → flat display list
  const flatItems: { task: any; depth: number }[] = (() => {
    const taskList: any[] = rolledUpTasks;
    const map = new Map(taskList.map((t: any) => [t.id, t])); // rolledUpTasks already has _children
    const roots: any[] = taskList.filter((t: any) => !t.parentId || !map.has(t.parentId));
    const sortFn = (arr: any[]) => [...arr].sort((a: any, b: any) => a.sortOrder - b.sortOrder);
    const flatten = (nodes: any[], depth: number): { task: any; depth: number }[] => {
      const result: { task: any; depth: number }[] = [];
      for (const n of sortFn(nodes)) {
        result.push({ task: n, depth });
        if (n._children.length > 0 && !collapsed.has(n.id)) {
          result.push(...flatten(n._children, depth + 1));
        }
      }
      return result;
    };
    return flatten(roots, 0);
  })();

  const handleTaskClick = (task: any, e?: React.MouseEvent) => {
    e?.stopPropagation?.();
    if (e && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setSelected((prev) => {
        const n = new Set(prev);
        if (n.has(task.id)) n.delete(task.id); else n.add(task.id);
        return n;
      });
      lastSelectedRef.current = task.id;
      return;
    }
    if (e && e.shiftKey && lastSelectedRef.current) {
      e.preventDefault();
      const ids = flatItems.map((fi) => fi.task.id);
      const a = ids.indexOf(lastSelectedRef.current);
      const b = ids.indexOf(task.id);
      const [lo, hi] = [Math.min(a, b), Math.max(a, b)];
      setSelected(new Set(ids.slice(lo, hi + 1)));
      return;
    }
    lastSelectedRef.current = task.id;
    // 같은 태스크 재클릭 시 토글
    if (selectedTask?.id === task.id) {
      setSelectedTask(null);
      return;
    }
    const fullTask = tasks.find((t: any) => t.id === task.id) ?? task;
    setSelectedTask(fullTask);
  };


  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === flatItems.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(flatItems.map((fi) => fi.task.id)));
    }
  };

  // 들여쓰기: 첫 선택 태스크 바로 위 항목을 공통 부모로 고정
  const handleIndent = async () => {
    const flatIds = flatItems.map((fi) => fi.task.id);
    const selInOrder = flatIds.filter((id) => selected.has(id));
    if (selInOrder.length === 0) return;

    // 첫 선택 항목 바로 위 = 공통 부모
    const firstIdx = flatIds.indexOf(selInOrder[0]);
    if (firstIdx <= 0) return;
    const newParentId = flatItems[firstIdx - 1].task.id;

    // 선택된 모든 태스크를 동일한 부모로 일괄 처리
    await Promise.all(
      selInOrder.map((id) => taskApi.update(projectId, id, { parentId: newParentId }).catch(() => {}))
    );
    await load();
    setSelected(new Set());
  };

  // 내어쓰기: 첫 선택 태스크의 부모 기준으로 공통 목표 레벨 결정
  const handleOutdent = async () => {
    const taskMap = new Map((ganttData?.tasks ?? []).map((t: any) => [t.id, t as any]));
    const flatIds = flatItems.map((fi) => fi.task.id);
    const selInOrder = flatIds.filter((id) => selected.has(id));
    if (selInOrder.length === 0) return;

    // 첫 선택 태스크의 부모 → 그 부모의 부모를 공통 목표로
    const firstTask = taskMap.get(selInOrder[0]) as any;
    const newParentId = firstTask?.parentId
      ? ((taskMap.get(firstTask.parentId) as any)?.parentId ?? null)
      : null;

    await Promise.all(
      selInOrder.map((id) => taskApi.update(projectId, id, { parentId: newParentId }).catch(() => {}))
    );
    await load();
    setSelected(new Set());
  };


  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-32">
          <div className="animate-spin w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full" />
        </div>
      </AppLayout>
    );
  }

  if (error) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-32 text-center">
          <div>
            <p className="text-red-600 mb-4">{error}</p>
            <button onClick={() => router.push("/projects")} className="text-blue-600 hover:underline">
              프로젝트 목록으로
            </button>
          </div>
        </div>
      </AppLayout>
    );
  }

  const project = ganttData?.project;
  const tasks: any[] = rolledUpTasks;
  const st = project ? (STATUS_LABELS[project.status] ?? STATUS_LABELS.PLANNING) : null;
  const criticalCount = tasks.filter((t) => t.isCritical).length;
  // GanttChart용: rolled-up tasks + 숨겨진 구간 필터 적용
  const computedGanttData = ganttData ? {
    ...ganttData,
    tasks: tasks.map((t: any) => ({
      ...t,
      segments: (t.segments ?? []).filter((s: any) => !hiddenSegIds.has(s.id)),
    })),
  } : null;
  // 선택된 태스크가 상위 태스크(하위 태스크 보유)인지 여부
  const selectedTaskIsParent = selectedTask
    ? (ganttData?.tasks ?? []).some((t: any) => t.parentId === selectedTask.id)
    : false;

  // 헤더 요약 계산
  const uniqueWorkers: { id: string; name: string }[] = (() => {
    const map = new Map<string, string>();
    for (const t of tasks) {
      for (const seg of t.segments ?? []) {
        for (const a of seg.assignments ?? []) {
          if (a.resourceId && a.resourceName) map.set(a.resourceId, a.resourceName);
        }
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  })();

  const totalWorkDays = (() => {
    let days = 0;
    for (const t of tasks) {
      for (const seg of t.segments ?? []) {
        if (seg.startDate && seg.endDate) {
          const diff = Math.round((new Date(seg.endDate).getTime() - new Date(seg.startDate).getTime()) / 86400000) + 1;
          if (diff > 0) days += diff;
        }
      }
    }
    return days;
  })();

  const doneCount = tasks.filter((t) => t.status === "DONE").length;
  const nonMilestoneTasks = tasks.filter((t) => !t.isMilestone);

  return (
    <AppLayout>
      {/* 태스크 상세창 외부 클릭 시 닫기 — TaskDrawer/오버레이는 아래에서 별도 렌더링 */}
      <div className="min-h-screen" onClick={() => selectedTask && setSelectedTask(null)}>
      {/* Project header — 1줄 */}
      <div className="bg-white border-b border-gray-200 px-6 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          {/* 뒤로 */}
          <button onClick={() => router.push("/projects")} className="text-gray-400 hover:text-gray-600 text-sm shrink-0">← 목록</button>
          <div className="h-4 w-px bg-gray-200 shrink-0" />

          {/* 프로젝트명 + 상태 — 클릭 시 스위처 */}
          <div className="relative shrink-0" ref={pickerRef}>
            <button
              onClick={() => { setShowProjectPicker((v) => !v); setProjectSearch(""); }}
              className="flex items-center gap-1 font-bold text-gray-900 hover:text-blue-600 transition-colors max-w-[200px]"
            >
              <span className="truncate">{project?.name}</span>
              <span className="text-gray-400 text-xs">{showProjectPicker ? "▲" : "▼"}</span>
            </button>
            {showProjectPicker && (
              <div className="absolute top-full left-0 mt-1 w-72 bg-white rounded-xl shadow-lg border border-gray-200 z-50 overflow-hidden">
                <div className="p-2 border-b border-gray-100">
                  <input
                    autoFocus
                    type="text"
                    placeholder="프로젝트 검색..."
                    value={projectSearch}
                    onChange={(e) => setProjectSearch(e.target.value)}
                    className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <ul className="max-h-64 overflow-y-auto py-1">
                  {allProjects
                    .filter((p: any) => p.name.toLowerCase().includes(projectSearch.toLowerCase()))
                    .map((p: any) => {
                      const pst = STATUS_LABELS[p.status];
                      return (
                        <li key={p.id}>
                          <button
                            onClick={() => { setShowProjectPicker(false); setProjectSearch(""); router.push(`/projects/${p.id}`); }}
                            className={`w-full text-left px-4 py-2 text-sm hover:bg-blue-50 flex items-center gap-2 ${p.id === projectId ? "bg-blue-50 font-semibold text-blue-700" : "text-gray-700"}`}
                          >
                            <span className="flex-1 truncate">{p.name}</span>
                            {pst && <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${pst.color}`}>{pst.label}</span>}
                          </button>
                        </li>
                      );
                    })}
                  {allProjects.filter((p: any) => p.name.toLowerCase().includes(projectSearch.toLowerCase())).length === 0 && (
                    <li className="px-4 py-3 text-sm text-gray-400 text-center">검색 결과 없음</li>
                  )}
                </ul>
              </div>
            )}
          </div>
          {st && <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${st.color}`}>{st.label}</span>}

          {/* 구분 */}
          <div className="h-4 w-px bg-gray-200 shrink-0" />

          {/* 날짜 */}
          {project?.effectiveStartDate && (
            <span className="text-xs text-gray-500 shrink-0 whitespace-nowrap">
              {project.effectiveStartDate} ~ {project.effectiveEndDate}
            </span>
          )}

          {/* 진행률 */}
          {project?.overallProgress !== undefined && (
            <span className="flex items-center gap-1 shrink-0">
              <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full" style={{ width: `${project.overallProgress}%` }} />
              </div>
              <span className="text-xs text-gray-500">{project.overallProgress.toFixed(0)}%</span>
            </span>
          )}

          {/* 통계 */}
          <span className="text-[11px] text-gray-400 shrink-0 whitespace-nowrap">
            태스크 {nonMilestoneTasks.length} · 완료 {doneCount}
            {criticalCount > 0 && <span className="text-red-500"> · 크리티컬 {criticalCount}</span>}
          </span>

          {/* 작업시간 */}
          {totalWorkDays > 0 && (
            <span className="text-[11px] text-gray-400 shrink-0">⏱ {totalWorkDays}일</span>
          )}

          {/* 작업자 아바타 */}
          {uniqueWorkers.length > 0 && (
            <span className="flex items-center gap-1 shrink-0">
              <span className="flex items-center -space-x-1.5">
                {uniqueWorkers.slice(0, 4).map((w) => (
                  <div key={w.id} title={w.name}
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold ring-1 ring-white ${avatarColor(w.name)}`}>
                    {w.name.slice(0, 2)}
                  </div>
                ))}
                {uniqueWorkers.length > 4 && (
                  <div className="w-5 h-5 rounded-full bg-gray-300 flex items-center justify-center text-white text-[9px] font-bold ring-1 ring-white">
                    +{uniqueWorkers.length - 4}
                  </div>
                )}
              </span>
              <span className="text-[11px] text-gray-400">{uniqueWorkers.length}명</span>
            </span>
          )}

          {/* CPM 결과 */}
          {cpmResult && (
            <span className="text-[11px] bg-orange-50 border border-orange-200 text-orange-700 px-2 py-0.5 rounded-full shrink-0">
              🔴 크리티컬 {criticalCount}개
              <button onClick={() => setCpmResult(null)} className="ml-1 text-orange-400 hover:text-orange-600">×</button>
            </span>
          )}

          {/* 우측 액션 */}
          <div className="ml-auto flex items-center gap-2 shrink-0">
            <select
              value={project?.status ?? "PLANNING"}
              onChange={(e) => handleStatusChange(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {Object.entries(STATUS_LABELS).map(([v, { label }]) => (
                <option key={v} value={v}>{label}</option>
              ))}
            </select>
            <button
              onClick={handleRunCpm}
              disabled={runningCpm || tasks.length === 0}
              className="text-sm px-3 py-1 border border-orange-300 text-orange-700 rounded-lg hover:bg-orange-50 disabled:opacity-40 font-medium"
            >
              {runningCpm ? "⏳..." : "🔴 CPM"}
            </button>
            {/* Baseline selector */}
            {baselines.length > 0 && (
              <select
                value={activeBaselineId ?? ""}
                onChange={(e) => setActiveBaselineId(e.target.value || null)}
                className="text-sm border border-amber-300 text-amber-700 rounded-lg px-2 py-1 focus:outline-none"
                title="기준선 오버레이"
              >
                <option value="">기준선 없음</option>
                {baselines.map((b: any) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            )}
            <button
              onClick={() => setShowImpactPanel(true)}
              className="text-sm px-3 py-1 border border-purple-300 text-purple-700 rounded-lg hover:bg-purple-50 font-medium"
              title="영향 분석"
            >
              영향 분석
            </button>
            <button
              onClick={() => setShowTemplateWizard(true)}
              className="text-sm px-3 py-1 border border-green-300 text-green-700 rounded-lg hover:bg-green-50 font-medium"
              title="템플릿에서 태스크 추가"
            >
              템플릿 적용
            </button>
            <button
              onClick={() => {
                setSaveTplName(project?.name ?? "");
                setSaveTplCategory("");
                setSaveTplIncludeAssignments(false);
                setSaveTplError("");
                setShowSaveTemplate(true);
              }}
              className="text-sm px-3 py-1 border border-orange-300 text-orange-700 rounded-lg hover:bg-orange-50 font-medium"
              title="현재 프로젝트를 템플릿으로 저장"
            >
              템플릿 저장
            </button>
            <button
              onClick={() => setShowAddTask(true)}
              className="bg-blue-600 text-white px-4 py-1 rounded-lg text-sm font-semibold hover:bg-blue-700"
            >
              + 태스크
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200 px-6 flex gap-1">
        {(["gantt", "tasks", "activity"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => handleTabChange(tab)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab === "gantt" ? "📊 간트 차트"
              : tab === "tasks" ? "📋 태스크 목록"
              : "🕐 활동 피드"}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="p-6">
        {/* ── Gantt ── */}
        {activeTab === "gantt" && (
          tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="text-5xl mb-4">📊</div>
              <p className="text-gray-500 mb-4">태스크를 추가하면 간트 차트가 표시됩니다.</p>
              <button onClick={() => setShowAddTask(true)}
                className="bg-blue-600 text-white px-6 py-2.5 rounded-lg font-semibold hover:bg-blue-700">
                첫 태스크 추가
              </button>
            </div>
          ) : (
            <div>
              {/* 타임라인 표시 범위 설정 */}
              <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                {/* 빠른 선택 버튼 */}
                {[
                  { label: "지난주",     range: () => ganttWeekRange(-1) },
                  { label: "이번주",     range: () => ganttWeekRange(0) },
                  { label: "다음주",     range: () => ganttWeekRange(1) },
                  { label: "이번주+다음주", range: () => { const a = ganttWeekRange(0); const b = ganttWeekRange(1); return { start: a.start, end: b.end }; } },
                  { label: "이번달",     range: () => ganttMonthRange(0) },
                ].map(({ label, range }) => (
                  <button key={label} onClick={() => { const r = range(); setViewStart(r.start); setViewEnd(r.end); }}
                    className="text-[11px] px-2 py-0.5 rounded border border-gray-200 text-gray-500 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-600 transition-colors whitespace-nowrap">
                    {label}
                  </button>
                ))}
                <div className="h-3 w-px bg-gray-200 mx-0.5" />
                <span className="text-[11px] text-gray-400">범위</span>
                <DateInput value={viewStart} onChange={setViewStart} className="text-[11px]" />
                <span className="text-[11px] text-gray-300">~</span>
                <DateInput value={viewEnd} onChange={setViewEnd} className="text-[11px]" />
                <button onClick={() => {
                  setViewStart(ganttData?.project?.effectiveStartDate || "");
                  setViewEnd(ganttData?.project?.effectiveEndDate || "");
                }} className="text-[11px] text-gray-400 hover:text-gray-600 px-1.5 py-0.5 rounded hover:bg-gray-100">
                  초기화
                </button>
                <span className="text-[11px] text-gray-300 ml-auto">👆 바 클릭 시 상세 편집</span>
              </div>
              <GanttChart
                data={computedGanttData!}
                flatItems={flatItems}
                viewStart={viewStart || undefined}
                viewEnd={viewEnd || undefined}
                onTaskClick={(task) => { if (selectedTask?.id === task.id) { setSelectedTask(null); } else { handleTaskClick(task); } }}
                baselineSegments={baselineSegments.length > 0 ? baselineSegments : undefined}
                allResources={resources}
                onRefresh={load}
                projectId={projectId}
              />
            </div>
          )
        )}

        {/* ── Tasks ── */}
        {activeTab === "tasks" && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {/* Multi-select toolbar */}
            {selected.size > 0 && (
              <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 border-b border-blue-100">
                <span className="text-xs font-semibold text-blue-700">{selected.size}개 선택됨</span>
                <span className="text-[10px] text-blue-400">— 드래그 핸들(⠿)로 이동</span>
                <div className="h-3 w-px bg-blue-200" />
                <button onClick={handleOutdent}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:bg-white rounded border border-gray-200" title="내어쓰기 (레벨 올리기)">
                  ← 내어쓰기
                </button>
                <button onClick={handleIndent}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:bg-white rounded border border-gray-200" title="들여쓰기 (레벨 내리기)">
                  → 들여쓰기
                </button>
                <div className="ml-auto flex items-center gap-2">
                  <button onClick={handleDeleteSelected}
                    className="flex items-center gap-1 px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded border border-red-200">
                    🗑 선택 삭제
                  </button>
                  <button onClick={() => setSelected(new Set())}
                    className="text-xs text-gray-400 hover:text-gray-600">선택 해제</button>
                </div>
              </div>
            )}

            <table className="w-full text-sm select-none">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="w-6" />
                  <th className="px-3 py-2 w-8" onClick={toggleAll}>
                    <input type="checkbox" readOnly
                      checked={selected.size === flatItems.length && flatItems.length > 0}
                      className="cursor-pointer" />
                  </th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-600 text-xs">태스크명</th>
                  {colOrder.map((col) => {
                    const cfg = COL_CFG[col];
                    const isDraggingThis = colDragging === col;
                    const gapBefore = colDropGap !== null && colDropGap.id === col && colDropGap.pos === "before";
                    const gapAfter  = colDropGap !== null && colDropGap.id === col && colDropGap.pos === "after";
                    return (
                      <th
                        key={col}
                        draggable
                        onDragStart={(e) => handleColDragStart(e, col)}
                        onDragOver={(e) => handleColDragOver(e, col)}
                        onDrop={(e) => handleColDrop(e, col)}
                        onDragEnd={() => { setColDragging(null); setColDropGap(null); }}
                        className={[
                          `text-left px-3 py-2 font-semibold text-xs cursor-grab select-none ${cfg.width}`,
                          isDraggingThis ? "opacity-40" : "text-gray-600",
                          gapBefore ? "border-l-2 border-l-blue-500" : "",
                          gapAfter  ? "border-r-2 border-r-blue-500" : "",
                        ].join(" ")}
                        title="드래그로 열 순서 변경"
                      >
                        {cfg.label}
                      </th>
                    );
                  })}
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {flatItems.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-12 text-gray-400">태스크가 없습니다.</td></tr>
                ) : flatItems.map(({ task, depth }) => {
                  const hasChildren = task._children?.length > 0;
                  const isCollapsed = collapsed.has(task.id);
                  const isSel = selected.has(task.id);
                  const isDragging = dragIds.includes(task.id);
                  const gapBefore = dropGap !== null && dropGap.taskId === task.id && dropGap.pos === "before";
                  const gapAfter  = dropGap !== null && dropGap.taskId === task.id && dropGap.pos === "after";
                  const isEditStatus   = editingCell !== null && editingCell.taskId === task.id && editingCell.col === "status";
                  const isEditDates    = editingCell !== null && editingCell.taskId === task.id && editingCell.col === "dates";
                  return (
                    <Fragment key={task.id}>
                    <tr
                      style={{ height: 36 }}
                      onDragOver={(e) => handleRowDragOver(e, task.id)}
                      onDrop={handleRowDrop}
                      onDragEnd={clearDragState}
                      className={[
                        "border-b border-gray-100 cursor-pointer transition-colors group/row",
                        isDragging ? "opacity-30" : "",
                        isSel ? "bg-blue-50" : "hover:bg-gray-50/60",
                        gapBefore ? "border-t-2 border-t-blue-500" : "",
                        gapAfter  ? "border-b-2 border-b-blue-500" : "",
                      ].join(" ")}
                    >
                      {/* 드래그 핸들 */}
                      <td className="pl-1.5 w-6" onClick={(e) => e.stopPropagation()}>
                        <div
                          draggable
                          onDragStart={(e) => { e.stopPropagation(); handleDragStart(e, task.id); }}
                          className="text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing flex items-center justify-center w-5 h-5 rounded hover:bg-gray-100"
                          title="드래그로 순서 변경"
                        >
                          <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
                            <circle cx="3" cy="2.5" r="1.2"/><circle cx="7" cy="2.5" r="1.2"/>
                            <circle cx="3" cy="7"   r="1.2"/><circle cx="7" cy="7"   r="1.2"/>
                            <circle cx="3" cy="11.5" r="1.2"/><circle cx="7" cy="11.5" r="1.2"/>
                          </svg>
                        </div>
                      </td>
                      {/* 체크박스 */}
                      <td className="px-2 text-center" onClick={(e) => toggleSelect(task.id, e)}>
                        <input type="checkbox" readOnly checked={isSel} className="cursor-pointer" />
                      </td>
                      {/* 태스크명 */}
                      <td className="px-2 cursor-pointer hover:bg-blue-50/60" onClick={(e) => handleTaskClick(task, e)}>
                        <div className="flex items-center" style={{ paddingLeft: depth * 16 }}>
                          {hasChildren ? (
                            <button
                              onClick={(e) => { e.stopPropagation(); setCollapsed((prev) => { const n = new Set(prev); if (n.has(task.id)) n.delete(task.id); else n.add(task.id); return n; }); }}
                              className="w-4 h-4 text-gray-400 hover:text-gray-700 mr-1 text-[10px] leading-none flex items-center justify-center shrink-0"
                            >
                              {isCollapsed ? "▶" : "▼"}
                            </button>
                          ) : (
                            <span className="w-4 h-4 mr-1 flex items-center justify-center shrink-0">
                              {depth > 0 && <span className="w-2 h-px bg-gray-300 inline-block" />}
                            </span>
                          )}
                          <span className={`text-xs font-medium truncate ${task.isMilestone ? "text-purple-700" : task.isCritical ? "text-red-600" : depth === 0 ? "text-gray-900" : "text-gray-600"}`}>
                            {task.isMilestone && <span className="mr-1 text-purple-400">◆</span>}
                            {task.name}
                          </span>
                          {task.commentCount > 0 && (
                            <span className="ml-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                              <CommentPopover taskId={task.id} count={task.commentCount} />
                            </span>
                          )}
                          {!task.isMilestone && task.milestoneName && (
                            <span className="ml-1.5 text-[10px] text-gray-400 shrink-0">📌 {task.milestoneName}</span>
                          )}
                        </div>
                      </td>

                      {/* 가변 컬럼 — colOrder 순서대로 */}
                      {colOrder.map((col) => {
                        if (col === "status") return (
                          <td key="status" className="px-2"
                            onClick={(e) => { if (task.isMilestone || parentTaskIds.has(task.id)) return; e.stopPropagation(); startEdit(task.id, "status", task.status); }}>
                            {task.isMilestone ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-purple-100 text-purple-700">마일스톤</span>
                            ) : isEditStatus ? (
                              <select autoFocus value={editVal}
                                onChange={(e) => saveStatus(task.id, e.target.value)}
                                onBlur={cancelEdit}
                                onKeyDown={(e) => e.key === "Escape" && cancelEdit()}
                                onClick={(e) => e.stopPropagation()}
                                className="text-[10px] w-full border border-blue-400 rounded px-1 py-0.5 bg-white focus:outline-none">
                                {Object.entries(TASK_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                              </select>
                            ) : (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium cursor-pointer hover:opacity-75 ${TASK_STATUS_COLORS[task.status] ?? ""}`}>
                                {TASK_STATUS_LABELS[task.status] ?? task.status}
                              </span>
                            )}
                          </td>
                        );
                        if (col === "dates") return (
                          <td key="dates" className="px-3 text-[11px]"
                            onClick={(e) => { if (task.isMilestone) return; e.stopPropagation(); startEdit(task.id, "dates", { start: task.effectiveStartDate ?? "", end: task.effectiveEndDate ?? "" }); }}>
                            {task.isMilestone ? (
                              task.effectiveStartDate
                                ? <span className="text-purple-600 font-medium">{task.effectiveStartDate}</span>
                                : <span className="text-gray-300">날짜 없음</span>
                            ) : (
                              <span className={`cursor-pointer hover:text-blue-600 transition-colors ${task.effectiveStartDate ? "text-gray-500" : "text-gray-300"}`}>
                                {task.effectiveStartDate ? `${task.effectiveStartDate} ~ ${task.effectiveEndDate}` : "일정 없음"}
                              </span>
                            )}
                          </td>
                        );
                        if (col === "progress") return (
                          <td key="progress" className="px-3">
                            {task.isMilestone ? (
                              <div className="flex items-center gap-1.5" title="하위 태스크 평균 진행율">
                                <div className="w-14 h-1 bg-gray-200 rounded-full overflow-hidden">
                                  <div className="h-full bg-purple-400 rounded-full" style={{ width: `${task.overallProgress ?? 0}%` }} />
                                </div>
                                <span className="text-[11px] text-purple-500 tabular-nums">{(task.overallProgress ?? 0).toFixed(0)}%</span>
                              </div>
                            ) : parentTaskIds.has(task.id) ? (
                              // 상위 태스크: 하위 평균 자동 계산
                              <div className="flex items-center gap-1.5" title="하위 태스크 평균으로 자동 계산됩니다">
                                <div className="w-14 h-1 bg-gray-200 rounded-full overflow-hidden">
                                  <div className="h-full bg-indigo-400 rounded-full" style={{ width: `${task.overallProgress}%` }} />
                                </div>
                                <span className="text-[11px] text-gray-400 tabular-nums">{task.overallProgress.toFixed(0)}%</span>
                              </div>
                            ) : (
                              // 리프 태스크: 구간 평균 자동 계산
                              <div className="flex items-center gap-1.5" title="구간별 진행율 평균으로 자동 계산됩니다">
                                <div className="w-14 h-1 bg-gray-200 rounded-full overflow-hidden">
                                  <div className="h-full bg-blue-500 rounded-full" style={{ width: `${task.overallProgress}%` }} />
                                </div>
                                <span className="text-[11px] text-gray-500 tabular-nums">{task.overallProgress.toFixed(0)}%</span>
                              </div>
                            )}
                          </td>
                        );
                        if (col === "resources") return (
                          <td key="resources" className="px-3" onClick={(e) => e.stopPropagation()}>
                            <ResourcePickerPopover
                              task={task}
                              projectId={projectId}
                              allResources={resources}
                              onRefresh={load}
                              displayResources={parentTaskIds.has(task.id) ? (task._rolledUpResources ?? []) : undefined}
                            />
                          </td>
                        );
                        if (col === "note") {
                          const isEditNote = editingCell !== null && editingCell.taskId === task.id && editingCell.col === "note";
                          return (
                            <td key="note" className="px-2"
                              onClick={(e) => { e.stopPropagation(); if (!isEditNote) { setEditingCell({ taskId: task.id, col: "note" }); setEditVal(task.description ?? ""); } }}
                            >
                              {isEditNote ? (
                                <input
                                  autoFocus
                                  type="text"
                                  value={editVal}
                                  onChange={(e) => setEditVal(e.target.value)}
                                  onKeyDown={(e) => { if (e.key === "Enter") saveNote(task.id, editVal); if (e.key === "Escape") cancelEdit(); }}
                                  onBlur={() => saveNote(task.id, editVal)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="w-full text-[11px] border border-blue-400 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                  placeholder="비고 입력..."
                                />
                              ) : task.description ? (
                                <span className="text-[11px] text-gray-600 truncate block max-w-[120px]" title={task.description}>{task.description}</span>
                              ) : (
                                <span className="text-[11px] text-gray-300 hover:text-gray-400">—</span>
                              )}
                            </td>
                          );
                        }
                        return null;
                      })}
                      <td className="px-1 text-center" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => handleDeleteTask(task.id, task.name)}
                          className="text-gray-300 hover:text-red-500 text-xs opacity-0 group-hover/row:opacity-100" title="삭제">🗑</button>
                      </td>
                    </tr>

                    {/* 기간 편집 확장 행 */}
                    {isEditDates && (
                      <tr className="bg-blue-50 border-b border-blue-100">
                        <td colSpan={9} className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-3">
                            <span className="text-[11px] text-gray-500 shrink-0">기간 수정</span>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] text-gray-400">시작</span>
                              <DateInput value={editVal.start} onChange={(v) => setEditVal((prev: any) => ({ ...prev, start: v }))} />
                            </div>
                            <span className="text-[10px] text-gray-300">~</span>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] text-gray-400">종료</span>
                              <DateInput value={editVal.end} onChange={(v) => setEditVal((prev: any) => ({ ...prev, end: v }))} />
                            </div>
                            <button
                              onClick={() => saveDates(task, editVal.start, editVal.end)}
                              className="text-[11px] bg-blue-600 text-white rounded px-3 py-1 hover:bg-blue-700 font-medium"
                            >저장</button>
                            <button
                              onClick={cancelEdit}
                              className="text-[11px] bg-gray-100 text-gray-600 rounded px-3 py-1 hover:bg-gray-200"
                            >취소</button>
                            {task.segments?.length > 1 && (
                              <span className="text-[10px] text-gray-400 ml-2">※ 세그먼트 {task.segments.length}개 — 첫/마지막 세그먼트의 시작/종료일이 변경됩니다</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            {/* 인라인 태스크 추가 행 */}
            <div className="border-t border-gray-100">
              <div className="flex items-center gap-2 px-3 py-1.5">
                <span className="text-gray-300 text-xs w-4 shrink-0">+</span>
                <input
                  type="text"
                  value={inlineTaskName}
                  onChange={(e) => setInlineTaskName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); createInlineTask(); }
                    if (e.key === "Escape") { setInlineTaskName(""); }
                  }}
                  onBlur={createInlineTask}
                  placeholder="태스크 이름 입력 후 Enter..."
                  disabled={inlineAdding}
                  className="flex-1 text-xs text-gray-600 placeholder-gray-300 bg-transparent focus:outline-none disabled:opacity-50"
                />
                {inlineAdding && <span className="text-xs text-gray-400">저장 중...</span>}
              </div>
            </div>
          </div>
        )}

        {/* ── Activity ── */}
        {activeTab === "activity" && (() => {
          const ACTION_CFG: Record<string, { icon: string; label: string; bg: string; text: string }> = {
            "project.created":      { icon: "🏗️", label: "프로젝트 생성",  bg: "bg-gray-100",   text: "text-gray-600" },
            "project.updated":      { icon: "✏️", label: "프로젝트 수정",  bg: "bg-gray-100",   text: "text-gray-600" },
            TASK_CREATED:           { icon: "➕", label: "태스크 추가",    bg: "bg-green-100",  text: "text-green-700" },
            MILESTONE_CREATED:      { icon: "📌", label: "마일스톤 추가",  bg: "bg-purple-100", text: "text-purple-700" },
            TASK_DELETED:           { icon: "🗑️", label: "태스크 삭제",    bg: "bg-red-100",    text: "text-red-700" },
            TASK_RENAMED:           { icon: "✏️", label: "이름 변경",      bg: "bg-blue-100",   text: "text-blue-700" },
            TASK_NOTE_CHANGED:      { icon: "📝", label: "비고 변경",      bg: "bg-blue-100",   text: "text-blue-700" },
            TASK_STATUS_CHANGED:    { icon: "🔄", label: "상태 변경",      bg: "bg-yellow-100", text: "text-yellow-700" },
            TASK_PROGRESS_CHANGED:  { icon: "📊", label: "진도율 변경",    bg: "bg-indigo-100", text: "text-indigo-700" },
            TASK_SCHEDULE_CHANGED:  { icon: "📅", label: "일정 변경",      bg: "bg-teal-100",   text: "text-teal-700" },
            ASSIGNMENT_CHANGED:     { icon: "👤", label: "자원 배정",      bg: "bg-violet-100", text: "text-violet-700" },
            ASSIGNMENT_REMOVED:     { icon: "👤", label: "자원 해제",      bg: "bg-violet-100", text: "text-violet-700" },
            COMMENT_CREATED:        { icon: "💬", label: "댓글 작성",      bg: "bg-cyan-100",   text: "text-cyan-700" },
            COMMENT_UPDATED:        { icon: "💬", label: "댓글 수정",      bg: "bg-cyan-100",   text: "text-cyan-700" },
            COMMENT_DELETED:        { icon: "💬", label: "댓글 삭제",      bg: "bg-cyan-100",   text: "text-cyan-700" },
            ATTACHMENT_UPLOADED:    { icon: "📎", label: "파일 첨부",      bg: "bg-orange-100", text: "text-orange-700" },
            ATTACHMENT_DELETED:     { icon: "📎", label: "파일 삭제",      bg: "bg-orange-100", text: "text-orange-700" },
          };

          const timeAgo = (iso: string) => {
            const diff = Date.now() - new Date(iso).getTime();
            const m = Math.floor(diff / 60000);
            if (m < 1) return "방금 전";
            if (m < 60) return `${m}분 전`;
            const h = Math.floor(m / 60);
            if (h < 24) return `${h}시간 전`;
            const d = Math.floor(h / 24);
            if (d < 7) return `${d}일 전`;
            return new Date(iso).toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
          };

          // 날짜별 그룹
          const grouped: { date: string; items: any[] }[] = [];
          for (const a of activities) {
            const date = new Date(a.createdAt).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
            const last = grouped[grouped.length - 1];
            if (last?.date === date) last.items.push(a);
            else grouped.push({ date, items: [a] });
          }

          return (
            <div className="max-w-2xl">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-gray-400">최근 활동 {activities.length}건</span>
                <button onClick={loadActivities} className="text-xs text-blue-500 hover:underline">새로고침</button>
              </div>

              {activities.length === 0 ? (
                <div className="text-center py-16 text-gray-400 bg-white rounded-xl border border-dashed border-gray-200">
                  <div className="text-3xl mb-2">🕐</div>
                  <p className="text-sm">활동 내역이 없습니다.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {grouped.map(({ date, items }) => (
                    <div key={date}>
                      <div className="flex items-center gap-2 mb-2">
                        <div className="h-px flex-1 bg-gray-200" />
                        <span className="text-[11px] text-gray-400 shrink-0">{date}</span>
                        <div className="h-px flex-1 bg-gray-200" />
                      </div>
                      <div className="space-y-1.5">
                        {items.map((a: any) => {
                          const cfg = ACTION_CFG[a.action] ?? { icon: "📋", label: a.action, bg: "bg-gray-100", text: "text-gray-600" };
                          const meta: any = typeof a.metadata === "object" && a.metadata !== null ? a.metadata : {};
                          const projectName = ganttData?.project?.name;
                          return (
                            <div key={a.id} className="flex items-start gap-3 bg-white rounded-xl border border-gray-100 px-4 py-3 hover:border-gray-200 transition-colors">
                              {/* 아이콘 */}
                              <div className={`w-8 h-8 rounded-full ${cfg.bg} flex items-center justify-center text-sm shrink-0`}>
                                {cfg.icon}
                              </div>
                              <div className="flex-1 min-w-0">
                                {/* 액션 + 작성자·시간 + 태스크명 */}
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-full ${cfg.bg} ${cfg.text}`}>
                                    {cfg.label}
                                  </span>
                                  <span className="text-[11px] text-gray-500">
                                    <span className="font-medium text-gray-600">{a.userId}</span>
                                    {" · "}{timeAgo(a.createdAt)}
                                  </span>
                                  {meta.taskName && (
                                    <span className="text-xs font-medium text-gray-800 truncate max-w-[180px]" title={meta.taskName}>
                                      {meta.taskName}
                                    </span>
                                  )}
                                  {projectName && !meta.taskName && (
                                    <span className="text-xs text-gray-500 truncate">{projectName}</span>
                                  )}
                                </div>
                                {/* 상세 내용 */}
                                {(() => {
                                  if (a.action === "COMMENT_CREATED" || a.action === "COMMENT_UPDATED") {
                                    // 1순위: 댓글 직접 조회 결과, 2순위: metadata.content, 3순위: 백엔드 enriched description
                                    const GENERIC = ["댓글 작성", "댓글 수정"];
                                    const text = commentContentMap[a.entityId] || meta.content ||
                                      (a.description && !GENERIC.includes(a.description) ? a.description : null);
                                    return text ? (
                                      <div className="mt-1.5 bg-cyan-50 border-l-2 border-cyan-400 rounded-r-md px-2.5 py-1.5">
                                        <p className="text-xs text-gray-700 break-words line-clamp-3 leading-relaxed" title={text}>
                                          {text}
                                        </p>
                                      </div>
                                    ) : null;
                                  }
                                  if (a.action === "COMMENT_DELETED") {
                                    return <p className="text-xs text-gray-400 mt-0.5 italic">{a.description}</p>;
                                  }
                                  // 프로젝트 수정: 변경 항목을 태그 형태로 표시
                                  if (a.action === "project.updated") {
                                    const changes: string[] = Array.isArray(meta.changes) ? meta.changes : [];
                                    if (changes.length > 0) {
                                      return (
                                        <div className="mt-1.5 flex flex-wrap gap-1">
                                          {changes.map((c: string, i: number) => (
                                            <span key={i} className="text-[11px] bg-gray-100 text-gray-600 rounded px-1.5 py-0.5 border border-gray-200">
                                              {c}
                                            </span>
                                          ))}
                                        </div>
                                      );
                                    }
                                    // 구형 generic 메시지("프로젝트 [...]이 수정되었습니다.") 는 표시하지 않음
                                    const isGeneric = !a.description || /^프로젝트\s*\[.+\]이?\s*수정되었습니다/.test(a.description);
                                    if (isGeneric) return null;
                                    return (
                                      <p className="text-xs text-gray-500 mt-0.5" title={a.description}>{a.description}</p>
                                    );
                                  }
                                  // 태스크 수정: 태스크명 + 변경 내용
                                  if (a.description) {
                                    return (
                                      <p className="text-xs text-gray-600 mt-0.5 truncate" title={a.description}>
                                        {a.description}
                                      </p>
                                    );
                                  }
                                  return null;
                                })()}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {showAddTask && (
        <AddTaskModal
          projectId={projectId}
          defaultParentId={flatItems[flatItems.length - 1]?.task?.parentId ?? null}
          defaultSortOrder={(() => {
            const allTasks: any[] = ganttData?.tasks ?? [];
            const lastVisible = flatItems[flatItems.length - 1];
            const parentId = lastVisible?.task?.parentId ?? null;
            const siblings = allTasks.filter((t: any) => (t.parentId ?? null) === parentId);
            return siblings.reduce((m: number, t: any) => Math.max(m, t.sortOrder ?? 0), 0) + 1;
          })()}
          onSuccess={async () => { await load(); refreshActivities(); }}
          onClose={() => setShowAddTask(false)}
        />
      )}

      </div>

      {selectedTask && (
        <TaskDrawer
          task={selectedTask}
          projectId={projectId}
          isParent={selectedTaskIsParent}
          hiddenSegIds={hiddenSegIds}
          onToggleSeg={toggleSegVisibility}
          onClose={() => setSelectedTask(null)}
          onRefresh={async () => {
            await loadSilent();
            refreshActivities();
            const fresh = await projectApi.gantt(projectId);
            const freshTask = (fresh as any).tasks?.find((t: any) => t.id === selectedTask.id);
            if (freshTask) setSelectedTask(freshTask);
          }}
        />
      )}

      {showImpactPanel && (
        <ImpactPanel
          projectId={projectId}
          tasks={tasks.filter((t: any) => !t.isMilestone).map((t: any) => ({ id: t.id, name: t.name }))}
          onClose={() => setShowImpactPanel(false)}
        />
      )}

      {showTemplateWizard && (
        <TemplateWizard
          projectId={projectId}
          onClose={() => setShowTemplateWizard(false)}
          onSuccess={load}
        />
      )}

      {showSaveTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowSaveTemplate(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">템플릿으로 저장</h2>
                <p className="text-xs text-gray-500 mt-0.5">현재 프로젝트 구조를 템플릿으로 저장합니다</p>
              </div>
              <button onClick={() => setShowSaveTemplate(false)} className="text-gray-400 hover:text-gray-600 text-xl font-light">×</button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">템플릿 이름 <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={saveTplName}
                  onChange={(e) => setSaveTplName(e.target.value)}
                  placeholder="템플릿 이름 입력"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">카테고리 <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={saveTplCategory}
                  onChange={(e) => setSaveTplCategory(e.target.value)}
                  placeholder="예: 건설, IT, 제조"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>

              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={saveTplIncludeAssignments}
                  onChange={(e) => setSaveTplIncludeAssignments(e.target.checked)}
                  className="w-4 h-4 rounded accent-orange-500"
                />
                <span className="text-sm text-gray-700">자원 배정 포함</span>
              </label>

              {saveTplError && <p className="text-sm text-red-500">{saveTplError}</p>}
            </div>

            <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100 bg-gray-50">
              <button
                onClick={() => setShowSaveTemplate(false)}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-100"
              >
                취소
              </button>
              <button
                disabled={saveTplLoading}
                onClick={async () => {
                  if (!saveTplName.trim()) { setSaveTplError("템플릿 이름을 입력해주세요."); return; }
                  if (!saveTplCategory.trim()) { setSaveTplError("카테고리를 입력해주세요."); return; }
                  setSaveTplLoading(true);
                  setSaveTplError("");
                  try {
                    await templateApi.saveAsTemplate(projectId, {
                      name: saveTplName.trim(),
                      category: saveTplCategory.trim(),
                      includeAssignments: saveTplIncludeAssignments,
                    });
                    setShowSaveTemplate(false);
                    alert("템플릿으로 저장되었습니다.");
                  } catch (e: any) {
                    setSaveTplError(e.message ?? "저장 실패");
                  } finally {
                    setSaveTplLoading(false);
                  }
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-orange-500 hover:bg-orange-600 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {saveTplLoading ? "저장 중…" : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
