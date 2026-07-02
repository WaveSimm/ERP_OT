"use client";

import type { Dispatch, RefObject, SetStateAction } from "react";
import { useRouter } from "next/navigation";
import UndoRedoControls from "@/components/UndoRedoControls";
import { STATUS_LABELS, avatarColor } from "../_lib";
import ProjectPickerDropdown from "./ProjectPickerDropdown";

interface ProjectHeaderBarProps {
  projHeaderRef: RefObject<HTMLDivElement>;
  pickerRef: RefObject<HTMLDivElement>;
  project: any;
  st: { label: string; color: string } | null;
  showProjectPicker: boolean;
  setShowProjectPicker: Dispatch<SetStateAction<boolean>>;
  projectSearch: string;
  setProjectSearch: Dispatch<SetStateAction<string>>;
  allProjects: any[];
  projectId: string;
  pickerFolders: { id: string; name: string; parentId: string | null }[];
  pickerProjMap: Record<string, string[]>;
  pickerOpenFolders: Record<string, boolean>;
  setPickerOpenFolders: Dispatch<SetStateAction<Record<string, boolean>>>;
  pickerFolderProjOrder: Record<string, string[]>;
  router: ReturnType<typeof useRouter>;
  undoCount: number;
  redoCount: number;
  undoLabel: string | null;
  redoLabel: string | null;
  handleUndo: () => void;
  handleRedo: () => void;
  nonMilestoneTasks: any[];
  doneCount: number;
  criticalCount: number;
  totalWorkDays: number;
  uniqueWorkers: { id: string; name: string }[];
  cpmResult: any;
  setCpmResult: Dispatch<SetStateAction<any>>;
  handleStatusChange: (status: string) => void;
  handleRunCpm: () => void;
  runningCpm: boolean;
  tasks: any[];
  baselines: any[];
  activeBaselineId: string | null;
  setActiveBaselineId: Dispatch<SetStateAction<string | null>>;
  setShowImpactPanel: Dispatch<SetStateAction<boolean>>;
  setShowSummary: Dispatch<SetStateAction<boolean>>;
}

export default function ProjectHeaderBar({
  projHeaderRef,
  pickerRef,
  project,
  st,
  showProjectPicker,
  setShowProjectPicker,
  projectSearch,
  setProjectSearch,
  allProjects,
  projectId,
  pickerFolders,
  pickerProjMap,
  pickerOpenFolders,
  setPickerOpenFolders,
  pickerFolderProjOrder,
  router,
  undoCount,
  redoCount,
  undoLabel,
  redoLabel,
  handleUndo,
  handleRedo,
  nonMilestoneTasks,
  doneCount,
  criticalCount,
  totalWorkDays,
  uniqueWorkers,
  cpmResult,
  setCpmResult,
  handleStatusChange,
  handleRunCpm,
  runningCpm,
  tasks,
  baselines,
  activeBaselineId,
  setActiveBaselineId,
  setShowImpactPanel,
  setShowSummary,
}: ProjectHeaderBarProps) {
  return (
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
  );
}
