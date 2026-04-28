"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppLayout from "@/components/AppLayout";
import UnifiedBoardSidebar from "@/components/board/UnifiedBoardSidebar";
import WorkLogTimeline from "@/components/work-log/WorkLogTimeline";
import { workLogApi, getUser } from "@/lib/api";
import { type WorkLogItem } from "@/components/work-log/WorkLogCard";

interface AllWorkLog extends WorkLogItem {
  taskName?: string;
  projectName?: string;
  projectId?: string;
}

function dateAdd(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const LIMIT = 50;

export default function AllWorkLogsPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [me, setMe] = useState<{ id: string; role: string } | null>(null);

  const [logs, setLogs] = useState<AllWorkLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState<string>(dateAdd(-30));
  const [to, setTo] = useState<string>(dateAdd(0));
  const [authorFilter, setAuthorFilter] = useState<string>("");
  const [projectFilter, setProjectFilter] = useState<string>("");

  useEffect(() => {
    const token = localStorage.getItem("erp_token");
    if (!token) {
      router.push("/login");
      return;
    }
    const u = getUser();
    if (u) setMe({ id: u.id, role: u.role });
    setMounted(true);
  }, [router]);

  const reload = useCallback(async () => {
    if (!mounted) return;
    setLoading(true);
    setError(null);
    try {
      // listMine 활용 (본인 작성건만이 아니라 본인 참여 프로젝트의 모든 비고를 위해 listMyProjects + listByProject 조합 또는 기존 listFeed 사용)
      // 1차는 단순히 me/work-log-feed 활용 (날짜 범위는 클라이언트 필터)
      const limit = 200;
      const data = await workLogApi.feed({ limit });
      const filtered = (data ?? []).filter((w: any) => {
        if (from && w.workedAt < from) return false;
        if (to && w.workedAt > to) return false;
        if (authorFilter && w.authorId !== authorFilter) return false;
        if (projectFilter && w.projectId !== projectFilter) return false;
        return true;
      }) as AllWorkLog[];
      setLogs(filtered.slice(0, LIMIT * 4));
    } catch (e: any) {
      setError(e?.message ?? "조회 실패");
    } finally {
      setLoading(false);
    }
  }, [mounted, from, to, authorFilter, projectFilter]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleUpdate = async (id: string, v: { content: string; workedAt: string }) => {
    await workLogApi.update(id, v);
    await reload();
  };
  const handleDelete = async (id: string) => {
    await workLogApi.remove(id);
    await reload();
  };

  // 필터용 옵션 (현재 결과 기준)
  const authorOptions = Array.from(
    new Map(logs.map((l) => [l.authorId, l.authorName])).entries(),
  ).map(([id, name]) => ({ id, name }));
  const projectOptions = Array.from(
    new Map(logs.filter((l) => l.projectId).map((l) => [l.projectId!, l.projectName ?? "(이름 없음)"])).entries(),
  ).map(([id, name]) => ({ id, name }));

  if (!mounted) {
    return (
      <AppLayout>
        <div className="max-w-7xl mx-auto px-6 py-12 flex items-center justify-center">
          <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
        </div>
      </AppLayout>
    );
  }

  const isAdmin = me?.role === "ADMIN";
  const userId = me?.id ?? "";

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-sm text-gray-500 flex items-center gap-1.5">
              <Link href="/board" className="hover:text-gray-700">게시판</Link>
              <span>›</span>
              <Link href="/work-logs" className="hover:text-gray-700">프로젝트 게시판</Link>
              <span>›</span>
              <span className="text-gray-700 font-medium">전체</span>
            </div>
            <h2 className="text-xl font-bold text-gray-900 mt-1">📂 전체 비고</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              본인 참여 프로젝트{isAdmin && " (ADMIN: 전체 프로젝트)"}의 모든 비고 통합
            </p>
          </div>
        </div>

        <div className="flex gap-6">
          <UnifiedBoardSidebar />

          <div className="flex-1 min-w-0">
            <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-gray-700">필터:</span>
                <select
                  value={projectFilter}
                  onChange={(e) => setProjectFilter(e.target.value)}
                  className="border border-gray-300 rounded px-2 py-1 text-sm"
                >
                  <option value="">전체 프로젝트</option>
                  {projectOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <select
                  value={authorFilter}
                  onChange={(e) => setAuthorFilter(e.target.value)}
                  className="border border-gray-300 rounded px-2 py-1 text-sm"
                >
                  <option value="">전체 작성자</option>
                  {authorOptions.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="border border-gray-300 rounded px-2 py-1 text-sm"
                />
                <span className="text-gray-400">~</span>
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="border border-gray-300 rounded px-2 py-1 text-sm"
                />
                <div className="ml-auto flex gap-1">
                  <button
                    onClick={() => {
                      setFrom(dateAdd(-7));
                      setTo(dateAdd(0));
                    }}
                    className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50"
                  >
                    최근 7일
                  </button>
                  <button
                    onClick={() => {
                      setFrom(dateAdd(-30));
                      setTo(dateAdd(0));
                    }}
                    className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50"
                  >
                    최근 30일
                  </button>
                </div>
              </div>
              <div className="text-xs text-gray-400 mt-2">총 {logs.length}건</div>
            </div>

            {error && (
              <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 mb-4">
                {error}
              </div>
            )}

            {loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
              </div>
            ) : (
              <WorkLogTimeline
                logs={logs as any}
                currentUserId={userId}
                isAdmin={isAdmin}
                showTaskName
                showProjectName
                onUpdate={handleUpdate}
                onDelete={handleDelete}
              />
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
