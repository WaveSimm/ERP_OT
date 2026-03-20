"use client";

import { useState } from "react";
import { impactApi } from "@/lib/api";
import clsx from "clsx";

interface Props {
  projectId: string;
  tasks: { id: string; name: string }[];
  onClose: () => void;
}

const STATUS_COLOR = {
  DELAYED:   "text-red-600 bg-red-50 border-red-200",
  AHEAD:     "text-green-600 bg-green-50 border-green-200",
  ON_TRACK:  "text-blue-600 bg-blue-50 border-blue-200",
  REMOVED:   "text-gray-500 bg-gray-50 border-gray-200",
};

export default function ImpactPanel({ projectId, tasks, onClose }: Props) {
  const [mode, setMode] = useState<"current" | "whatif">("current");
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [delayDays, setDelayDays] = useState(5);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const runAnalysis = async () => {
    if (!selectedTaskId) { setError("태스크를 선택해주세요."); return; }
    if (delayDays < 1) { setError("지연 일수는 1 이상이어야 합니다."); return; }
    setLoading(true);
    setError("");
    setResult(null);
    try {
      if (mode === "whatif") {
        const res = await impactApi.whatIf(projectId, { taskId: selectedTaskId, delayDays });
        setResult(res);
      } else {
        const res = await impactApi.analyze(projectId, { taskId: selectedTaskId, delayDays });
        setResult(res);
      }
    } catch (e: any) {
      setError(e.message ?? "분석 실패");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">영향 분석</h2>
            <p className="text-xs text-gray-500 mt-0.5">지연 전파 분석 및 What-If 시뮬레이션</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors text-xl font-light">×</button>
        </div>

        {/* Controls */}
        <div className="px-6 py-4 border-b border-gray-100 space-y-3">
          {/* Mode tabs */}
          <div className="flex gap-2">
            <button
              onClick={() => setMode("current")}
              className={clsx(
                "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                mode === "current" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              )}
            >현재 상태 분석</button>
            <button
              onClick={() => setMode("whatif")}
              className={clsx(
                "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                mode === "whatif" ? "bg-purple-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              )}
            >What-If 시뮬레이션</button>
          </div>

          <div className="flex items-center gap-3">
            <select
              value={selectedTaskId}
              onChange={(e) => setSelectedTaskId(e.target.value)}
              className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">태스크 선택</option>
              {tasks.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>

            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600 whitespace-nowrap">지연</label>
              <input
                type="number"
                min={1}
                max={365}
                value={delayDays}
                onFocus={(e) => (e.target as HTMLInputElement).select()}
                onChange={(e) => setDelayDays(Number(e.target.value))}
                className="w-20 text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-500">일</span>
            </div>

            <button
              onClick={runAnalysis}
              disabled={loading}
              className={clsx(
                "px-4 py-1.5 rounded-lg text-sm font-medium text-white transition-colors",
                mode === "whatif" ? "bg-purple-600 hover:bg-purple-700" : "bg-blue-600 hover:bg-blue-700",
                loading && "opacity-60 cursor-not-allowed"
              )}
            >
              {loading ? "분석 중…" : "분석 실행"}
            </button>
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {error && <p className="text-sm text-red-500 mb-4">{error}</p>}

          {!result && !loading && (
            <div className="text-center py-12 text-gray-400">
              <div className="text-4xl mb-3">🔍</div>
              <p className="text-sm">위에서 분석 모드를 선택하고 실행하세요.</p>
            </div>
          )}

          {result && (
            <div className="space-y-4">
              {/* Summary */}
              <div className="rounded-xl border border-gray-200 p-4 bg-gray-50">
                <p className="text-xs text-gray-500 mb-1">
                  {result.isWhatIf ? "⚡ What-If 시뮬레이션 결과" : "📊 현재 상태 분석 결과"}
                </p>
                {result.triggeredTask && (
                  <p className="text-sm font-medium text-gray-800">
                    트리거: <span className="text-red-600">{result.triggeredTask.taskName}</span>
                    {" "}({result.triggeredTask.delayDays > 0 ? `+${result.triggeredTask.delayDays}일 지연` : "기준"})
                  </p>
                )}
                {result.projectEndDateChange && (
                  <div className="mt-2 flex items-center gap-2 text-sm">
                    <span className="text-gray-500">프로젝트 완료일:</span>
                    <span className="font-mono text-gray-700">{result.projectEndDateChange.original}</span>
                    <span className="text-gray-400">→</span>
                    <span className={clsx(
                      "font-mono font-semibold",
                      result.projectEndDateChange.deviationDays > 0 ? "text-red-600" : "text-green-600"
                    )}>
                      {result.projectEndDateChange.projected}
                    </span>
                    {result.projectEndDateChange.deviationDays !== 0 && (
                      <span className={clsx(
                        "text-xs px-1.5 py-0.5 rounded font-medium",
                        result.projectEndDateChange.deviationDays > 0 ? "bg-red-100 text-red-600" : "bg-green-100 text-green-600"
                      )}>
                        {result.projectEndDateChange.deviationDays > 0 ? "+" : ""}{result.projectEndDateChange.deviationDays}일
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Affected tasks */}
              {result.affectedTasks?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    영향받는 태스크 ({result.affectedTasks.length}개)
                  </p>
                  <div className="space-y-2">
                    {result.affectedTasks.map((t: any, i: number) => (
                      <div key={i} className="rounded-lg border border-gray-200 p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-gray-800 flex items-center gap-1.5">
                            {t.isCritical && <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />}
                            {t.taskName}
                          </span>
                          <span className={clsx(
                            "text-xs px-2 py-0.5 rounded-full border font-medium",
                            t.propagatedDelayDays > 0 ? "text-red-600 bg-red-50 border-red-200" : "text-gray-500 bg-gray-50 border-gray-200"
                          )}>
                            +{t.propagatedDelayDays}일
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <span className="font-mono">{t.originalEndDate}</span>
                          <span>→</span>
                          <span className={clsx("font-mono font-medium", t.propagatedDelayDays > 0 ? "text-red-600" : "text-gray-700")}>
                            {t.projectedEndDate}
                          </span>
                        </div>
                        {t.dependencyChain?.length > 0 && (
                          <p className="mt-1 text-[10px] text-gray-400 truncate">
                            체인: {t.dependencyChain.join(" → ")}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {result.affectedTasks?.length === 0 && (
                <div className="text-center py-8 text-gray-400">
                  <div className="text-3xl mb-2">✅</div>
                  <p className="text-sm">영향받는 태스크가 없습니다.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
