"use client";

import { useEffect, useState } from "react";
import { projectApi } from "@/lib/api";
import type { ProjectSummary } from "@/lib/api/types";
import { fmtDate } from "@/lib/datetime";

const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  PLANNING:    { label: "계획",   cls: "bg-gray-100 text-gray-600" },
  IN_PROGRESS: { label: "진행중", cls: "bg-blue-100 text-blue-700" },
  ON_HOLD:     { label: "보류",   cls: "bg-yellow-100 text-yellow-700" },
  COMPLETED:   { label: "완료",   cls: "bg-green-100 text-green-700" },
  CANCELLED:   { label: "취소",   cls: "bg-red-100 text-red-600" },
};

const TYPE_ICON: Record<string, string> = { PERSON: "👤", EXTERNAL: "🧑‍💼", EQUIPMENT: "🔧" };

export default function ProjectSummaryDrawer({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [data, setData] = useState<ProjectSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    projectApi.getSummary(projectId)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [projectId]);

  const st = data ? (STATUS_CFG[data.status] ?? STATUS_CFG.PLANNING) : null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="bg-white w-full max-w-md h-full shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center gap-2 px-5 py-3 border-b shrink-0">
          <h3 className="font-semibold text-gray-900 truncate flex-1">{data?.name ?? "프로젝트 요약"}</h3>
          {st && <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${st.cls}`}>{st.label}</span>}
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none shrink-0">×</button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-5">
          {loading && <p className="text-sm text-gray-400 text-center py-10">불러오는 중...</p>}
          {!loading && !data && <p className="text-sm text-red-500 text-center py-10 dark:text-red-400">요약을 불러오지 못했습니다.</p>}

          {!loading && data && (
            <>
              {/* 기본 정보 */}
              <section className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${data.overallProgress}%` }} />
                  </div>
                  <span className="text-sm font-medium text-gray-700">{data.overallProgress}%</span>
                </div>
                <dl className="grid grid-cols-3 gap-y-1.5 text-sm">
                  <dt className="text-gray-400">기간</dt>
                  <dd className="col-span-2 text-gray-700">{data.startDate ? `${data.startDate} ~ ${data.endDate}` : "일정 없음"}</dd>
                  <dt className="text-gray-400">작성자</dt>
                  <dd className="col-span-2 text-gray-700">{data.creatorName ?? "-"}</dd>
                  <dt className="text-gray-400">소유자</dt>
                  <dd className="col-span-2 text-gray-700">{data.ownerName ?? "-"}</dd>
                  <dt className="text-gray-400">생성일</dt>
                  <dd className="col-span-2 text-gray-700">{fmtDate(data.createdAt)}</dd>
                </dl>
                {data.description && <p className="text-xs text-gray-500 whitespace-pre-wrap border-t pt-2">{data.description}</p>}
              </section>

              {/* 일정 대비 진척 */}
              {data.schedule && (
                <section className="space-y-1.5">
                  <p className="text-xs font-semibold text-gray-400 uppercase">일정 대비 진척</p>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="w-12 text-gray-400 shrink-0">기간 경과</span>
                    <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                      <div className="h-full bg-gray-400 rounded-full" style={{ width: `${data.schedule.elapsedPercent}%` }} />
                    </div>
                    <span className="w-9 text-right text-gray-600">{data.schedule.elapsedPercent}%</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="w-12 text-gray-400 shrink-0">진척</span>
                    <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full" style={{ width: `${data.schedule.progressPercent}%` }} />
                    </div>
                    <span className="w-9 text-right text-gray-600">{data.schedule.progressPercent}%</span>
                  </div>
                  {data.schedule.behindBy > 5 ? (
                    <p className="text-[11px] text-red-600 dark:text-red-400">⚠ 일정 대비 {data.schedule.behindBy}%p 뒤처짐</p>
                  ) : data.schedule.behindBy < -5 ? (
                    <p className="text-[11px] text-green-600 dark:text-green-400">일정보다 {Math.abs(data.schedule.behindBy)}%p 앞섬</p>
                  ) : (
                    <p className="text-[11px] text-gray-400">일정대로 진행 중</p>
                  )}
                </section>
              )}

              {/* 태스크 현황 */}
              <section className="space-y-1.5">
                <p className="text-xs font-semibold text-gray-400 uppercase">태스크 현황 (총 {data.taskStats.total})</p>
                <div className="flex flex-wrap gap-1.5">
                  <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full dark:text-green-300">완료 {data.taskStats.done}</span>
                  <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full dark:text-blue-300">진행 {data.taskStats.inProgress}</span>
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">예정 {data.taskStats.todo}</span>
                  {data.taskStats.blocked > 0 && <span className="text-xs bg-red-50 text-red-600 px-2 py-0.5 rounded-full dark:text-red-400">차단 {data.taskStats.blocked}</span>}
                  {data.taskStats.onHold > 0 && <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">보류 {data.taskStats.onHold}</span>}
                  {data.taskStats.overdue > 0 && <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">지연 {data.taskStats.overdue}</span>}
                </div>
              </section>

              {/* 다가오는 마일스톤 */}
              {data.nextMilestone && (
                <section className="space-y-1">
                  <p className="text-xs font-semibold text-gray-400 uppercase">다가오는 마일스톤{data.milestoneCount > 1 ? ` (총 ${data.milestoneCount})` : ""}</p>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-purple-500 shrink-0 dark:text-purple-400">◆</span>
                    <span className="text-gray-800 flex-1 truncate">{data.nextMilestone.name}</span>
                    <span className="text-xs text-gray-400 shrink-0">{data.nextMilestone.date}</span>
                    <span className={`text-xs font-medium px-1.5 py-0.5 rounded shrink-0 ${data.nextMilestone.dDay < 0 ? "bg-red-100 text-red-700" : data.nextMilestone.dDay <= 3 ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600"}`}>
                      {data.nextMilestone.dDay < 0 ? `${Math.abs(data.nextMilestone.dDay)}일 지남` : data.nextMilestone.dDay === 0 ? "D-Day" : `D-${data.nextMilestone.dDay}`}
                    </span>
                  </div>
                </section>
              )}

              {/* 참여 종류 요약 */}
              <section className="flex flex-wrap gap-1.5">
                <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full dark:text-blue-300">직원 {data.counts.person}</span>
                <span className="text-xs bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full dark:bg-emerald-950 dark:text-emerald-300">외부 {data.counts.external}</span>
                <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full dark:text-amber-300">장비 {data.counts.equipment}</span>
                <span className="text-xs bg-violet-50 text-violet-700 px-2 py-0.5 rounded-full dark:bg-violet-950 dark:text-violet-300">부서 {data.counts.departments}</span>
              </section>

              {/* 참여 부서 */}
              {data.departments.length > 0 && (
                <section className="space-y-1.5">
                  <p className="text-xs font-semibold text-gray-400 uppercase">참여 부서</p>
                  {data.departments.map((d) => (
                    <div key={d.name} className="flex items-center justify-between text-sm">
                      <span className="text-gray-700">{d.name}</span>
                      <span className="text-gray-400">{d.count}명</span>
                    </div>
                  ))}
                </section>
              )}

              {/* 참여 인원 */}
              <section className="space-y-1.5">
                <p className="text-xs font-semibold text-gray-400 uppercase">참여 인원 ({data.participants.length})</p>
                {data.participants.length === 0 ? (
                  <p className="text-xs text-gray-300">배정된 자원이 없습니다.</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-400 border-b">
                        <th className="text-left font-medium py-1">이름</th>
                        <th className="text-left font-medium py-1">부서/소속</th>
                        <th className="text-right font-medium py-1" title="참여 태스크 수">태스크</th>
                        <th className="text-right font-medium py-1" title="평균 투입률">투입</th>
                        <th className="text-right font-medium py-1" title="평균 진척률">진척</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.participants.map((p) => (
                        <tr key={p.resourceId} className="border-b border-gray-50">
                          <td className="py-1.5 text-gray-800">
                            <span className="mr-1">{TYPE_ICON[p.type] ?? "·"}</span>{p.name}
                          </td>
                          <td className="py-1.5 text-gray-500 truncate max-w-[110px]">{p.departmentName ?? p.company ?? "-"}</td>
                          <td className="py-1.5 text-right text-gray-600">{p.taskCount}</td>
                          <td className="py-1.5 text-right text-gray-600">{p.avgContribution}%</td>
                          <td className="py-1.5 text-right text-gray-600">{p.avgProgress}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
