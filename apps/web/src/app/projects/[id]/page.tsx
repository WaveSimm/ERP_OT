"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import clsx from "clsx";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { projectApi, taskApi, resourceApi, baselineApi, commentApi, deploymentApi, userManagementApi, folderApi, listAssignableResources } from "@/lib/api";
import nextDynamic from "next/dynamic";
import { usePermission } from "@/hooks/usePermission";
import { useUndoRedo } from "@/hooks/useUndoRedo";
import { useHolidaysMap } from "@/hooks/useHolidaysMap";
import UndoRedoControls from "@/components/UndoRedoControls";
import AddTaskModal from "@/components/AddTaskModal";
import TaskDrawer from "@/components/TaskDrawer";
import CopyTaskModal from "@/components/CopyTaskModal";
import AppLayout from "@/components/AppLayout";
import ImpactPanel from "@/components/ImpactPanel";
import ProjectSummaryDrawer from "@/components/ProjectSummaryDrawer";
import {
  toStr, adaptGanttData,
  STATUS_LABELS, avatarColor,
  type ColId, COL_CFG, DEFAULT_COL_ORDER,
} from "./_lib";
import EquipmentTab from "./_components/EquipmentTab";
import ActivityTab from "./_components/ActivityTab";
import ProjectPickerDropdown from "./_components/ProjectPickerDropdown";
import GanttRangeBar from "./_components/GanttRangeBar";
import TaskListTable from "./_components/TaskListTable";

const GanttChart = nextDynamic(() => import("@/components/GanttChart"), { ssr: false });

