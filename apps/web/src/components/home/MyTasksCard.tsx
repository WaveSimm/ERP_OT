"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import HomeCard from "./HomeCard";
import { myTasksApi } from "@/lib/api";

interface MyTask {
  taskId: string;
  taskName: string;
  taskStatus: string;
  isMilestone?: boolean;
  startDate: string | null;
  endDate: string | null;
  overallProgress: number;
  project: { id: string; name: string; status: string };
}

interface ProjectGroup {
  project: { id: string; name: string; status: string };
  tasks: Omit<MyTask, "project">[];
}

// project schema의 TaskStatus enum: TODO, IN_PROGRESS, ON_HOLD, DONE, BLOCKED, CANCELLED
const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  TODO: { label: "대기", color: "bg-gray-100 text-gray-600" },
  IN_PROGRESS: { label: "진행", color: "bg-blue-100 text-blue-700" },
  DONE: { label: "완료", color: "bg-green-100 text-green-700" },
  ON_HOLD: { label: "중단", color: "bg-amber-100 text-amber-700" },
  CANCELLED: { label: "취소", color: "bg-gray-100 text-gray-500" },
};

// 로컬 시간대 기준 오늘 날짜 (YYYY-MM-DD)
function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// 날짜 문자열 단위 D-day 계산 (timezone 영향 없음)
function dDay(endDate: string | null): { label: string; color: string } | null {
  if (!endDate) return null;
  const today = todayLocal();
  // 같은 날짜 → D-Day
  if (endDate === today) return { label: "D-Day", color: "bg-red-100 text-red-700" };
  // 일자 차이 (현지 자정 기준)
  const [ty, tm, td] = today.split("-").map(Number) as [number, number, number];
  const [ey, em, ed] = endDate.split("-").map(Number) as [number, number, number];
  const days = Math.round(
    (Date.UTC(ey, em - 1, ed) - Date.UTC(ty, tm - 1, td)) / 86400000,
  );
  if (days < 0) return { label: `D+${-days}`, color: "bg-red-100 text-red-700" };
  if (days <= 3) return { label: `D-${days}`, color: "bg-amber-100 text-amber-700" };
  return { label: `D-${days}`, color: "bg-gray-100 text-gray-500" };
}

export default function MyTasksCard() {
  const [tasks, setTasks] = useState<MyTask[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    myTasksApi
      .list()
      .then((data: any) => {
        if (cancelled) return;
        const groups = (Array.isArray(data) ? data : []) as ProjectGroup[];
        const flat: MyTask[] = groups.flatMap((g) =>
          (g.tasks ?? []).map((t) => ({ ...t, project: g.project })),
        );
        setTasks(flat);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  // 정렬: 미완료 우선 → 마감 임박순 (endDate 빠른 순) → 미완료 작업 안에 endDate 없으면 후순위
  const isDone = (s: string) => s === "DONE" || s === "CANCELLED";

  // 완료/취소된 태스크는 "내 작업" 위젯에서 제외 (할 일 위주)
  const active = tasks.filter((t) => !isDone(t.taskStatus));

  const sorted = [...active].sort((a, b) => {
    if (!a.endDate) return 1;
    if (!b.endDate) return -1;
    return a.endDate.localeCompare(b.endDate);
  });

  const dueToday = active.filter((t) => t.endDate === todayLocal()).length;

  return (
    <HomeCard
      icon="🗂"
      title="내 작업"
      href="/me/dashboard"
      hrefLabel="내 대시보드"
      badge={
        dueToday > 0 ? (
          <span className="bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 min-w-[16px] text-center">
            오늘 {dueToday}
          </span>
        ) : active.length > 0 ? (
          <span className="text-xs text-gray-500">{active.length}건</span>
        ) : null
      }
      loading={loading}
      empty={!loading && active.length === 0}
    >
      <ul className="space-y-2">
        {sorted.slice(0, 5).map((t) => {
          // 미완료 + endDate 지난 경우 "지연" 라벨로 강조 표시
          const overdue = !isDone(t.taskStatus) && t.endDate && t.endDate < todayLocal();
          const st = overdue
            ? { label: "지연", color: "bg-red-100 text-red-700" }
            : STATUS_LABELS[t.taskStatus] ?? { label: t.taskStatus, color: "bg-gray-100 text-gray-600" };
          const dd = dDay(t.endDate);
          return (
            <li key={t.taskId}>
              <Link
                href={`/projects/${t.project.id}?taskId=${t.taskId}`}
                className="block text-sm hover:bg-gray-50 -mx-2 px-2 py-1 rounded"
              >
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${st.color}`}>
                    {st.label}
                  </span>
                  <span className="flex-1 truncate text-gray-800">
                    {t.isMilestone && <span className="mr-1">🎯</span>}
                    {t.taskName}
                  </span>
                  {dd && (
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${dd.color}`}>
                      {dd.label}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1 ml-12">
                  <span className="text-[11px] text-gray-400 truncate flex-1">{t.project.name}</span>
                  <span className="text-[11px] text-gray-400 shrink-0">{t.overallProgress}%</span>
                </div>
                <div className="ml-12 mt-1 h-1 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all"
                    style={{ width: `${Math.max(2, Math.min(100, t.overallProgress))}%` }}
                  />
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </HomeCard>
  );
}
