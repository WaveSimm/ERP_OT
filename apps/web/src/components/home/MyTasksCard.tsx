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

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  NOT_STARTED: { label: "대기", color: "bg-gray-100 text-gray-600" },
  IN_PROGRESS: { label: "진행", color: "bg-blue-100 text-blue-700" },
  COMPLETED: { label: "완료", color: "bg-green-100 text-green-700" },
  ON_HOLD: { label: "보류", color: "bg-amber-100 text-amber-700" },
  BLOCKED: { label: "막힘", color: "bg-red-100 text-red-700" },
  CANCELLED: { label: "취소", color: "bg-gray-100 text-gray-500" },
};

function dDay(endDate: string | null): { label: string; color: string } | null {
  if (!endDate) return null;
  const days = Math.ceil((new Date(endDate).getTime() - Date.now()) / 86400000);
  if (days === 0) return { label: "D-Day", color: "bg-red-100 text-red-700" };
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
  const sorted = [...tasks].sort((a, b) => {
    const aDone = a.taskStatus === "COMPLETED" ? 1 : 0;
    const bDone = b.taskStatus === "COMPLETED" ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    if (!a.endDate) return 1;
    if (!b.endDate) return -1;
    return a.endDate.localeCompare(b.endDate);
  });

  const dueToday = tasks.filter((t) => {
    const today = new Date().toISOString().slice(0, 10);
    return t.endDate === today && t.taskStatus !== "COMPLETED";
  }).length;

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
        ) : tasks.length > 0 ? (
          <span className="text-xs text-gray-500">{tasks.length}건</span>
        ) : null
      }
      loading={loading}
      empty={!loading && tasks.length === 0}
    >
      <ul className="space-y-2">
        {sorted.slice(0, 5).map((t) => {
          const st = STATUS_LABELS[t.taskStatus] ?? { label: t.taskStatus, color: "bg-gray-100 text-gray-600" };
          const dd = dDay(t.endDate);
          return (
            <li key={t.taskId}>
              <Link
                href={`/projects/${t.project.id}`}
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