export default function ProjectDetailPage() {
  const router = useRouter();
  const params = useParams();
  const projectId = params.id as string;
  const searchParams = useSearchParams();
  const initialTaskId = searchParams.get("taskId");
  // ?taskId=... 자동 drawer 오픈은 1회만 (사용자가 닫고 다른 작업 후 무한 재오픈 방지)
  const initialTaskAppliedRef = useRef(false);
  const { isManager, isOperator } = usePermission();

  // 회사달력 v1.2 — 한국 공휴일·자체 휴일 (KASI 자동 갱신 포함)
  const holidays = useHolidaysMap();

  const [ganttData, setGanttData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // 프로젝트 스위처
  const [allProjects, setAllProjects] = useState<any[]>([]);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);
  const [pickerFolders, setPickerFolders] = useState<{ id: string; name: string; parentId: string | null }[]>([]);
  const [pickerProjMap, setPickerProjMap] = useState<Record<string, string[]>>({});
  const [pickerOpenFolders, setPickerOpenFolders] = useState<Record<string, boolean>>({});
  const [pickerFolderProjOrder, setPickerFolderProjOrder] = useState<Record<string, string[]>>({});
  const [showAddTask, setShowAddTask] = useState(false);
  const [addAsMilestone, setAddAsMilestone] = useState(false);
  const [selectedTask, setSelectedTask] = useState<any>(null);
  // 프로젝트-관리 PDCA US-32: 태스크 복사 다이얼로그 — 단일 또는 다중 태스크
  const [copyTargets, setCopyTargets] = useState<Array<{ id: string; name: string; projectId: string }> | null>(null);
  const [inlineTaskName, setInlineTaskName] = useState("");
  const [inlineAdding, setInlineAdding] = useState(false);

  type TabType = "gantt" | "tasks" | "activity" | "equipment";
  const TAB_KEY = `erp_tab_${projectId}`;
  const [activeTab, setActiveTab] = useState<TabType>("gantt");
  const [projectDeployments, setProjectDeployments] = useState<any[]>([]);
  const [deploymentsLoading, setDeploymentsLoading] = useState(false);

  useEffect(() => {
    const saved = sessionStorage.getItem(TAB_KEY) as TabType | null;
    if (saved) setActiveTab(saved);
  }, [TAB_KEY]);

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    sessionStorage.setItem(TAB_KEY, tab);
  };
  const [activities, setActivities] = useState<any[]>([]);
  const [activityTick, setActivityTick] = useState(0);
  const [userMap, setUserMap] = useState<Record<string, string>>({});
  const [runningCpm, setRunningCpm] = useState(false);
  const [cpmResult, setCpmResult] = useState<any>(null);

  // Baseline overlay
  const [baselines, setBaselines] = useState<any[]>([]);
  const [activeBaselineId, setActiveBaselineId] = useState<string | null>(null);
  const [baselineSegments, setBaselineSegments] = useState<any[]>([]);

  // Panels
  const [showImpactPanel, setShowImpactPanel] = useState(false);
  const [showSummary, setShowSummary] = useState(false); // 프로젝트 요약 드로어
  // 템플릿 적용/저장 상태는 프로젝트 목록 화면으로 이동 (2026-06-24)

  // Comment content map: commentId → content (for activity feed)
  const [commentContentMap, setCommentContentMap] = useState<Record<string, string>>({});

  // Undo / Redo — undo/redo 실행 후 열린 Drawer도 갱신
  const selectedTaskRef = useRef<any>(null);
  selectedTaskRef.current = selectedTask;
  const [drawerRefreshKey, setDrawerRefreshKey] = useState(0);
  const refreshAfterUndoRedo = useCallback(async () => {
    try {
      const data = adaptGanttData(await projectApi.gantt(projectId));
      setGanttData(data);
      setActivityTick((n) => n + 1);
      setDrawerRefreshKey((k) => k + 1);
      if (selectedTaskRef.current) {
        const fresh = (data as any).tasks?.find((t: any) => t.id === selectedTaskRef.current.id);
        if (fresh) setSelectedTask(fresh);
        else setSelectedTask(null);
      }
    } catch { /* ignore */ }
  }, [projectId]);
  const { push: pushUndo, undo: handleUndo, redo: handleRedo, undoCount, redoCount, undoLabel, redoLabel, toast } =
    useUndoRedo({
      onAfterAction: refreshAfterUndoRedo,
      onError: () => { void refreshAfterUndoRedo(); alert("작업을 되돌리지 못했습니다. 화면을 최신 상태로 새로고침했습니다."); },
    });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = adaptGanttData(await projectApi.gantt(projectId));
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

  // ?taskId=... 자동 drawer 오픈 (홈 → 내 작업 → 태스크 클릭 흐름)
  useEffect(() => {
    if (initialTaskAppliedRef.current) return;
    if (!initialTaskId || !ganttData?.tasks) return;
    const target = (ganttData.tasks as any[]).find((t) => t.id === initialTaskId);
    if (target) {
      setSelectedTask({ ...target, _projectName: ganttData?.project?.name ?? "" });
      initialTaskAppliedRef.current = true;
    }
  }, [initialTaskId, ganttData]);

  // 드로어·인라인 편집용: 스피너 없이 ganttData만 갱신
  const loadSilent = useCallback(async () => {
    try {
      const data = adaptGanttData(await projectApi.gantt(projectId));
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
    const token = localStorage.getItem("erp_user");
    if (!token) { router.push("/login"); return; }
    load();
    projectApi.list().then((r: any) => setAllProjects(r.items ?? [])).catch(() => {});
    userManagementApi.members(true).then((list) => {
      const map: Record<string, string> = {};
      for (const u of list) map[u.id] = u.name;
      setUserMap(map);
    }).catch(() => {});
    // 폴더 데이터: 서버 folderApi 우선 (다른 PC에서도 동일 구조), 실패 시 localStorage fallback
    folderApi.list().then((apiFolders: any[]) => {
      setPickerFolders(apiFolders.map((f: any) => ({ id: f.id, name: f.name, parentId: f.parentId ?? null })));
      const map: Record<string, string[]> = {};
      const order: Record<string, string[]> = {};
      for (const f of apiFolders) {
        const items = (f.projects ?? []).slice().sort((a: any, b: any) => a.sortOrder - b.sortOrder);
        order[f.id] = items.map((it: any) => it.projectId);
        for (const it of items) {
          if (!map[it.projectId]) map[it.projectId] = [];
          map[it.projectId].push(f.id);
        }
      }
      setPickerProjMap(map);
      setPickerFolderProjOrder(order);
    }).catch(() => {
      // fallback — server 호출 실패 시 localStorage (구 동작 유지)
      try {
        const fRaw = localStorage.getItem("erp_folders_v1");
        const rawFolders = fRaw ? JSON.parse(fRaw) : [];
        setPickerFolders(Array.isArray(rawFolders) ? rawFolders : []);
        const mRaw = localStorage.getItem("erp_proj_folder_v2");
        const rawMap = mRaw ? JSON.parse(mRaw) : {};
        const map: Record<string, string[]> = {};
        Object.entries(rawMap ?? {}).forEach(([k, v]) => {
          if (Array.isArray(v)) map[k] = v as string[];
          else if (typeof v === "string") map[k] = [v as string];
        });
        setPickerProjMap(map);
        const oRaw = localStorage.getItem("erp_folder_proj_order_v1");
        setPickerFolderProjOrder(oRaw ? JSON.parse(oRaw) : {});
      } catch {}
    });
  }, [load, router]);

  useEffect(() => {
    if (!showProjectPicker) return;
    // 드롭다운 열릴 때마다 최신 순서 갱신
    try {
      const oRaw = localStorage.getItem("erp_folder_proj_order_v1");
      setPickerFolderProjOrder(oRaw ? JSON.parse(oRaw) : {});
    } catch {}
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

  // 장비 투입 목록 로딩
  useEffect(() => {
    if (activeTab !== "equipment" && activeTab !== "activity") return;
    setDeploymentsLoading(true);
    deploymentApi.list({ projectId }).then((r) => {
      setProjectDeployments((r.items ?? []).filter((d: any) => d.status !== "CANCELLED"));
    }).catch(() => {}).finally(() => setDeploymentsLoading(false));
  }, [activeTab, projectId]);

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
    const oldStatus = ganttData?.project?.status ?? "PLANNING";
    try {
      await projectApi.update(projectId, { status });
      pushUndo({
        label: `프로젝트 상태 "${oldStatus}" → "${status}"`,
        undo: async () => { await projectApi.update(projectId, { status: oldStatus }); },
        redo: async () => { await projectApi.update(projectId, { status }); },
      });
      await load();
      refreshActivities();
    } catch (e: any) {
      alert(e.message ?? "상태 변경 실패");
    }
  };

  const handleDeleteTask = async (taskId: string, taskName: string) => {
    if (!confirm(`"${taskName}" 태스크를 삭제하시겠습니까?`)) return;
    // 삭제 전 태스크 데이터 스냅샷
    const taskData = (ganttData?.tasks ?? []).find((t: any) => t.id === taskId);
    try {
      await taskApi.delete(projectId, taskId);
      if (taskData) {
        pushUndo({
          label: `태스크 "${taskName}" 삭제`,
          undo: async () => {
            // 태스크 재생성 (세그먼트 포함). parentId/description은 null이면 생략 — API는 string|undefined만 허용(null 거부)
            const t = await taskApi.create(projectId, {
              name: taskData.name,
              ...(taskData.parentId ? { parentId: taskData.parentId } : {}),
              ...(taskData.sortOrder != null ? { sortOrder: taskData.sortOrder } : {}),
              ...(taskData.description ? { description: taskData.description } : {}),
            });
            for (const seg of (taskData.segments ?? [])) {
              const newSeg: any = await taskApi.createSegment(projectId, t.id, { name: seg.name, startDate: seg.startDate, endDate: seg.endDate });
              // 자원 배정 복구 (자원ID + 투입률 + 분담율)
              for (const a of (seg.assignments ?? [])) {
                await taskApi.upsertAssignment(projectId, t.id, newSeg.id, {
                  resourceId: a.resourceId,
                  allocationMode: a.allocationMode ?? "PERCENT",
                  ...(a.allocationPercent != null ? { allocationPercent: a.allocationPercent } : {}),
                  ...(a.allocationHoursPerDay != null ? { allocationHoursPerDay: a.allocationHoursPerDay } : {}),
                  ...(a.contributionWeight != null ? { contributionWeight: a.contributionWeight } : {}),
                }).catch(() => {});
              }
            }
          },
          redo: async () => { await taskApi.delete(projectId, taskId).catch(() => {}); },
        });
      }
      await load();
      refreshActivities();
    } catch (e: any) {
      alert(e.message ?? "삭제 실패");
    }
  };

  const handleCopySelected = () => {
    if (selected.size === 0) return;
    const targets = Array.from(selected)
      .map((id) => tasks.find((t: any) => t.id === id))
      .filter(Boolean)
      .map((t: any) => ({ id: t.id, name: t.name, projectId }));
    if (targets.length > 0) setCopyTargets(targets);
  };

  const handleDeleteSelected = async () => {
    if (selected.size === 0) return;
    const count = selected.size;
    if (!confirm(`선택한 ${count}개 태스크를 삭제하시겠습니까?`)) return;
    const ids = Array.from(selected);
    // 삭제 전 스냅샷 (태스크+세그먼트+자원배정)
    const snapshot = ids
      .map((id) => (ganttData?.tasks ?? []).find((t: any) => t.id === id))
      .filter(Boolean) as any[];
    const deletedIds = new Set(snapshot.map((t) => t.id));
    try {
      await Promise.all(ids.map((id) => taskApi.delete(projectId, id)));
      let recreatedIds: string[] = [];
      pushUndo({
        label: `${count}개 태스크 일괄 삭제`,
        undo: async () => {
          recreatedIds = [];
          const idMap = new Map<string, string>(); // oldId → newId
          const pending = [...snapshot];
          let guard = 0;
          while (pending.length > 0 && guard < 2000) {
            guard++;
            const t = pending.shift()!;
            // 부모도 삭제대상인데 아직 재생성 전이면 뒤로 미룸 (부모 먼저 생성)
            if (t.parentId && deletedIds.has(t.parentId) && !idMap.has(t.parentId)) { pending.push(t); continue; }
            const newParentId = t.parentId
              ? (deletedIds.has(t.parentId) ? idMap.get(t.parentId) : t.parentId)
              : undefined;
            const nt: any = await taskApi.create(projectId, {
              name: t.name,
              ...(newParentId ? { parentId: newParentId } : {}),
              ...(t.sortOrder != null ? { sortOrder: t.sortOrder } : {}),
              ...(t.description ? { description: t.description } : {}),
            });
            idMap.set(t.id, nt.id);
            recreatedIds.push(nt.id);
            for (const seg of (t.segments ?? [])) {
              const newSeg: any = await taskApi.createSegment(projectId, nt.id, { name: seg.name, startDate: seg.startDate, endDate: seg.endDate });
              for (const a of (seg.assignments ?? [])) {
                await taskApi.upsertAssignment(projectId, nt.id, newSeg.id, {
                  resourceId: a.resourceId,
                  allocationMode: a.allocationMode ?? "PERCENT",
                  ...(a.allocationPercent != null ? { allocationPercent: a.allocationPercent } : {}),
                  ...(a.allocationHoursPerDay != null ? { allocationHoursPerDay: a.allocationHoursPerDay } : {}),
                  ...(a.contributionWeight != null ? { contributionWeight: a.contributionWeight } : {}),
                }).catch(() => {});
              }
            }
          }
        },
        redo: async () => {
          await Promise.all(recreatedIds.map((id) => taskApi.delete(projectId, id).catch(() => {})));
          recreatedIds = [];
        },
      });
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

  // 선택 툴바 높이 — sticky 헤더(<thead>)의 top 오프셋 계산용 (툴바가 열 제목 위에 겹치지 않게)
  const selToolbarRef = useRef<HTMLDivElement>(null);
  const [selToolbarH, setSelToolbarH] = useState(0);
  useEffect(() => {
    setSelToolbarH(selected.size > 0 ? (selToolbarRef.current?.offsetHeight ?? 0) : 0);
  }, [selected.size]);
  // 상단 고정 프레임: 프로젝트명 바 + 탭 바 높이를 측정해 하위 sticky들의 top 오프셋(--top-chrome)을 계산
  const projHeaderRef = useRef<HTMLDivElement>(null);
  const tabsBarRef = useRef<HTMLDivElement>(null);
  const rangeBarRef = useRef<HTMLDivElement>(null); // 간트 "지난주~" 범위 바 (간트 탭 전용)
  const [projHeaderH, setProjHeaderH] = useState(0);
  const [rangeBarH, setRangeBarH] = useState(0);
  const [topChrome, setTopChrome] = useState(56);
  useEffect(() => {
    const measure = () => {
      const ph = projHeaderRef.current?.offsetHeight ?? 0;
      const th = tabsBarRef.current?.offsetHeight ?? 0;
      setProjHeaderH(ph);
      setTopChrome(56 + ph + th); // 56 = 글로벌 네비 높이(h-14)
      setRangeBarH(rangeBarRef.current?.offsetHeight ?? 0);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [activeTab, ganttData]);

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

  const startEdit = (taskId: string, col: "status" | "progress" | "dates" | "note", val: any) => {
    setEditingCell({ taskId, col });
    setEditVal(val);
    if (col === "progress") { editValRef.current = Number(val) || 0; }
  };
  const cancelEdit = () => { setEditingCell(null); setEditVal(null); };

  // 태스크 이름 인라인 편집 (이름 더블클릭)
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [editNameVal, setEditNameVal] = useState("");
  const saveTaskName = async (taskId: string, name: string) => {
    const task = (ganttData?.tasks ?? []).find((t: any) => t.id === taskId);
    const oldName = task?.name ?? "";
    const newName = name.trim();
    setEditingNameId(null);
    if (!newName || newName === oldName) return;
    try {
      await taskApi.update(projectId, taskId, { name: newName });
      pushUndo({
        label: `태스크 이름 "${oldName}" → "${newName}"`,
        undo: async () => { await taskApi.update(projectId, taskId, { name: oldName }); await load(); },
        redo: async () => { await taskApi.update(projectId, taskId, { name: newName }); await load(); },
      });
      await load();
    } catch (e: any) { alert(e?.message ?? "이름 수정 실패"); }
  };

  const saveStatus = async (taskId: string, status: string) => {
    const task = (ganttData?.tasks ?? []).find((t: any) => t.id === taskId);
    const oldStatus = task?.status ?? "TODO";
    const taskName = task?.name ?? taskId;
    cancelEdit();
    try {
      await taskApi.update(projectId, taskId, { status });
      pushUndo({
        label: `"${taskName}" 상태 → ${status}`,
        undo: async () => { await taskApi.update(projectId, taskId, { status: oldStatus }); },
        redo: async () => { await taskApi.update(projectId, taskId, { status }); },
      });
      await load();
    } catch (e: any) {
      alert(e?.message ?? "상태 변경 실패");
      await load();
    }
  };

  // 자원-기여도-진척률 (D2): 진척률 수동 입력(saveProgress) 폐기 — 자원별 진척률로 자동 계산

  const createInlineTask = async () => {
    const name = inlineTaskName.trim();
    if (!name) { setInlineTaskName(""); setInlineAdding(false); return; }
    setInlineAdding(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const end = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
      const allTasks: any[] = ganttData?.tasks ?? [];
      const lastVisible = flatItems[flatItems.length - 1];
      const parentId = lastVisible?.task?.parentId ?? null;
      const siblings = allTasks.filter((t: any) => (t.parentId ?? null) === parentId);
      const maxOrder = siblings.reduce((m: number, t: any) => Math.max(m, t.sortOrder ?? 0), 0);
      const task = await taskApi.create(projectId, { name, parentId: parentId ?? undefined, sortOrder: maxOrder + 1 });
      await taskApi.createSegment(projectId, task.id, { name, startDate: today, endDate: end });
      pushUndo({
        label: `태스크 "${name}" 생성`,
        undo: async () => { await taskApi.delete(projectId, task.id); },
        redo: async () => {
          const t = await taskApi.create(projectId, { name, parentId: parentId ?? undefined, sortOrder: maxOrder + 1 });
          await taskApi.createSegment(projectId, t.id, { name, startDate: today, endDate: end });
        },
      });
      setInlineTaskName("");
      await load();
    } catch { /* ignore */ }
    finally { setInlineAdding(false); }
  };

  // 우클릭한 태스크 바로 아래(같은 레벨)에 새 태스크 생성
  const createTaskBelow = async (clicked: any) => {
    setInlineAdding(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const end = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
      const name = "새 태스크";
      const allTasks: any[] = ganttData?.tasks ?? [];
      const parentId = clicked.parentId ?? null;
      const siblings = allTasks
        .filter((t: any) => (t.parentId ?? null) === parentId)
        .sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      const ci = siblings.findIndex((t: any) => t.id === clicked.id);
      const clickedOrder = clicked.sortOrder ?? 0;
      const next = ci >= 0 ? siblings[ci + 1] : undefined;

      let newOrder: number;
      if (!next) {
        newOrder = clickedOrder + 10; // 마지막이면 뒤에 append
      } else {
        const gap = (next.sortOrder ?? 0) - clickedOrder;
        if (gap >= 2) {
          newOrder = clickedOrder + Math.floor(gap / 2); // 간격 안에 삽입 (형제 미변경)
        } else {
          // 간격이 없으면 뒤쪽 형제만 +10 시프트 (권한상 본인 태스크만 반영될 수 있음)
          newOrder = clickedOrder + 1;
          await Promise.all(
            siblings.slice(ci + 1).map((t: any) =>
              taskApi.update(projectId, t.id, { sortOrder: (t.sortOrder ?? 0) + 10 }).catch(() => {}),
            ),
          );
        }
      }

      const created: any = await taskApi.create(projectId, { name, parentId: parentId ?? undefined, sortOrder: newOrder });
      await taskApi.createSegment(projectId, created.id, { name, startDate: today, endDate: end });
      pushUndo({
        label: `태스크 "${name}" 생성`,
        undo: async () => { await taskApi.delete(projectId, created.id); },
        redo: async () => {
          const t: any = await taskApi.create(projectId, { name, parentId: parentId ?? undefined, sortOrder: newOrder });
          await taskApi.createSegment(projectId, t.id, { name, startDate: today, endDate: end });
        },
      });
      await load();
      setEditingNameId(created.id);
      setEditNameVal(name);
    } catch { /* ignore */ }
    finally { setInlineAdding(false); }
  };

  const saveDates = async (task: any, start: string, end: string) => {
    if (!start || !end || start > end) { cancelEdit(); return; }
    const segs: any[] = task.segments ?? [];
    if (segs.length === 0) { cancelEdit(); return; }
    const oldStart = task.effectiveStartDate ?? segs[0]?.startDate;
    const oldEnd = task.effectiveEndDate ?? segs[segs.length - 1]?.endDate;
    const taskName = task.name ?? task.id;
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
    if (oldStart !== start || oldEnd !== end) {
      pushUndo({
        label: `"${taskName}" 기간 변경`,
        undo: async () => {
          if (segs.length === 1) {
            await taskApi.updateSegment(projectId, task.id, segs[0].id, { startDate: oldStart, endDate: oldEnd, changeReason: "undo" });
          } else {
            const sorted = [...segs].sort((a: any, b: any) => a.startDate < b.startDate ? -1 : 1);
            await Promise.all([
              taskApi.updateSegment(projectId, task.id, sorted[0].id, { startDate: oldStart, changeReason: "undo" }),
              taskApi.updateSegment(projectId, task.id, sorted.at(-1).id, { endDate: oldEnd, changeReason: "undo" }),
            ]);
          }
        },
        redo: async () => {
          if (segs.length === 1) {
            await taskApi.updateSegment(projectId, task.id, segs[0].id, { startDate: start, endDate: end, changeReason: cr });
          } else {
            const sorted = [...segs].sort((a: any, b: any) => a.startDate < b.startDate ? -1 : 1);
            await Promise.all([
              taskApi.updateSegment(projectId, task.id, sorted[0].id, { startDate: start, changeReason: cr }),
              taskApi.updateSegment(projectId, task.id, sorted.at(-1).id, { endDate: end, changeReason: cr }),
            ]);
          }
        },
      });
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

    const targetTask = flatItems.find((fi) => fi.task.id === dropGap.taskId)?.task;
    const newParentId: string | null = targetTask?.parentId ?? null;

    // 이전 sortOrder/parentId 기록
    const oldState = allIds.map(id => {
      const t = (ganttData?.tasks ?? []).find((t: any) => t.id === id);
      return { id, sortOrder: t?.sortOrder ?? 0, parentId: t?.parentId ?? null };
    });

    clearDragState();
    await Promise.all(
      newOrder.map((id, idx) => {
        const updates: Record<string, unknown> = { sortOrder: (idx + 1) * 10 };
        if (draggedInOrder.includes(id)) updates.parentId = newParentId;
        return taskApi.update(projectId, id, updates).catch(() => {});
      }),
    );
    pushUndo({
      label: `태스크 순서 변경`,
      undo: async () => { await Promise.all(oldState.map(o => taskApi.update(projectId, o.id, { sortOrder: o.sortOrder, parentId: o.parentId }).catch(() => {}))); },
      redo: async () => {
        await Promise.all(newOrder.map((id, idx) => {
          const updates: Record<string, unknown> = { sortOrder: (idx + 1) * 10 };
          if (draggedInOrder.includes(id)) updates.parentId = newParentId;
          return taskApi.update(projectId, id, updates).catch(() => {});
        }));
      },
    });
    setSelected(new Set(draggedInOrder));
    await load();
  };

  // ── 자원 목록 ────────────────────────────────────────────────────────────────
  const [resources, setResources] = useState<any[]>([]);
  useEffect(() => {
    listAssignableResources().then(setResources).catch(() => {});
  }, []);

  // ── 타임라인 표시 범위 ──────────────────────────────────────────────────────
  const [viewStart, setViewStart] = useState("");
  const [viewEnd, setViewEnd] = useState("");
  // 현재 구간 길이만큼 앞(-1)/뒤(+1)로 이동
  const shiftViewRange = (dir: -1 | 1) => {
    if (!viewStart || !viewEnd) return;
    const s = new Date(viewStart), e = new Date(viewEnd);
    const days = Math.round((e.getTime() - s.getTime()) / 86400000) + 1; // 포함 일수
    s.setDate(s.getDate() + dir * days);
    e.setDate(e.getDate() + dir * days);
    setViewStart(toStr(s));
    setViewEnd(toStr(e));
  };

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

    return taskList.map((t: any) => {
      const task = map.get(t.id) ?? t;
      return { ...task, isCritical: task.isCritical && task.status !== "DONE" };
    });
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
    lastSelectedRef.current = task.id;
    // 같은 태스크 재클릭 시 토글
    if (selectedTask?.id === task.id) {
      setSelectedTask(null);
      return;
    }
    const fullTask = tasks.find((t: any) => t.id === task.id) ?? task;
    setSelectedTask({ ...fullTask, _projectName: ganttData?.project?.name ?? "" });
  };


  // 선택 상태 변경 — 두 화면(간트/태스크 목록) 공통 진입점
  // shift=true이고 anchor가 있으면 anchor 상태(선택/비선택)를 끝점까지 전파 (Excel/Windows 탐색기 표준)
  //  - anchor가 선택 상태 → 사이 범위 모두 add  (다중 선택)
  //  - anchor가 비선택 상태 → 사이 범위 모두 delete (다중 해제)
  // shift=false면 단순 토글 + anchor 갱신
  const handleSelectionChange = (id: string, shift: boolean) => {
    if (shift && lastSelectedRef.current && lastSelectedRef.current !== id) {
      const ids = flatItems.map((fi) => fi.task.id);
      const a = ids.indexOf(lastSelectedRef.current);
      const b = ids.indexOf(id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = [Math.min(a, b), Math.max(a, b)];
        setSelected((prev) => {
          const anchorSelected = prev.has(lastSelectedRef.current!);
          const next = new Set(prev);
          for (let i = lo; i <= hi; i++) {
            if (anchorSelected) next.add(ids[i]!);
            else next.delete(ids[i]!);
          }
          return next;
        });
        return; // anchor는 그대로 유지 — 같은 anchor에서 다른 끝점으로 반복 가능
      }
    }
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    lastSelectedRef.current = id;
  };

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    handleSelectionChange(id, e.shiftKey);
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

    const firstIdx = flatIds.indexOf(selInOrder[0]);
    if (firstIdx <= 0) return;
    const newParentId = flatItems[firstIdx - 1].task.id;

    // 이전 parentId 기록
    const oldParents = selInOrder.map(id => {
      const t = (ganttData?.tasks ?? []).find((t: any) => t.id === id);
      return { id, parentId: t?.parentId ?? null };
    });

    await Promise.all(
      selInOrder.map((id) => taskApi.update(projectId, id, { parentId: newParentId }).catch(() => {}))
    );
    pushUndo({
      label: `${selInOrder.length}개 태스크 들여쓰기`,
      undo: async () => { await Promise.all(oldParents.map(o => taskApi.update(projectId, o.id, { parentId: o.parentId }).catch(() => {}))); },
      redo: async () => { await Promise.all(selInOrder.map(id => taskApi.update(projectId, id, { parentId: newParentId }).catch(() => {}))); },
    });
    await load();
    setSelected(new Set());
  };

  // 내어쓰기: 첫 선택 태스크의 부모 기준으로 공통 목표 레벨 결정
  const handleOutdent = async () => {
    const taskMap = new Map((ganttData?.tasks ?? []).map((t: any) => [t.id, t as any]));
    const flatIds = flatItems.map((fi) => fi.task.id);
    const selInOrder = flatIds.filter((id) => selected.has(id));
    if (selInOrder.length === 0) return;

    const firstTask = taskMap.get(selInOrder[0]) as any;
    const newParentId = firstTask?.parentId
      ? ((taskMap.get(firstTask.parentId) as any)?.parentId ?? null)
      : null;

    // 이전 parentId 기록
    const oldParents = selInOrder.map(id => {
      const t = taskMap.get(id) as any;
      return { id, parentId: t?.parentId ?? null };
    });

    await Promise.all(
      selInOrder.map((id) => taskApi.update(projectId, id, { parentId: newParentId }).catch(() => {}))
    );
    pushUndo({
      label: `${selInOrder.length}개 태스크 내어쓰기`,
      undo: async () => { await Promise.all(oldParents.map(o => taskApi.update(projectId, o.id, { parentId: o.parentId }).catch(() => {}))); },
      redo: async () => { await Promise.all(selInOrder.map(id => taskApi.update(projectId, id, { parentId: newParentId }).catch(() => {}))); },
    });
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
      <div className="min-h-screen" style={{ ["--top-chrome" as any]: `${topChrome}px` }} onClick={() => selectedTask && setSelectedTask(null)}>
      {/* Project header — 1줄, 스크롤해도 상단 고정 */}
      <div ref={projHeaderRef} className="sticky top-14 z-[29] bg-white border-b border-gray-200 px-6 py-2.5">
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
              <ProjectPickerDropdown
                projectSearch={projectSearch}
                setProjectSearch={setProjectSearch}
                allProjects={allProjects}
                projectId={projectId}
                pickerFolders={pickerFolders}
                pickerProjMap={pickerProjMap}
                pickerOpenFolders={pickerOpenFolders}
                setPickerOpenFolders={setPickerOpenFolders}
                pickerFolderProjOrder={pickerFolderProjOrder}
                setShowProjectPicker={setShowProjectPicker}
                router={router}
              />
            )}
          </div>
          {st && <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${st.color}`}>{st.label}</span>}

          {/* Undo / Redo */}
          <UndoRedoControls undoCount={undoCount} redoCount={redoCount} undoLabel={undoLabel} redoLabel={redoLabel} toast={null} onUndo={handleUndo} onRedo={handleRedo} />

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
              title="일정 병목(크리티컬 패스) 분석 — 지연되면 프로젝트 종료가 밀리는 태스크를 찾습니다"
              className="text-sm px-3 py-1 border border-orange-300 text-orange-700 rounded-lg hover:bg-orange-50 disabled:opacity-40 font-medium"
            >
              {runningCpm ? "⏳..." : "이슈분석"}
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
              onClick={() => setShowSummary(true)}
              className="text-sm px-3 py-1 border border-blue-300 text-blue-700 rounded-lg hover:bg-blue-50 font-medium"
              title="프로젝트 요약 보기"
            >
              요약
            </button>
            {/* 템플릿 적용/저장 버튼은 프로젝트 목록 화면으로 이동 (2026-06-24) */}
            {/* 태스크/마일스톤 추가 버튼은 태스크 목록 하단 인라인 입력 행 아래로 이동 (혼동 방지) */}
          </div>
        </div>
      </div>

      {/* Tabs — 프로젝트명 바 아래에 고정 */}
      <div ref={tabsBarRef} className="sticky z-[27] bg-white border-b border-gray-200 px-6 flex gap-1" style={{ top: 56 + projHeaderH }}>
        {(["gantt", "tasks", "equipment", "activity"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => handleTabChange(tab)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab === "gantt" ? "📊 간트 차트"
              : tab === "tasks" ? "📋 태스크 목록"
              : tab === "equipment" ? "🔧 장비 투입"
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
            <div style={{ ["--gantt-extra" as any]: `${rangeBarH}px` }}>
              {/* 타임라인 표시 범위 설정 — 스크롤해도 탭 아래에 고정 */}
              <GanttRangeBar
                rangeBarRef={rangeBarRef}
                viewStart={viewStart}
                viewEnd={viewEnd}
                setViewStart={setViewStart}
                setViewEnd={setViewEnd}
                shiftViewRange={shiftViewRange}
                projectStartDate={ganttData?.project?.effectiveStartDate}
                projectEndDate={ganttData?.project?.effectiveEndDate}
              />
              <GanttChart
                data={computedGanttData!}
                flatItems={flatItems}
                canRename={isOperator}
                viewStart={viewStart || undefined}
                viewEnd={viewEnd || undefined}
                onTaskClick={(task) => {
                  if (selectedTask?.id === task.id) { setSelectedTask(null); } else { handleTaskClick(task); }
                }}
                onTaskCopy={isOperator ? (task) => setCopyTargets([{ id: task.id, name: task.name, projectId }]) : undefined}
                baselineSegments={baselineSegments.length > 0 ? baselineSegments : undefined}
                allResources={resources}
                onRefresh={loadSilent}
                pushUndo={pushUndo}
                projectId={projectId}
                inlineTaskName={inlineTaskName}
                onInlineTaskNameChange={setInlineTaskName}
                inlineAdding={inlineAdding}
                onInlineTaskCreate={createInlineTask}
                selected={selected}
                onToggleSelect={(id, shift) => handleSelectionChange(id, shift)}
                onToggleAll={toggleAll}
                dragIds={dragIds}
                dropGap={dropGap}
                onDragStart={handleDragStart}
                onDragOver={handleRowDragOver}
                onDrop={handleRowDrop}
                onDragEnd={clearDragState}
                onIndent={handleIndent}
                onOutdent={handleOutdent}
                onCopySelected={isOperator ? handleCopySelected : undefined}
                onDeleteSelected={isOperator ? handleDeleteSelected : undefined}
                onClearSelection={() => setSelected(new Set())}
                onProgressChange={undefined}
                onAddTask={isOperator ? () => { setAddAsMilestone(false); setShowAddTask(true); } : undefined}
                onAddMilestone={isOperator ? () => { setAddAsMilestone(true); setShowAddTask(true); } : undefined}
                holidays={holidays}
              />
            </div>
          )
        )}

        {/* ── Tasks ── */}
        {activeTab === "tasks" && (
          <TaskListTable
            selected={selected}
            selToolbarRef={selToolbarRef}
            selToolbarH={selToolbarH}
            isOperator={isOperator}
            flatItems={flatItems}
            colOrder={colOrder}
            colDragging={colDragging}
            colDropGap={colDropGap}
            collapsed={collapsed}
            dragIds={dragIds}
            dropGap={dropGap}
            editingCell={editingCell}
            editVal={editVal}
            editingNameId={editingNameId}
            editNameVal={editNameVal}
            parentTaskIds={parentTaskIds}
            projectId={projectId}
            resources={resources}
            inlineTaskName={inlineTaskName}
            inlineAdding={inlineAdding}
            handleOutdent={handleOutdent}
            handleIndent={handleIndent}
            handleCopySelected={handleCopySelected}
            handleDeleteSelected={handleDeleteSelected}
            setSelected={setSelected}
            toggleAll={toggleAll}
            handleColDragStart={handleColDragStart}
            handleColDragOver={handleColDragOver}
            handleColDrop={handleColDrop}
            setColDragging={setColDragging}
            setColDropGap={setColDropGap}
            handleRowDragOver={handleRowDragOver}
            handleRowDrop={handleRowDrop}
            clearDragState={clearDragState}
            handleDragStart={handleDragStart}
            handleTaskClick={handleTaskClick}
            createTaskBelow={createTaskBelow}
            setEditingNameId={setEditingNameId}
            setEditNameVal={setEditNameVal}
            setCopyTargets={setCopyTargets}
            handleDeleteTask={handleDeleteTask}
            toggleSelect={toggleSelect}
            setCollapsed={setCollapsed}
            saveTaskName={saveTaskName}
            startEdit={startEdit}
            saveStatus={saveStatus}
            cancelEdit={cancelEdit}
            setEditVal={setEditVal}
            saveDates={saveDates}
            setInlineTaskName={setInlineTaskName}
            createInlineTask={createInlineTask}
            setAddAsMilestone={setAddAsMilestone}
            setShowAddTask={setShowAddTask}
            load={load}
            pushUndo={pushUndo}
          />
        )}

        {/* ── Equipment ── */}
        {activeTab === "equipment" && (
          <EquipmentTab
            deploymentsLoading={deploymentsLoading}
            projectDeployments={projectDeployments}
            router={router}
          />
        )}

        {/* ── Activity ── */}
        {activeTab === "activity" && (
          <ActivityTab
            activities={activities}
            projectDeployments={projectDeployments}
            userMap={userMap}
            commentContentMap={commentContentMap}
            projectName={ganttData?.project?.name}
            onRefresh={loadActivities}
          />
        )}
      </div>

      {copyTargets && (
        <CopyTaskModal
          tasks={copyTargets}
          currentProjectId={projectId}
          onClose={() => setCopyTargets(null)}
          onSuccess={async () => {
            setCopyTargets(null);
            setSelected(new Set());
            await load();
            refreshActivities();
          }}
        />
      )}

      {showAddTask && (
        <AddTaskModal
          projectId={projectId}
          defaultParentId={flatItems[flatItems.length - 1]?.task?.parentId ?? null}
          defaultIsMilestone={addAsMilestone}
          defaultSortOrder={(() => {
            const allTasks: any[] = ganttData?.tasks ?? [];
            const lastVisible = flatItems[flatItems.length - 1];
            const parentId = lastVisible?.task?.parentId ?? null;
            const siblings = allTasks.filter((t: any) => (t.parentId ?? null) === parentId);
            return siblings.reduce((m: number, t: any) => Math.max(m, t.sortOrder ?? 0), 0) + 1;
          })()}
          onSuccess={async (taskId?: string, taskName?: string) => {
            if (taskId && taskName) {
              pushUndo({
                label: `${addAsMilestone ? "마일스톤" : "태스크"} "${taskName}" 추가`,
                undo: async () => { await taskApi.delete(projectId, taskId); },
                redo: async () => {},
              });
            }
            await load(); refreshActivities();
          }}
          onClose={() => { setShowAddTask(false); setAddAsMilestone(false); }}
        />
      )}

      </div>

      {selectedTask && (
        <TaskDrawer
          task={selectedTask}
          projectId={projectId}
          isParent={selectedTaskIsParent}
          onCopy={(t) => setCopyTargets([t])}
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
          pushUndo={pushUndo}
          onUndo={handleUndo}
          onRedo={handleRedo}
          undoCount={undoCount}
          redoCount={redoCount}
          undoLabel={undoLabel}
          redoLabel={redoLabel}
          toast={toast}
          refreshKey={drawerRefreshKey}
        />
      )}

      {showImpactPanel && (
        <ImpactPanel
          projectId={projectId}
          tasks={tasks.filter((t: any) => !t.isMilestone).map((t: any) => ({ id: t.id, name: t.name }))}
          onClose={() => setShowImpactPanel(false)}
        />
      )}

      {/* 프로젝트 요약 드로어 */}
      {showSummary && <ProjectSummaryDrawer projectId={projectId} onClose={() => setShowSummary(false)} />}

      {/* Undo/Redo toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] bg-gray-900 text-white text-sm px-4 py-2 rounded-lg shadow-lg">
          {toast}
        </div>
      )}
    </AppLayout>
  );
}
