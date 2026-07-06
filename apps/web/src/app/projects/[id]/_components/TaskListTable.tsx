"use client";

import React, { Fragment } from "react";
import type { Dispatch, SetStateAction, RefObject } from "react";
import { DateInput } from "@/components/ui/DateInput";
import { RowContextMenu } from "@/components/RowContextMenu";
import CommentPopover from "@/components/CommentPopover";
import ResourcePickerPopover from "@/components/ResourcePickerPopover";
import {
  TASK_STATUS_COLORS, TASK_STATUS_LABELS, isOverdue,
  type ColId, COL_CFG,
} from "../_lib";

interface TaskListTableProps {
  selected: Set<string>;
  selToolbarRef: RefObject<HTMLDivElement>;
  selToolbarH: number;
  isOperator: boolean;
  flatItems: { task: any; depth: number }[];
  colOrder: ColId[];
  colDragging: ColId | null;
  colDropGap: { id: ColId; pos: "before" | "after" } | null;
  collapsed: Set<string>;
  dragIds: string[];
  dropGap: { taskId: string; pos: "before" | "after" } | null;
  editingCell: { taskId: string; col: "status" | "progress" | "dates" | "note" } | null;
  editVal: any;
  editingNameId: string | null;
  editNameVal: string;
  parentTaskIds: Set<string>;
  projectId: string;
  resources: any[];
  inlineTaskName: string;
  inlineAdding: boolean;
  handleOutdent: () => void;
  handleIndent: () => void;
  handleCopySelected: () => void;
  handleDeleteSelected: () => void;
  setSelected: Dispatch<SetStateAction<Set<string>>>;
  toggleAll: () => void;
  handleColDragStart: (e: React.DragEvent, col: ColId) => void;
  handleColDragOver: (e: React.DragEvent, col: ColId) => void;
  handleColDrop: (e: React.DragEvent, col: ColId) => void;
  setColDragging: Dispatch<SetStateAction<ColId | null>>;
  setColDropGap: Dispatch<SetStateAction<{ id: ColId; pos: "before" | "after" } | null>>;
  handleRowDragOver: (e: React.DragEvent, taskId: string) => void;
  handleRowDrop: (e: React.DragEvent) => void;
  clearDragState: () => void;
  handleDragStart: (e: React.DragEvent, taskId: string) => void;
  handleTaskClick: (task: any, e?: React.MouseEvent) => void;
  createTaskAbove: (clicked: any) => void;
  createTaskBelow: (clicked: any) => void;
  setEditingNameId: Dispatch<SetStateAction<string | null>>;
  setEditNameVal: Dispatch<SetStateAction<string>>;
  setCopyTargets: Dispatch<SetStateAction<Array<{ id: string; name: string; projectId: string }> | null>>;
  handleDeleteTask: (taskId: string, taskName: string) => void;
  toggleSelect: (id: string, e: React.MouseEvent) => void;
  setCollapsed: Dispatch<SetStateAction<Set<string>>>;
  saveTaskName: (taskId: string, name: string) => void;
  startEdit: (taskId: string, col: "status" | "progress" | "dates" | "note", val: any) => void;
  saveStatus: (taskId: string, status: string) => void;
  cancelEdit: () => void;
  setEditVal: Dispatch<SetStateAction<any>>;
  saveDates: (task: any, start: string, end: string) => void;
  setInlineTaskName: Dispatch<SetStateAction<string>>;
  createInlineTask: () => void;
  setAddAsMilestone: Dispatch<SetStateAction<boolean>>;
  setShowAddTask: Dispatch<SetStateAction<boolean>>;
  load: () => Promise<void>;
  pushUndo: (entry: any) => void;
}

