"use client";

import { useMemo, useRef, useState, useCallback, useEffect } from "react";
import clsx from "clsx";
import CommentPopover from "@/components/CommentPopover";
import ResourcePickerPopover from "@/components/ResourcePickerPopover";
import { taskApi } from "@/lib/api";

interface GanttSegment {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  progressPercent: number;
  assignments: { resourceName: string; displayText: string }[];
}

interface GanttTask {
  id: string;
  name: string;
  milestoneName?: string | null;
  sortOrder: number;
  status: string;
  overallProgress: number;
  isMilestone: boolean;
  isCritical: boolean;
  effectiveStartDate?: string | null;
  effectiveEndDate?: string | null;
  segments: GanttSegment[];
}

interface GanttDependency {
  predecessorId: string;
  successorId: string;
  type: string;
  lagDays: number;
}

interface GanttData {
  project: { name: string; effectiveStartDate: string; effectiveEndDate: string };
  tasks: GanttTask[];
  dependencies?: GanttDependency[];
  criticalPath: string[];
}

interface FlatItem {
  task: GanttTask;
  depth: number;
}

interface BaselineSegment {
  taskId: string;
  startDate: string;
  endDate: string;
  name?: string;
}

const ROW_H = 36;
const BAR_H = Math.round((ROW_H - 20) * 1.2); // 기본 높이의 120%
const BAR_TOP = Math.round((ROW_H - BAR_H) / 2);
const LEFT_W = 220;   // task name column
const RESOURCE_W = 150; // resource assignment column
const DAY_PX = 28; // pixels per day
const DIAMOND_SIZE = ROW_H - 16;                                   // 28px
const DIAMOND_TIP = Math.round(DIAMOND_SIZE * 0.7 / Math.SQRT2);  // ≈14px — right/left tip offset from center

function parseDate(s: string) {
  return new Date(s + "T00:00:00");
}

