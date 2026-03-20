"use client";

import { useState, useEffect } from "react";
import { taskApi, milestoneApi, resourceApi } from "@/lib/api";

interface Props {
  projectId: string;
  defaultParentId?: string | null;
  defaultSortOrder?: number;
  onSuccess: () => void;
  onClose: () => void;
}

export default function AddTaskModal({ projectId, defaultParentId, defaultSortOrder, onSuccess, onClose }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [milestoneId, setMilestoneId] = useState("");
  const [isMilestone, setIsMilestone] = useState(false);

  // Regular task segment fields
  const [segName, setSegName] = useState("");
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 10);
  });

  // Milestone task — single date
  const [milestoneDate, setMilestoneDate] = useState(() => new Date().toISOString().slice(0, 10));

  const [resourceId, setResourceId] = useState("");
  const [allocationMode, setAllocationMode] = useState<"PERCENT" | "HOURS">("PERCENT");
  const [allocationPercent, setAllocationPercent] = useState(100);
  const [allocationHoursPerDay, setAllocationHoursPerDay] = useState(8);

  const [milestones, setMilestones] = useState<any[]>([]);
  const [resources, setResources] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    milestoneApi.list(projectId).then(setMilestones).catch(() => {});
    resourceApi.list({ isActive: true }).then(setResources).catch(() => {});
  }, [projectId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError("");
    try {
      const taskData: any = { name: name.trim(), isMilestone };
      if (description.trim()) taskData.description = description.trim();
      if (milestoneId) taskData.milestoneId = milestoneId;
      if (defaultParentId) taskData.parentId = defaultParentId;
      if (defaultSortOrder !== undefined) taskData.sortOrder = defaultSortOrder;

      const task = await taskApi.create(projectId, taskData);

      const segStart = isMilestone ? milestoneDate : startDate;
      const segEnd = isMilestone ? milestoneDate : endDate;
      const segment = await taskApi.createSegment(projectId, task.id, {
        name: isMilestone ? "마일스톤" : (segName.trim() || name.trim()),
        startDate: segStart,
        endDate: segEnd,
      });

      if (!isMilestone && resourceId) {
        const payload: any = { resourceId, allocationMode };
        if (allocationMode === "PERCENT") payload.allocationPercent = allocationPercent;
        else payload.allocationHoursPerDay = allocationHoursPerDay;
        await taskApi.upsertAssignment(projectId, task.id, segment.id, payload);
      }

      onSuccess();
      onClose();
    } catch (e: any) {
      setError(e.message ?? "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between shrink-0">
          <h3 className="font-semibold text-gray-900">태스크 추가</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
          {/* Task name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">태스크명 *</label>
            <input
              type="text" value={name} onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="예: 기초 공사"
              required
            />
          </div>

          {/* Milestone toggle */}
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <div
              onClick={() => setIsMilestone(!isMilestone)}
              className={`w-10 h-5 rounded-full transition-colors relative ${isMilestone ? "bg-purple-600" : "bg-gray-300"}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${isMilestone ? "translate-x-5" : ""}`}
              />
            </div>
            <span className="text-sm font-medium text-gray-700">
              {isMilestone ? "◆ 마일스톤 태스크" : "일반 태스크"}
            </span>
          </label>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">설명</label>
            <textarea
              value={description} onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none text-sm"
              placeholder="태스크 설명 (선택)"
            />
          </div>

          {/* Milestone group */}
          {!isMilestone && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">마일스톤 그룹</label>
              <select
                value={milestoneId} onChange={(e) => setMilestoneId(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              >
                <option value="">-- 마일스톤 없음 --</option>
                {milestones.map((m: any) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Date section */}
          {isMilestone ? (
            /* Milestone: single date */
            <div className="border-t border-purple-100 pt-4">
              <p className="text-xs font-semibold text-purple-500 uppercase mb-3">◆ 마일스톤 날짜</p>
              <div className="max-w-xs">
                <label className="block text-sm font-medium text-gray-700 mb-1">날짜 *</label>
                <input
                  type="date" value={milestoneDate}
                  onChange={(e) => setMilestoneDate(e.target.value)}
                  className="w-full px-3 py-2.5 border border-purple-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
                  required
                />
              </div>
            </div>
          ) : (
            /* Regular: start ~ end with segment name */
            <div className="border-t border-gray-100 pt-4">
              <p className="text-xs font-semibold text-gray-500 uppercase mb-3">초기 구간</p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">구간명</label>
                <input
                  type="text" value={segName} onChange={(e) => setSegName(e.target.value)}
                  placeholder={name.trim() || "구간명"}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">시작일 *</label>
                  <input type="date" value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">종료일 *</label>
                  <input type="date" value={endDate} min={startDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    required
                  />
                </div>
              </div>
            </div>
          )}

          {/* Resource assignment — only for regular tasks */}
          {!isMilestone && resources.length > 0 && (
            <div className="border-t border-gray-100 pt-4">
              <p className="text-xs font-semibold text-gray-500 uppercase mb-3">초기 자원 배정 (선택)</p>
              <select
                value={resourceId} onChange={(e) => setResourceId(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm mb-3"
              >
                <option value="">-- 자원 없음 --</option>
                {resources.map((r: any) => (
                  <option key={r.id} value={r.id}>
                    {r.type === "EQUIPMENT" ? "🔧" : "👤"} {r.name}
                  </option>
                ))}
              </select>
              {resourceId && (
                <div className="flex gap-3">
                  <select
                    value={allocationMode}
                    onChange={(e) => setAllocationMode(e.target.value as "PERCENT" | "HOURS")}
                    className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none text-sm"
                  >
                    <option value="PERCENT">% 배정</option>
                    <option value="HOURS">시간/일</option>
                  </select>
                  {allocationMode === "PERCENT" ? (
                    <input type="number" min={1} max={200}
                      value={allocationPercent}
                      onChange={(e) => setAllocationPercent(Number(e.target.value))}
                      onFocus={(e) => (e.target as HTMLInputElement).select()}
                      className="w-28 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none text-sm"
                      placeholder="배정 %"
                    />
                  ) : (
                    <input type="number" min={0.5} max={24} step={0.5}
                      value={allocationHoursPerDay}
                      onChange={(e) => setAllocationHoursPerDay(Number(e.target.value))}
                      onFocus={(e) => (e.target as HTMLInputElement).select()}
                      className="w-28 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none text-sm"
                      placeholder="시간/일"
                    />
                  )}
                </div>
              )}
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">
              취소
            </button>
            <button type="submit" disabled={saving || !name.trim()}
              className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed text-white ${isMilestone ? "bg-purple-600 hover:bg-purple-700" : "bg-blue-600 hover:bg-blue-700"}`}>
              {saving ? "저장 중..." : "추가"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
