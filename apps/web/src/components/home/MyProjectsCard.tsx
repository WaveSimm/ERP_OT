"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import HomeCard from "./HomeCard";
import { meApi } from "@/lib/api";

interface MyProject {
  projectId: string;
  projectName: string;
  status: string;
  segmentCount: number;
  avgProgress: number;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  ACTIVE: { label: "진행중", color: "bg-blue-100 text-blue-700" },
  ON_HOLD: { label: "보류", color: "bg-amber-100 text-amber-700" },
  COMPLETED: { label: "완료", color: "bg-gray-100 text-gray-600" },
  CANCELLED: { label: "취소", color: "bg-red-100 text-red-600" },
  PLANNING: { label: "계획", color: "bg-purple-100 text-purple-700" },
};

export default function MyProjectsCard() {
  const [projects, setProjects] = useState<MyProject[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    meApi
      .getProjects()
      .then((data: any) => {
        if (!cancelled) setProjects((Array.isArray(data) ? data : []) as MyProject[]);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  // 진행 중인 프로젝트 우선, 진행률 낮은 순 (=남은 일이 많은 순)
  const sorted = [...projects].sort((a, b) => {
    const aActive = a.status === "ACTIVE" ? 0 : 1;
    const bActive = b.status === "ACTIVE" ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return (a.avgProgress ?? 0) - (b.avgProgress ?? 0);
  });

  return (
    <HomeCard
      icon="📋"
      title="진행 프로젝트"
      href="/projects"
      hrefLabel="프로젝트"
      badge={
        projects.length > 0 ? (
          <span className="text-xs text-gray-500">{projects.length}개</span>
        ) : null
      }
      loading={loading}
      empty={!loading && projects.length === 0}
    >
      <ul className="space-y-2">
        {sorted.slice(0, 4).map((p) => {
          const st = STATUS_LABELS[p.status] ?? { label: p.status, color: "bg-gray-100 text-gray-600" };
          return (
            <li key={p.projectId}>
              <Link
                href={`/projects/${p.projectId}`}
                className="block text-sm hover:bg-gray-50 -mx-2 px-2 py-1 rounded"
              >
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${st.color}`}>
                    {st.label}
                  </span>
                  <span className="flex-1 truncate text-gray-800">{p.projectName}</span>
                  <span className="text-xs text-gray-400 shrink-0">{p.avgProgress}%</span>
                </div>
                <div className="ml-12 mt-1 h-1 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all"
                    style={{ width: `${Math.max(2, Math.min(100, p.avgProgress))}%` }}
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