function daysBetween(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

function formatDate(s: string) {
  return new Date(s).toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}

function shiftDate(isoDate: string, days: number): string {
  const d = parseDate(isoDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function GanttChart({ data, flatItems, viewStart, viewEnd, onTaskClick, baselineSegments, allResources, onRefresh, projectId }: {
  data: GanttData;
  flatItems?: FlatItem[];
  viewStart?: string;
  viewEnd?: string;
  onTaskClick?: (task: GanttTask) => void;
  baselineSegments?: BaselineSegment[];
  allResources?: any[];
  onRefresh?: () => void;
  projectId?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(([e]) => setContainerW(e.contentRect.width));
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const [leftW, setLeftW] = useState(() => {
    try { return Number(localStorage.getItem("gantt_leftW")) || LEFT_W; } catch { return LEFT_W; }
  });
  const [resourceW, setResourceW] = useState(() => {
    try { return Number(localStorage.getItem("gantt_resourceW")) || RESOURCE_W; } catch { return RESOURCE_W; }
  });

  useEffect(() => { try { localStorage.setItem("gantt_leftW", String(leftW)); } catch {} }, [leftW]);
  useEffect(() => { try { localStorage.setItem("gantt_resourceW", String(resourceW)); } catch {} }, [resourceW]);

  // data prop이 새 날짜로 갱신되면 일치하는 override를 자동 정리
  useEffect(() => {
    setSegDateOverrides((prev) => {
      if (Object.keys(prev).length === 0) return prev;
      const next = { ...prev };
      let changed = false;
      for (const task of data.tasks) {
        for (const seg of task.segments) {
          const ov = next[seg.id];
          if (ov && ov.startDate === seg.startDate && ov.endDate === seg.endDate) {
            delete next[seg.id];
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [data]);

  const startResize = useCallback((
    e: React.MouseEvent,
    currentW: number,
    setW: (w: number) => void,
    minW = 80,
  ) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = currentW;
    const onMove = (ev: MouseEvent) => setW(Math.max(minW, startW + ev.clientX - startX));
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  // ── Bar drag (move / resize) ──────────────────────────────────────────────
  // Optimistic date overrides: segId → { startDate, endDate }
  // mouseup에서 즉시 적용해 바를 고정, API 실패 시에만 롤백
  const [segDateOverrides, setSegDateOverrides] = useState<Record<string, { startDate: string; endDate: string }>>({});

  const segElsRef = useRef<Map<string, HTMLElement>>(new Map());
  // dayPxRef는 dayPx가 계산된 후 동기적으로 갱신 — closure가 항상 최신값 읽도록
  const dayPxRef = useRef(DAY_PX);

  type DragState = {
    type: "move" | "resize-left" | "resize-right";
    segId: string;
    taskId: string;
    startX: number;
    origLeft: number;
    origWidth: number;
    origStartDate: string;
    origEndDate: string;
  };
  const dragRef = useRef<DragState | null>(null);

  const startBarDrag = useCallback((
    e: React.MouseEvent,
    type: "move" | "resize-left" | "resize-right",
    seg: GanttSegment,
    taskId: string,
    sx: number,
    sw: number,
  ) => {
    if (!projectId) return;
    e.preventDefault();
    e.stopPropagation();

    dragRef.current = {
      type, segId: seg.id, taskId,
      startX: e.clientX,
      origLeft: sx, origWidth: sw,
      origStartDate: seg.startDate, origEndDate: seg.endDate,
    };

    document.body.style.cursor = type === "move" ? "grabbing" : "ew-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const el = segElsRef.current.get(drag.segId);
      if (!el) return;

      const dp = dayPxRef.current;
      const dayDelta = Math.round((ev.clientX - drag.startX) / dp);

      if (drag.type === "move") {
        el.style.left = `${drag.origLeft + dayDelta * dp}px`;
      } else if (drag.type === "resize-right") {
        el.style.width = `${Math.max(dp, drag.origWidth + dayDelta * dp)}px`;
      } else {
        const newLeft = drag.origLeft + dayDelta * dp;
        const newWidth = Math.max(dp, drag.origWidth - dayDelta * dp);
        el.style.left = `${newLeft}px`;
        el.style.width = `${newWidth}px`;
      }
    };

    const onUp = (ev: MouseEvent) => {
      const drag = dragRef.current;
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (!drag) return;

      const dayDelta = Math.round((ev.clientX - drag.startX) / dayPxRef.current);
      if (dayDelta === 0) return;

      let newStart = drag.origStartDate;
      let newEnd = drag.origEndDate;

      if (drag.type === "move") {
        newStart = shiftDate(drag.origStartDate, dayDelta);
        newEnd   = shiftDate(drag.origEndDate,   dayDelta);
      } else if (drag.type === "resize-right") {
        newEnd = shiftDate(drag.origEndDate, dayDelta);
        if (newEnd < drag.origStartDate) newEnd = drag.origStartDate;
      } else {
        newStart = shiftDate(drag.origStartDate, dayDelta);
        if (newStart > drag.origEndDate) newStart = drag.origEndDate;
      }

      // Optimistic update: 즉시 React 상태에 새 날짜 적용 → 바가 새 위치에 고정
      setSegDateOverrides((prev) => ({ ...prev, [drag.segId]: { startDate: newStart, endDate: newEnd } }));

      taskApi.updateSegment(projectId!, drag.taskId, drag.segId, {
        startDate: newStart,
        endDate: newEnd,
        changeReason: "드래그 이동",
      }).then(() => {
        onRefresh?.();
      }).catch(() => {
        // 실패: override 롤백 → 원래 위치로 복귀
        setSegDateOverrides((prev) => { const n = { ...prev }; delete n[drag.segId]; return n; });
      });
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [projectId, onRefresh]);

  // Collapse state for parent tasks
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggleCollapse = useCallback((taskId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(taskId) ? next.delete(taskId) : next.add(taskId);
      return next;
    });
  }, []);

  // Build set of task IDs that have children
  const parentIds = useMemo(() => {
    const source = flatItems && flatItems.length > 0 ? flatItems : data.tasks.map((t) => ({ task: t, depth: 0 }));
    const ids = new Set<string>();
    source.forEach(({ task }) => {
      if ((task as any)._children?.length > 0) ids.add(task.id);
    });
    return ids;
  }, [flatItems, data.tasks]);

  // Determine display rows: use flatItems order if provided, else fall back to data.tasks order
  // Filter out children of collapsed parents
  const rows: FlatItem[] = useMemo(() => {
    const source = flatItems && flatItems.length > 0
      ? flatItems
      : data.tasks.map((t) => ({ task: t, depth: 0 }));

    if (collapsed.size === 0) return source;

    // Build parent→children map from _children field
    const result: FlatItem[] = [];
    const hiddenIds = new Set<string>();

    for (const item of source) {
      const parentId = (item.task as any).parentId as string | undefined;
      // 부모가 숨겨졌거나 collapsed면 이 항목도 숨김
      if (parentId && (hiddenIds.has(parentId) || collapsed.has(parentId))) {
        hiddenIds.add(item.task.id);
        continue;
      }
      result.push(item);
    }
    return result;
  }, [flatItems, data.tasks, collapsed]);


  // Overall date range — user override takes priority
  const rangeStart = useMemo(() => {
    if (viewStart) return parseDate(viewStart);
    if (data.project.effectiveStartDate) return parseDate(data.project.effectiveStartDate);
    const dates = data.tasks.flatMap((t) => t.segments.map((s) => parseDate(s.startDate)));
    return dates.length > 0 ? new Date(Math.min(...dates.map((d) => d.getTime()))) : new Date();
  }, [viewStart, data]);

  const rangeEnd = useMemo(() => {
    if (viewEnd) return parseDate(viewEnd);
    if (data.project.effectiveEndDate) return parseDate(data.project.effectiveEndDate);
    const dates = data.tasks.flatMap((t) => t.segments.map((s) => parseDate(s.endDate)));
    return dates.length > 0 ? new Date(Math.max(...dates.map((d) => d.getTime()))) : new Date();
  }, [viewEnd, data]);

  const totalDays = Math.max(daysBetween(rangeStart, rangeEnd) + 2, 30);

  // 날짜 범위가 지정된 경우 타임라인을 화면 폭에 맞게 자동 줌
  const hasCustomRange = !!(viewStart && viewEnd);
  const timelinePanelW = Math.max(0, containerW - leftW - resourceW);
  const dayPx = hasCustomRange && timelinePanelW > 10
    ? Math.max(2, timelinePanelW / totalDays)
    : DAY_PX;

  const timelineW = totalDays * dayPx;
  dayPxRef.current = dayPx; // 드래그 closure가 항상 최신 dayPx를 읽도록 갱신

  // Month headers
  const months = useMemo(() => {
    const result: { label: string; x: number; width: number }[] = [];
    const cursor = new Date(rangeStart);
    cursor.setDate(1);
    while (cursor <= rangeEnd) {
      const monthStart = new Date(cursor);
      const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
      const x = Math.max(0, daysBetween(rangeStart, monthStart)) * dayPx;
      const end = Math.min(totalDays, daysBetween(rangeStart, monthEnd) + 1) * dayPx;
      result.push({
        label: `${cursor.getFullYear()}년 ${cursor.getMonth() + 1}월`,
        x,
        width: end - x,
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return result;
  }, [rangeStart, rangeEnd, totalDays, dayPx]);

  // Today line
  const todayX = daysBetween(rangeStart, new Date()) * dayPx;

  const totalH = rows.length * ROW_H;

  // Build a map: taskId → row index
  const taskRowIndex = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach(({ task }, i) => m.set(task.id, i));
    return m;
  }, [rows]);

  // Compute arrow paths for dependencies
  const arrows = useMemo(() => {
    const deps = data.dependencies ?? [];
    const taskMap = new Map(data.tasks.map((t) => [t.id, t]));
    return deps.flatMap((dep) => {
      const pred = taskMap.get(dep.predecessorId);
      const succ = taskMap.get(dep.successorId);
      if (!pred || !succ) return [];
      const predRowIdx = taskRowIndex.get(dep.predecessorId);
      const succRowIdx = taskRowIndex.get(dep.successorId);
      // Skip if either task is not visible (e.g., collapsed)
      if (predRowIdx === undefined || succRowIdx === undefined) return [];

      // Y centers (within the rows div, no header offset needed since SVG is inside)
      const predY = predRowIdx * ROW_H + ROW_H / 2;
      const succY = succRowIdx * ROW_H + ROW_H / 2;

      // X positions — milestones connect at diamond tips, bars connect at bar edges
      const predMx = pred.effectiveStartDate ? daysBetween(rangeStart, parseDate(pred.effectiveStartDate)) * dayPx : 0;
      const succMx = succ.effectiveStartDate ? daysBetween(rangeStart, parseDate(succ.effectiveStartDate)) * dayPx : 0;

      let startX: number, endX: number;
      if (dep.type === "SS") {
        // Start-to-Start: exit from left edge/tip of pred, enter left edge/tip of succ
        startX = pred.isMilestone ? predMx - DIAMOND_TIP : predMx;
        endX   = succ.isMilestone ? succMx - DIAMOND_TIP : succMx;
      } else {
        // FS (default): exit from right edge/tip of pred, enter left edge/tip of succ
        startX = pred.isMilestone
          ? predMx + DIAMOND_TIP
          : (pred.effectiveEndDate ? (daysBetween(rangeStart, parseDate(pred.effectiveEndDate)) + 1) * dayPx : 0);
        endX = succ.isMilestone ? succMx - DIAMOND_TIP : succMx;
      }

      // Build path — arrowhead always arrives going right (→)
      const HORIZ_EXT = 12;
      let path: string;
      if (endX > startX + HORIZ_EXT) {
        // Forward: simple elbow, final H goes right naturally
        const midX = (startX + endX) / 2;
        path = `M ${startX} ${predY} H ${midX} V ${succY} H ${endX}`;
      } else {
        // Backward or overlap: route below the lower row so the final H always goes right
        const exitX = startX + HORIZ_EXT;  // small rightward exit
        const entryX = endX - HORIZ_EXT;  // approach from the left (always < endX)
        const midY = (predY + succY) / 2; // ㄹ 중간 가로선 높이
        path = `M ${startX} ${predY} H ${exitX} V ${midY} H ${entryX} V ${succY} H ${endX}`;
      }

      const isCritical = pred.isCritical && succ.isCritical;
      return [{ id: dep.predecessorId + dep.successorId, path, endX, succY, isCritical }];
    });
  }, [data.dependencies, data.tasks, taskRowIndex, rangeStart, dayPx]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden" ref={containerRef}>
      <div className="flex" style={{ height: `${totalH + 56}px` }}>
        {/* Left panel */}
        <div
          className="shrink-0 border-r border-gray-200 flex flex-col relative"
          style={{ width: leftW }}
        >
          {/* Header */}
          <div className="h-14 border-b border-gray-200 px-4 flex items-end pb-1.5">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">태스크</span>
          </div>
          {/* Rows */}
          <div className="flex-1 overflow-hidden">
            {rows.map(({ task, depth }, i) => (
              <div
                key={task.id}
                style={{ height: ROW_H }}
                onClick={(e) => { e.stopPropagation(); onTaskClick?.(task); }}
                className={clsx(
                  "flex items-center border-b border-gray-100 gap-1 pr-1 group/row",
                  task.isCritical && !task.isMilestone && "bg-red-50/30",
                  onTaskClick && "cursor-pointer hover:bg-blue-50/40",
                )}
              >
                {/* Task name */}
                <div className="flex-1 min-w-0 flex items-center gap-0.5" style={{ paddingLeft: 10 + depth * 14 }}>
                  {/* Collapse toggle for parent tasks */}
                  {parentIds.has(task.id) ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleCollapse(task.id); }}
                      className="w-4 h-4 flex items-center justify-center shrink-0 text-gray-400 hover:text-gray-700 transition-colors"
                      title={collapsed.has(task.id) ? "펼치기" : "접기"}
                    >
                      <span className={clsx(
                        "text-[9px] inline-block transition-transform duration-150",
                        collapsed.has(task.id) ? "" : "rotate-90"
                      )}>▶</span>
                    </button>
                  ) : (
                    depth > 0
                      ? <span className="w-4 h-px bg-gray-200 shrink-0 ml-0" />
                      : <span className="w-4 shrink-0" />
                  )}
                  <p className={clsx(
                    "text-sm truncate",
                    parentIds.has(task.id) ? "font-semibold" : "font-medium",
                    task.isMilestone ? "text-purple-700" : task.isCritical ? "text-red-700" : "text-gray-800",
                  )}>
                    {task.isMilestone
                      ? <span className="mr-0.5 text-purple-500">◆</span>
                      : task.isCritical && <span className="mr-0.5">🔴</span>}
                    {task.name}
                  </p>
                  {(task as any).commentCount > 0 && (
                    <span className="ml-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <CommentPopover taskId={task.id} count={(task as any).commentCount} />
                    </span>
                  )}
                </div>
                {/* Progress or date */}
                <div className="shrink-0 text-right min-w-[28px] flex items-center gap-1 justify-end">
                  {task.isMilestone ? (
                    task.effectiveStartDate && (
                      <span className="text-[10px] text-purple-400">{formatDate(task.effectiveStartDate)}</span>
                    )
                  ) : (
                    <span className="text-[11px] font-semibold text-gray-400">
                      {task.overallProgress.toFixed(0)}%
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
          {/* Left panel resize handle */}
          <div
            className="absolute top-0 bottom-0 z-20 cursor-col-resize group/lresize hover:bg-blue-300/20 transition-colors"
            style={{ right: -4, width: 8 }}
            onMouseDown={(e) => startResize(e, leftW, setLeftW, 100)}
          >
            <div className="absolute inset-y-0 left-1/2 w-px bg-gray-200 group-hover/lresize:bg-blue-400 transition-colors" />
          </div>
        </div>

        {/* Resource assignment column */}
        <div className="shrink-0 border-r border-gray-200 flex flex-col relative" style={{ width: resourceW }}>
          <div className="h-14 border-b border-gray-200 px-3 flex items-end pb-1.5">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">자원</span>
          </div>
          <div className="flex-1 overflow-hidden">
            {rows.map(({ task }) => {
              const resources = [...new Set(
                task.segments.flatMap((s) => s.assignments.map((a) => a.resourceName))
              )];
              return (
                <div
                  key={task.id}
                  style={{ height: ROW_H }}
                  className={clsx(
                    "flex items-center px-2 border-b border-gray-100",
                    task.isCritical && !task.isMilestone && "bg-red-50/30",
                  )}
                >
                  {allResources ? (
                    <div onClick={(e) => e.stopPropagation()}>
                      <ResourcePickerPopover
                        task={task}
                        projectId={projectId ?? ""}
                        allResources={allResources}
                        onRefresh={onRefresh ?? (() => {})}
                      />
                    </div>
                  ) : (
                    resources.length > 0 ? (
                      <div className="flex items-center">
                        {resources.map((name, idx) => (
                          <span
                            key={name}
                            title={name}
                            className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[10px] font-bold shrink-0 ring-2 ring-white"
                            style={{ marginLeft: idx === 0 ? 0 : -8, zIndex: resources.length - idx }}
                          >
                            {name.slice(0, 2)}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-[11px] text-gray-200">—</span>
                    )
                  )}
                </div>
              );
            })}
            </div>
          {/* Resource column resize handle */}
          <div
            className="absolute top-0 bottom-0 z-20 cursor-col-resize group/rresize hover:bg-blue-300/20 transition-colors"
            style={{ right: -4, width: 8 }}
            onMouseDown={(e) => startResize(e, resourceW, setResourceW, 60)}
          >
            <div className="absolute inset-y-0 left-1/2 w-px bg-gray-200 group-hover/rresize:bg-blue-400 transition-colors" />
          </div>
        </div>

        {/* Right timeline panel */}
        <div className={clsx("flex-1", hasCustomRange ? "overflow-hidden" : "overflow-x-auto")} ref={scrollRef}>
          <div style={{ width: timelineW, minWidth: hasCustomRange ? undefined : "100%" }}>
            {/* Month headers */}
            <div className="relative h-7 border-b border-gray-100">
              {months.map((m) => (
                <div
                  key={m.label}
                  className="absolute top-0 h-full flex items-center border-r border-gray-200 px-2"
                  style={{ left: m.x, width: m.width }}
                >
                  <span className="text-xs font-medium text-gray-500 truncate">{m.label}</span>
                </div>
              ))}
            </div>

            {/* Day grid header */}
            <div className="relative h-7 border-b border-gray-200">
              {Array.from({ length: totalDays }).map((_, i) => {
                const d = new Date(rangeStart);
                d.setDate(d.getDate() + i);
                const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                const isMonStart = d.getDate() === 1;
                return (
                  <div
                    key={i}
                    className={clsx(
                      "absolute top-0 h-full flex items-center justify-center",
                      isWeekend && "bg-gray-50",
                      isMonStart && "border-l border-gray-300",
                    )}
                    style={{ left: i * dayPx, width: dayPx }}
                  >
                    {dayPx >= 14 && (
                      <span className={clsx("text-[10px]", isWeekend ? "text-gray-300" : "text-gray-400")}>
                        {d.getDate()}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Rows */}
            <div className="relative" style={{ height: totalH }}>
              {/* Dependency arrows SVG overlay */}
              {arrows.length > 0 && (
                <svg
                  className="absolute inset-0 pointer-events-none z-20"
                  width={timelineW}
                  height={totalH}
                  style={{ overflow: "visible" }}
                >
                  <defs>
                    <marker id="arrowhead" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                      <path d="M0,0 L6,3 L0,6 Z" fill="#6366f1" />
                    </marker>
                    <marker id="arrowhead-crit" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                      <path d="M0,0 L6,3 L0,6 Z" fill="#ef4444" />
                    </marker>
                  </defs>
                  {arrows.map((a) => (
                    <g key={a.id}>
                      <path
                        d={a.path}
                        fill="none"
                        stroke={a.isCritical ? "#ef4444" : "#6366f1"}
                        strokeWidth="1.5"
                        strokeDasharray={a.isCritical ? "none" : "none"}
                        markerEnd={a.isCritical ? "url(#arrowhead-crit)" : "url(#arrowhead)"}
                        opacity="0.7"
                      />
                    </g>
                  ))}
                </svg>
              )}
              {/* Weekend shading */}
              {Array.from({ length: totalDays }).map((_, i) => {
                const d = new Date(rangeStart);
                d.setDate(d.getDate() + i);
                const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                return isWeekend ? (
                  <div
                    key={i}
                    className="absolute top-0 bottom-0 bg-gray-50/60"
                    style={{ left: i * dayPx, width: dayPx }}
                  />
                ) : null;
              })}

              {/* Today line */}
              {todayX >= 0 && todayX <= timelineW && (
                <div
                  className="absolute top-0 bottom-0 w-px bg-blue-400 z-10 opacity-70"
                  style={{ left: todayX }}
                />
              )}

              {/* Row backgrounds + bars */}
              {rows.map(({ task }, i) => {
                const y = i * ROW_H;

                // Milestone task: render diamond at the date
                if (task.isMilestone && task.effectiveStartDate) {
                  const mx = daysBetween(rangeStart, parseDate(task.effectiveStartDate)) * dayPx;
                  const diamondSize = ROW_H - 16;
                  return (
                    <div
                      key={task.id}
                      className="absolute left-0 right-0 border-b border-gray-100"
                      style={{ top: y, height: ROW_H }}
                    >
                      <div
                        className="absolute flex items-center justify-center"
                        style={{ left: mx - diamondSize / 2, top: (ROW_H - diamondSize) / 2, width: diamondSize, height: diamondSize }}
                        title={`◆ ${task.name}\n${task.effectiveStartDate}`}
                      >
                        <div
                          className="bg-purple-500 shadow-sm"
                          style={{
                            width: diamondSize * 0.7,
                            height: diamondSize * 0.7,
                            transform: "rotate(45deg)",
                          }}
                        />
                      </div>
                    </div>
                  );
                }

                // Summary bar: 하위 태스크를 가진 상위 태스크 (_children 존재 + effectiveStartDate 있음)
                const isParent = (task as any)._children?.length > 0 && task.effectiveStartDate && task.effectiveEndDate;
                if (isParent) {
                  const sx = daysBetween(rangeStart, parseDate(task.effectiveStartDate!)) * dayPx;
                  const sw = (daysBetween(parseDate(task.effectiveStartDate!), parseDate(task.effectiveEndDate!)) + 1) * dayPx;
                  const pct = Math.min(100, Math.max(0, task.overallProgress ?? 0));
                  return (
                    <div
                      key={task.id}
                      className="absolute left-0 right-0 border-b border-gray-100"
                      style={{ top: y, height: ROW_H }}
                    >
                      <div
                        className="absolute"
                        style={{ left: sx, top: ROW_H / 2 - 5, width: sw, height: 10 }}
                        title={`${task.name}\n${formatDate(task.effectiveStartDate!)} ~ ${formatDate(task.effectiveEndDate!)}\n진행률: ${pct.toFixed(0)}%`}
                      >
                        {/* Summary track */}
                        <div className="h-full w-full rounded-sm bg-gray-300" />
                        {/* Progress fill */}
                        <div
                          className="absolute top-0 left-0 h-full rounded-sm bg-gray-500 transition-all"
                          style={{ width: `${pct}%` }}
                        />
                        {/* Left cap */}
                        <div className="absolute left-0 top-[-3px] w-1.5 h-4 bg-gray-500 rounded-sm" />
                        {/* Right cap */}
                        <div className="absolute right-0 top-[-3px] w-1.5 h-4 bg-gray-500 rounded-sm" />
                      </div>
                    </div>
                  );
                }

                // Baseline segments for this task
                const taskBaseline = baselineSegments?.filter((b) => b.taskId === task.id) ?? [];

                return (
                  <div
                    key={task.id}
                    className={clsx(
                      "absolute left-0 right-0 border-b border-gray-100",
                      task.isCritical && "bg-red-50/20",
                    )}
                    style={{ top: y, height: ROW_H }}
                  >
                    {/* Baseline overlay bars (thin, amber/orange) */}
                    {taskBaseline.map((bl, bi) => {
                      const bsx = daysBetween(rangeStart, parseDate(bl.startDate)) * dayPx;
                      const bsw = (daysBetween(parseDate(bl.startDate), parseDate(bl.endDate)) + 1) * dayPx;
                      return (
                        <div
                          key={`bl-${bi}`}
                          className="absolute rounded pointer-events-none"
                          style={{
                            left: bsx,
                            top: ROW_H - 7,
                            width: bsw,
                            height: 4,
                            background: "rgba(251, 146, 60, 0.7)",
                            border: "1px solid rgba(249, 115, 22, 0.8)",
                            zIndex: 5,
                          }}
                          title={`기준선: ${bl.name ?? ""} (${bl.startDate} ~ ${bl.endDate})`}
                        />
                      );
                    })}
                    {task.segments.map((seg) => {
                      // optimistic override가 있으면 그 날짜로 위치 계산
                      const ov = segDateOverrides[seg.id];
                      const effStart = ov?.startDate ?? seg.startDate;
                      const effEnd   = ov?.endDate   ?? seg.endDate;
                      const sx = daysBetween(rangeStart, parseDate(effStart)) * dayPx;
                      const sw = (daysBetween(parseDate(effStart), parseDate(effEnd)) + 1) * dayPx;
                      const pct = Math.min(100, Math.max(0, seg.progressPercent));
                      const isCompleted = seg.progressPercent >= 100;
                      const barColor = isCompleted
                        ? "bg-green-500"
                        : task.isCritical
                          ? "bg-red-500"
                          : "bg-blue-500";
                      const trackColor = isCompleted
                        ? "bg-green-200"
                        : task.isCritical
                          ? "bg-red-200"
                          : "bg-blue-200";
                      const resources = seg.assignments.map((a) => a.resourceName).join(", ");
                      const canDrag = !!projectId;
                      return (
                        <div
                          key={seg.id}
                          ref={(el) => { if (el) segElsRef.current.set(seg.id, el); else segElsRef.current.delete(seg.id); }}
                          className="absolute group/seg select-none"
                          style={{ left: sx, top: BAR_TOP, width: sw, height: BAR_H, cursor: canDrag ? "grab" : "default" }}
                          onMouseDown={canDrag ? (e) => { if (e.button === 0) startBarDrag(e, "move", seg, task.id, sx, sw); } : undefined}
                          title={`${seg.name}\n${formatDate(effStart)} ~ ${formatDate(effEnd)}\n진행률: ${pct}%${resources ? `\n담당: ${resources}` : ""}`}
                        >
                          {/* Track */}
                          <div className={clsx("h-full w-full rounded", trackColor)} />
                          {/* Progress fill */}
                          <div
                            className={clsx("absolute top-0 left-0 h-full rounded transition-all", barColor)}
                            style={{ width: `${pct}%` }}
                          />
                          {/* Label */}
                          <div className="absolute inset-0 flex items-center px-2.5 overflow-hidden pointer-events-none">
                            <span className="text-[10px] font-medium text-white truncate drop-shadow-sm">
                              {sw > 50 ? seg.name : ""}
                            </span>
                          </div>
                          {/* Resize handle — left */}
                          {canDrag && (
                            <div
                              className="absolute top-0 left-0 h-full w-2 cursor-ew-resize opacity-0 group-hover/seg:opacity-100 transition-opacity rounded-l z-10"
                              style={{ background: "rgba(255,255,255,0.35)" }}
                              onMouseDown={(e) => { e.stopPropagation(); if (e.button === 0) startBarDrag(e, "resize-left", seg, task.id, sx, sw); }}
                            />
                          )}
                          {/* Resize handle — right */}
                          {canDrag && (
                            <div
                              className="absolute top-0 right-0 h-full w-2 cursor-ew-resize opacity-0 group-hover/seg:opacity-100 transition-opacity rounded-r z-10"
                              style={{ background: "rgba(255,255,255,0.35)" }}
                              onMouseDown={(e) => { e.stopPropagation(); if (e.button === 0) startBarDrag(e, "resize-right", seg, task.id, sx, sw); }}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="border-t border-gray-200 px-4 py-2 flex items-center gap-6 text-xs text-gray-500 flex-wrap">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-blue-500 inline-block" /> 일반</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-500 inline-block" /> 크리티컬 패스</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-green-500 inline-block" /> 완료</span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 bg-purple-500 inline-block" style={{ transform: "rotate(45deg)" }} />
          <span className="ml-1">마일스톤</span>
        </span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-1.5 rounded-sm bg-gray-500 inline-block" /> 상위 태스크</span>
        <span className="flex items-center gap-1.5"><span className="w-0.5 h-3 bg-blue-400 inline-block" /> 오늘</span>
        {baselineSegments && baselineSegments.length > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-1 rounded-sm inline-block" style={{ background: "rgba(251,146,60,0.7)", border: "1px solid rgba(249,115,22,0.8)" }} />
            기준선
          </span>
        )}
        {projectId && (
          <span className="ml-auto text-gray-300 italic">드래그: 이동 &nbsp;|&nbsp; 양끝 핸들: 기간 조절</span>
        )}
      </div>
    </div>
  );
}