export default function TaskListTable({
  selected,
  selToolbarRef,
  selToolbarH,
  isOperator,
  flatItems,
  colOrder,
  colDragging,
  colDropGap,
  collapsed,
  dragIds,
  dropGap,
  editingCell,
  editVal,
  editingNameId,
  editNameVal,
  parentTaskIds,
  projectId,
  resources,
  inlineTaskName,
  inlineAdding,
  handleOutdent,
  handleIndent,
  handleCopySelected,
  handleDeleteSelected,
  setSelected,
  toggleAll,
  handleColDragStart,
  handleColDragOver,
  handleColDrop,
  setColDragging,
  setColDropGap,
  handleRowDragOver,
  handleRowDrop,
  clearDragState,
  handleDragStart,
  handleTaskClick,
  createTaskAbove,
  createTaskBelow,
  setEditingNameId,
  setEditNameVal,
  setCopyTargets,
  handleDeleteTask,
  toggleSelect,
  setCollapsed,
  saveTaskName,
  startEdit,
  saveStatus,
  cancelEdit,
  setEditVal,
  saveDates,
  setInlineTaskName,
  createInlineTask,
  setAddAsMilestone,
  setShowAddTask,
  load,
  pushUndo,
}: TaskListTableProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-clip">
      {/* Multi-select toolbar — 스크롤해도 상단(글로벌 헤더 h-14 아래)에 고정 */}
      {selected.size > 0 && (
        <div ref={selToolbarRef} className="sticky z-[25] flex items-center gap-2 px-4 py-2 bg-blue-50 border-b border-blue-100" style={{ top: "var(--top-chrome, 56px)" }}>
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
          <div className="h-3 w-px bg-blue-200" />
          {isOperator && (
            <button
              onClick={handleCopySelected}
              className="flex items-center gap-1 px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded border border-blue-200"
              title="선택한 태스크를 다른 프로젝트로 복사"
            >
              📋 복사
            </button>
          )}
          {isOperator && (
            <button onClick={handleDeleteSelected}
              className="flex items-center gap-1 px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded border border-red-200">
              🗑 선택 삭제
            </button>
          )}
          <button onClick={() => setSelected(new Set())}
            className="text-xs text-gray-400 hover:text-gray-600">선택 해제</button>
        </div>
      )}

      <table className="w-full text-sm select-none">
        {/* 열 제목 — 스크롤해도 상단 고정. top = 상단 고정프레임 + 선택 툴바 높이 */}
        <thead className="sticky z-[23] bg-gray-50" style={{ top: `calc(var(--top-chrome, 56px) + ${selToolbarH}px)` }}>
          <tr className="border-b border-gray-200 bg-gray-50">
            <th className="w-6" />
            <th className="px-3 py-2 w-8" onClick={toggleAll}>
              <input type="checkbox" readOnly
                checked={selected.size === flatItems.length && flatItems.length > 0}
                className="cursor-pointer" />
            </th>
            <th className="text-left px-3 py-2 font-semibold text-gray-600 text-xs w-64">태스크명</th>
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
              <RowContextMenu
                fallbackToBrowser
                items={[
                  { label: "편집/상세", icon: "📄", onClick: () => handleTaskClick(task) },
                  { label: "위에 태스크 추가", icon: "➕", onClick: () => createTaskAbove(task), visible: !!isOperator },
                  { label: "아래에 태스크 추가", icon: "➕", onClick: () => createTaskBelow(task), visible: !!isOperator },
                  { label: "이름 수정", icon: "✏️", onClick: () => { setEditingNameId(task.id); setEditNameVal(task.name); }, visible: !!isOperator },
                  { label: "복사", icon: "📋", onClick: () => setCopyTargets([{ id: task.id, name: task.name, projectId }]), visible: !parentTaskIds.has(task.id) && !!isOperator },
                  { separator: true, visible: !!isOperator },
                  { label: "삭제", icon: "🗑", onClick: () => handleDeleteTask(task.id, task.name), destructive: true, visible: !!isOperator },
                ]}
              >
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
                {/* 체크박스 — td 전체가 hitbox */}
                <td className="px-3 text-center cursor-pointer" onClick={(e) => toggleSelect(task.id, e)}>
                  <input type="checkbox" readOnly checked={isSel} className="pointer-events-none" />
                </td>
                {/* 태스크명 */}
                <td className="px-2 cursor-pointer hover:bg-blue-50/60"
                  onClick={(e) => { if (e.detail > 1) return; handleTaskClick(task, e); }}
                  onDoubleClick={isOperator ? (e) => { e.stopPropagation(); setEditingNameId(task.id); setEditNameVal(task.name); } : undefined}>
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
                    {editingNameId === task.id ? (
                      <input
                        autoFocus
                        value={editNameVal}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setEditNameVal(e.target.value)}
                        onBlur={() => saveTaskName(task.id, editNameVal)}
                        onKeyDown={(e) => { if (e.key === "Enter") saveTaskName(task.id, editNameVal); if (e.key === "Escape") setEditingNameId(null); }}
                        className="text-xs font-medium border border-blue-400 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500 min-w-0 flex-1"
                      />
                    ) : (
                      <span
                        className={`text-xs font-medium truncate ${task.isMilestone ? "text-purple-700" : task.isCritical ? "text-red-600" : depth === 0 ? "text-gray-900" : "text-gray-600"}`}>
                        {task.isMilestone && <span className="mr-1 text-purple-400">◆</span>}
                        {task.name}
                      </span>
                    )}
                    {task.commentCount > 0 && (
                      <span className="ml-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <CommentPopover taskId={task.id} count={task.commentCount} />
                      </span>
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
                      ) : (() => {
                        const overdue = isOverdue(task);
                        const cls = overdue ? "bg-red-100 text-red-700" : (TASK_STATUS_COLORS[task.status] ?? "");
                        const label = overdue ? "지연" : (TASK_STATUS_LABELS[task.status] ?? task.status);
                        return (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium cursor-pointer hover:opacity-75 ${cls}`}>
                            {label}
                          </span>
                        );
                      })()}
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
                        <div className="flex items-center gap-1.5" title="하위 태스크 평균으로 자동 계산됩니다">
                          <div className="w-14 h-1 bg-gray-200 rounded-full overflow-hidden">
                            <div className="h-full bg-indigo-400 rounded-full" style={{ width: `${task.overallProgress}%` }} />
                          </div>
                          <span className="text-[11px] text-gray-400 tabular-nums">{task.overallProgress.toFixed(0)}%</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5" title="자원별 분담율 가중 진척률(자동 계산)">
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
                        pushUndo={pushUndo}
                      />
                    </td>
                  );
                  if (col === "note") {
                    // 비고 = 최신 작업일지(workLog). 없으면 기존 description 폴백. 클릭 시 행→드로어(작업일지 탭)로 추가/편집.
                    const wl = task.latestWorkLog;
                    const text = wl?.content ?? task.description ?? "";
                    const tip = wl
                      ? `${wl.workedAt} · ${wl.authorName}\n${wl.content}`
                      : (task.description ? `(이전 비고)\n${task.description}` : "작업일지 없음 — 클릭해 추가");
                    return (
                      <td key="note" className="px-2" title={tip}>
                        {text ? (
                          <span className="text-[11px] text-gray-600 truncate block max-w-[120px]">
                            {text}
                          </span>
                        ) : (
                          <span className="text-[11px] text-gray-300 hover:text-gray-400">+ 작업일지</span>
                        )}
                      </td>
                    );
                  }
                  return null;
                })}
                <td className="px-1 text-center" onClick={(e) => e.stopPropagation()}>
                  {isOperator && (
                    <button onClick={() => handleDeleteTask(task.id, task.name)}
                      className="text-gray-300 hover:text-red-500 text-xs opacity-0 group-hover/row:opacity-100" title="삭제">🗑</button>
                  )}
                </td>
              </tr>
              </RowContextMenu>

              {/* 기간 편집 확장 행 */}
              {isEditDates && (
                <tr className="bg-blue-50 border-b border-blue-100">
                  <td colSpan={9} className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-3">
                      <span className="text-[11px] text-gray-500 shrink-0">기간 수정</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-gray-400">시작</span>
                        <DateInput value={editVal.start}
                          onChange={(e) => setEditVal((prev: any) => ({ ...prev, start: e.target.value }))}
                          className="text-[11px] px-1.5 py-0.5 border border-gray-200 rounded w-[120px]" />
                      </div>
                      <span className="text-[10px] text-gray-300">~</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-gray-400">종료</span>
                        <DateInput value={editVal.end}
                          onChange={(e) => setEditVal((prev: any) => ({ ...prev, end: e.target.value }))}
                          className="text-[11px] px-1.5 py-0.5 border border-gray-200 rounded w-[120px]" />
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
      {/* 하단 추가영역 — 스크롤해도 화면 하단에 고정 */}
      <div className="sticky bottom-0 z-[25] bg-white">
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
      {/* 상세 추가 버튼 — 인라인 입력으로 부족할 때 모달 호출 */}
      {isOperator && (
        <div className="border-t border-gray-100 px-3 py-2 flex items-center gap-2">
          <button
            onClick={() => { setAddAsMilestone(false); setShowAddTask(true); }}
            className="bg-blue-600 text-white px-3 py-1 rounded-lg text-xs font-semibold hover:bg-blue-700"
            title="일정·자원·하위태스크까지 한 번에 입력"
          >
            + 태스크
          </button>
          <button
            onClick={() => { setAddAsMilestone(true); setShowAddTask(true); }}
            className="bg-purple-600 text-white px-3 py-1 rounded-lg text-xs font-semibold hover:bg-purple-700"
            title="◆ 시점 마일스톤 (입찰 확인·납품 등)"
          >
            ◆ 마일스톤
          </button>
          <span className="text-[10px] text-gray-400 ml-2">상세 옵션이 필요할 때</span>
        </div>
      )}
      </div>
    </div>
  );
}
