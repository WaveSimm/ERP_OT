"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppLayout from "@/components/AppLayout";
import UnifiedBoardSidebar from "@/components/board/UnifiedBoardSidebar";
import SearchBar from "@/components/board/SearchBar";

interface MyProjectBoardItem {
  projectId: string;
  projectName: string;
  status: string;
  logCount: number;
  lastLogAt: string | null;
}
import WorkLogTimeline from "@/components/work-log/WorkLogTimeline";
import { workLogApi, getUser } from "@/lib/api";
import { type WorkLogItem } from "@/components/work-log/WorkLogCard";

interface ProjectWorkLog extends WorkLogItem {
  taskName?: string;
}

function dateAdd(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function ProjectBoardPage({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const router = useRouter();
  const me = getUser();
  const isAdmin = me?.role === "ADMIN";

  const [projects, setProjects] = useState<MyProjectBoardItem[]>([]);
  const [logs, setLogs] = useState<ProjectWorkLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authorFilter, setAuthorFilter] = useState<string>("");
  const [from, setFrom] = useState<string>(dateAdd(-30));
  const [to, setTo] = useState<string>(dateAdd(0));
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchText, setSearchText] = useState<string>("");
  const [appliedSearch, setAppliedSearch] = useState<string>("");

  // 프로젝트 사이드바 로드
  useEffect(() => {
    const token = localStorage.getItem("erp_user");
    if (!token) {
      router.push("/login");
      return;
    }
    workLogApi
      .myProjects()
      .then((data) => setProjects((data ?? []) as MyProjectBoardItem[]))
      .catch((e) => console.error("[sidebar]", e));
  }, [router]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: any = { from, to };
      if (authorFilter) params.authorId = authorFilter;
      const res = await workLogApi.listByProject(projectId, params);
      setLogs((res.items ?? []) as ProjectWorkLog[]);
      setNextCursor(res.nextCursor ?? null);
    } catch (err: any) {
      setError(err?.message ?? "조회 실패");
    } finally {
      setLoading(false);
    }
  }, [projectId, from, to, authorFilter]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const params: any = { from, to, cursor: nextCursor };
      if (authorFilter) params.authorId = authorFilter;
      const res = await workLogApi.listByProject(projectId, params);
      setLogs((prev) => [...prev, ...((res.items ?? []) as ProjectWorkLog[])]);
      setNextCursor(res.nextCursor ?? null);
    } catch (err: any) {
      alert(err?.message ?? "추가 조회 실패");
    } finally {
      setLoadingMore(false);
    }
  };

  const handleUpdate = async (id: string, v: { content: string; workedAt: string }) => {
    await workLogApi.update(id, v);
    await reload();
  };
  const handleDelete = async (id: string) => {
    await workLogApi.remove(id);
    await reload();
  };

  const visibleLogs = appliedSearch
    ? logs.filter((l) => {
        const q = appliedSearch.toLowerCase();
        return (
          (l.content ?? "").toLowerCase().includes(q) ||
          (l.taskName ?? "").toLowerCase().includes(q)
        );
      })
    : logs;

  // 작성자 목록 (현재 결과에서 추출)
  const authorOptions = Array.from(
    new Map(logs.map((l) => [l.authorId, l.authorName])).entries(),
  ).map(([id, name]) => ({ id, name }));

  const currentProject = projects.find((p) => p.projectId === projectId);

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-sm text-gray-500 flex items-center gap-1.5">
              <Link href="/board" className="hover:text-gray-700">게시판</Link>
              <span>›</span>
              <Link href="/work-logs" className="hover:text-gray-700">프로젝트 게시판</Link>
            </div>
            <h2 className="text-xl font-bold text-gray-900 mt-1">
              {currentProject?.projectName ?? "프로젝트 조회 중..."}
            </h2>
            {currentProject && (
              <p className="text-sm text-gray-500 mt-0.5">
                전체 비고 {currentProject.logCount}건
                {currentProject.lastLogAt && <span> · 최근 {currentProject.lastLogAt}</span>}
              </p>
            )}
          </div>
        </div>

        <div className="mb-5">
          <SearchBar />
        </div>

        <div className="flex gap-6">
          <UnifiedBoardSidebar />

          <div className="flex-1 min-w-0">
            <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-gray-700">필터:</span>
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
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                setAppliedSearch(searchText.trim());
              }}
              className="flex gap-2 mb-3"
            >
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="제목·본문 검색"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
              />
              {appliedSearch && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchText("");
                    setAppliedSearch("");
                  }}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  지우기
                </button>
              )}
              <button
                type="submit"
                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                검색
              </button>
            </form>

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
              <>
                {appliedSearch && (
                  <div className="text-xs text-gray-400 mb-2">
                    검색 결과 {visibleLogs.length}건 (전체 {logs.length}건 중)
                  </div>
                )}
                <WorkLogTimeline
                  logs={visibleLogs}
                  currentUserId={me?.id ?? ""}
                  isAdmin={isAdmin}
                  showTaskName
                  onUpdate={handleUpdate}
                  onDelete={handleDelete}
                />
                {nextCursor && (
                  <div className="mt-4 text-center">
                    <button
                      onClick={loadMore}
                      disabled={loadingMore}
                      className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                    >
                      {loadingMore ? "로드 중..." : "더보기"}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
