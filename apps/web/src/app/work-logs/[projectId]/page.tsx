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
import Pagination from "@/components/Pagination";
import { workLogApi, getUser } from "@/lib/api";
import { type WorkLogItem } from "@/components/work-log/WorkLogCard";
import { DateInput } from "@/components/ui/DateInput";

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
  // 기본 '전체'(날짜필터 없음) — 임포트 비고의 workedAt가 과거/미래로 퍼져 있어 30일 기본은 logCount와 불일치.
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [searchText, setSearchText] = useState<string>("");
  const [appliedSearch, setAppliedSearch] = useState<string>("");
  const [pageSize, setPageSize] = useState<number>(20);   // 20/50/100 선택
  const [page, setPage] = useState<number>(1);

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
      // 페이지네이션은 클라이언트에서 처리하므로 전체를 로드(cursor 루프, 안전캡 5000).
      const base: any = { limit: 200 };
      if (from) base.from = from;
      if (to) base.to = to;
      if (authorFilter) base.authorId = authorFilter;
      const all: ProjectWorkLog[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < 25; i++) {
        const params = cursor ? { ...base, cursor } : base;
        const res = await workLogApi.listByProject(projectId, params);
        all.push(...((res.items ?? []) as ProjectWorkLog[]));
        cursor = res.nextCursor ?? null;
        if (!cursor) break;
      }
      setLogs(all);
      setPage(1);
    } catch (err: any) {
      setError(err?.message ?? "조회 실패");
    } finally {
      setLoading(false);
    }
  }, [projectId, from, to, authorFilter]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 검색/페이지크기 변경 시 1페이지로
  useEffect(() => { setPage(1); }, [appliedSearch, pageSize]);

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

  // 클라이언트 페이지네이션
  const totalPages = Math.max(1, Math.ceil(visibleLogs.length / pageSize));
  const pageSafe = Math.min(page, totalPages);
  const pagedLogs = visibleLogs.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);

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
              <Link href={`/projects/${projectId}`} className="hover:text-blue-600 hover:underline">
                {currentProject?.projectName ?? "프로젝트 조회 중..."}
              </Link>
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
                <DateInput
                  
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="border border-gray-300 rounded px-2 py-1 text-sm"
                />
                <span className="text-gray-400">~</span>
                <DateInput
                  
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
                  <button
                    onClick={() => {
                      setFrom("");
                      setTo("");
                    }}
                    className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50"
                  >
                    전체
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
              <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 dark:text-red-300 mb-4">
                {error}
              </div>
            )}

            {loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs text-gray-400">
                    {appliedSearch
                      ? `검색 결과 ${visibleLogs.length}건 (전체 ${logs.length}건 중)`
                      : `총 ${visibleLogs.length}건`}
                  </div>
                  <label className="text-xs text-gray-500 flex items-center gap-1">
                    페이지당
                    <select
                      value={pageSize}
                      onChange={(e) => setPageSize(Number(e.target.value))}
                      className="border border-gray-300 rounded px-1.5 py-0.5 text-xs"
                    >
                      <option value={20}>20개</option>
                      <option value={50}>50개</option>
                      <option value={100}>100개</option>
                    </select>
                  </label>
                </div>
                <WorkLogTimeline
                  logs={pagedLogs}
                  currentUserId={me?.id ?? ""}
                  isAdmin={isAdmin}
                  showTaskName
                  projectId={projectId}
                  onUpdate={handleUpdate}
                  onDelete={handleDelete}
                />
                {totalPages > 1 && (
                  <div className="mt-4">
                    <Pagination page={pageSafe} totalPages={totalPages} total={visibleLogs.length} onPageChange={setPage} />
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
