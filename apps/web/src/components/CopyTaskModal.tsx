"use client";

// 프로젝트-관리 PDCA US-32: 태스크 복사 다이얼로그
// 백엔드: services/project/src/application/template.service.ts:copyTask
// 트리거: 태스크 목록 (multi-select toolbar) / TaskDrawer / Gantt 우클릭 메뉴

import { useEffect, useState } from "react";
import { projectApi, taskApi } from "@/lib/api";

interface Props {
  // 단일 또는 다중 task 복사 지원
  tasks: Array<{ id: string; name: string; projectId: string }>;
  /** 현재 프로젝트 ID (대상 선택 시 기본값 + "현재 프로젝트" 라벨) */
  currentProjectId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function CopyTaskModal({ tasks, currentProjectId, onClose, onSuccess }: Props) {
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [targetProjectId, setTargetProjectId] = useState(currentProjectId);
  const [includeSegments, setIncludeSegments] = useState(true);
  const [includeAssignments, setIncludeAssignments] = useState(true);
  const [dateOffsetDays, setDateOffsetDays] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    projectApi
      .list()
      .then((res: any) => {
        const items = Array.isArray(res?.items) ? res.items : Array.isArray(res) ? res : [];
        setProjects(items.map((p: any) => ({ id: p.id, name: p.name })));
      })
      .catch(() => setProjects([]));
  }, []);

  const handleConfirm = async () => {
    if (!targetProjectId) {
      setError("대상 프로젝트를 선택하세요.");
      return;
    }
    if (tasks.length === 0) return;
    setLoading(true);
    setError("");
    try {
      // 단일/다중 모두 bulk-copy 사용 — 선택 세트 내부 parent-child 관계 보존
      const sourceProjectId = tasks[0]!.projectId;
      await taskApi.bulkCopy(sourceProjectId, {
        taskIds: tasks.map((t) => t.id),
        targetProjectId,
        includeSegments,
        includeAssignments,
        dateOffsetDays,
      });
      onSuccess();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? "복사 실패");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4">
          <h2 className="text-lg font-bold text-gray-900">
            태스크 복사 {tasks.length > 1 && <span className="text-sm font-normal text-gray-500">({tasks.length}개)</span>}
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            {tasks.length === 1 ? `"${tasks[0]!.name}"` : `${tasks.length}개 태스크`}를 다른 프로젝트로 복사합니다.
            복사된 태스크 이름에 "(복사)"가 붙습니다.
          </p>
        </div>

        <div className="space-y-4">
          {/* 대상 프로젝트 */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">대상 프로젝트</label>
            <select
              value={targetProjectId}
              onChange={(e) => setTargetProjectId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— 선택 —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.id === currentProjectId ? " (현재 프로젝트)" : ""}
                </option>
              ))}
            </select>
          </div>

          {/* 옵션 */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={includeSegments}
                onChange={(e) => setIncludeSegments(e.target.checked)}
                className="rounded border-gray-300"
              />
              <span>일정(세그먼트)도 함께 복사</span>
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={includeAssignments}
                onChange={(e) => setIncludeAssignments(e.target.checked)}
                disabled={!includeSegments}
                className="rounded border-gray-300 disabled:opacity-50"
              />
              <span className={!includeSegments ? "text-gray-400" : ""}>
                자원 배정도 함께 복사
              </span>
            </label>
            <div className="flex items-center gap-2 text-sm">
              <label className="text-gray-700" htmlFor="copy-date-offset">
                일정 날짜 이동 (일)
              </label>
              <input
                id="copy-date-offset"
                type="number"
                value={dateOffsetDays}
                onChange={(e) => setDateOffsetDays(parseInt(e.target.value || "0", 10))}
                disabled={!includeSegments}
                className="w-20 px-2 py-1 text-sm border border-gray-300 rounded disabled:opacity-50"
              />
              <span className="text-xs text-gray-400">예: 7 → 1주일 뒤</span>
            </div>
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-md disabled:opacity-50"
          >
            취소
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading || !targetProjectId}
            className="px-4 py-2 text-sm bg-blue-600 text-white hover:bg-blue-700 rounded-md disabled:opacity-50"
          >
            {loading ? "복사 중..." : "복사"}
          </button>
        </div>
      </div>
    </div>
  );
}
