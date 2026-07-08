"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppLayout from "@/components/AppLayout";
import UnifiedBoardSidebar from "@/components/board/UnifiedBoardSidebar";
import SearchBar from "@/components/board/SearchBar";
import WorkLogTimeline from "@/components/work-log/WorkLogTimeline";
import { workLogApi, userManagementApi, getUser } from "@/lib/api";
import { type WorkLogItem } from "@/components/work-log/WorkLogCard";
import { DateInput } from "@/components/ui/DateInput";
import FilterableSelect from "@/components/FilterableSelect";

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

const PAGE_SIZES = [20, 50, 100] as const;

export default function ProjectBoardLandingPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [me, setMe] = useState<{ id: string; role: string } | null>(null);

  const [logs, setLogs] = useState<AllWorkLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState<string>(dateAdd(-30));
  const [to, setTo] = useState<string>(dateAdd(0));
  const [authorFilter, setAuthorFilter] = useState<string>("");
  const [projectFilter, setProjectFilter] = useState<string>("");
  const [searchText, setSearchText] = useState<string>("");
  const [appliedSearch, setAppliedSearch] = useState<string>("");
  // 필터 드롭다운용 전체 목록(로드된 로그가 아닌 완전한 소스)
  const [fullProjects, setFullProjects] = useState<{ id: string; name: string }[]>([]);
  const [fullAuthors, setFullAuthors] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    const token = localStorage.getItem("erp_user");
    if (!token) {
      router.push("/login");
      return;
    }
    const u = getUser();
    if (u) setMe({ id: u.id, role: u.role });
    setMounted(true);
    // 프로젝트·작성자 필터 전체 목록 로드
    workLogApi.myProjects()
      .then((ps: any[]) => setFullProjects((ps ?? []).map((p) => ({ id: p.projectId, name: p.projectName ?? "(이름 없음)" }))))
      .catch(() => {});
    userManagementApi.members(true)
      .then((ms) => setFullAuthors(ms ?? []))
      .catch(() => {});
  }, [router]);

  // 필터·검색·페이지 크기 변경 시 1페이지로 (서버 사이드 필터+페이지네이션)
  useEffect(() => {
    setPage(1);
  }, [from, to, authorFilter, projectFilter, appliedSearch, pageSize]);

  const reload = useCallback(async () => {
    if (!mounted) return;
    setLoading(true);
    setError(null);
    try {
      const data = await workLogApi.feed({
        limit: pageSize,
        offset: (page - 1) * pageSize,
        from: from || undefined,
        to: to || undefined,
        authorId: authorFilter || undefined,
        projectId: projectFilter || undefined,
        q: appliedSearch || undefined,
      });
      setLogs((data.items ?? []) as AllWorkLog[]);
      setTotal(data.total ?? 0);
    } catch (e: any) {
      setError(e?.message ?? "조회 실패");
    } finally {
      setLoading(false);
    }
  }, [mounted, page, pageSize, from, to, authorFilter, projectFilter, appliedSearch]);

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

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const authorOptions = fullAuthors.length > 0
    ? fullAuthors
    : Array.from(new Map(logs.map((l) => [l.authorId, l.authorName])).entries()).map(([id, name]) => ({ id, name }));
  const projectOptions = fullProjects.length > 0
    ? fullProjects
    : Array.from(new Map(logs.filter((l) => l.projectId).map((l) => [l.projectId!, l.projectName ?? "(이름 없음)"])).entries()).map(([id, name]) => ({ id, name }));

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
      <div className="px-6 py-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-sm text-gray-500 flex items-center gap-1.5">
              <Link href="/board" className="hover:text-gray-700">게시판</Link>
              <span>›</span>
              <span className="text-gray-700 font-medium">프로젝트 게시판</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mt-1">프로젝트 게시판</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              전사 프로젝트 비고 통합 — 작성일 최신순 (전 직원 공유)
            </p>
          </div>
        </div>

        <div className="mb-5">
          <SearchBar />
        </div>

        <div className="flex gap-6">
          <UnifiedBoardSidebar />

          <div className="flex-1 min-w-0">
            <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
              <div className="space-y-2">
                {/* 1줄: 프로젝트 · 작성자 */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-gray-700">필터:</span>
                  <FilterableSelect
                    value={projectFilter}
                    onChange={setProjectFilter}
                    options={projectOptions.map((p) => ({ value: p.id, label: p.name }))}
                    placeholder="전체 프로젝트"
                    className="border border-gray-300 rounded px-2 py-1 text-sm bg-white flex items-center justify-between gap-2 w-[500px] max-w-full"
                  />
                  <FilterableSelect
                    value={authorFilter}
                    onChange={setAuthorFilter}
                    options={authorOptions.map((a) => ({ value: a.id, label: a.name }))}
                    placeholder="전체 작성자"
                    className="border border-gray-300 rounded px-2 py-1 text-sm bg-white flex items-center justify-between gap-2 min-w-[170px]"
                  />
                </div>
                {/* 2줄: 날짜 범위 · 구간 버튼 */}
                <div className="flex items-center gap-2 flex-wrap">
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
                  <div className="flex gap-1">
                    <button onClick={() => { setFrom(dateAdd(-7)); setTo(dateAdd(0)); }} className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50">최근 7일</button>
                    <button onClick={() => { setFrom(dateAdd(-30)); setTo(dateAdd(0)); }} className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50">최근 30일</button>
                    <button onClick={() => { setFrom(""); setTo(""); }} className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50">전체</button>
                  </div>
                </div>
              </div>
              <div className="text-xs text-gray-400 mt-2">
                총 {total.toLocaleString()}건 · {page}/{totalPages} 페이지
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
                <WorkLogTimeline
                  logs={logs as any}
                  currentUserId={userId}
                  isAdmin={isAdmin}
                  showTaskName
                  showProjectName
                  groupBy="createdAt"
                  onUpdate={handleUpdate}
                  onDelete={handleDelete}
                />
                <Pagination
                  page={page}
                  totalPages={totalPages}
                  pageSize={pageSize}
                  onPageChange={setPage}
                  onPageSizeChange={setPageSize}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

function pageWindow(page: number, totalPages: number, size = 5): number[] {
  let start = Math.max(1, page - Math.floor(size / 2));
  const end = Math.min(totalPages, start + size - 1);
  start = Math.max(1, end - size + 1);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

function Pagination({
  page,
  totalPages,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  totalPages: number;
  pageSize: number;
  onPageChange: (p: number) => void;
  onPageSizeChange: (s: number) => void;
}) {
  const btn = "px-2.5 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-white";
  return (
    <div className="flex items-center justify-center gap-1 mt-5 flex-wrap">
      <button className={btn} disabled={page <= 1} onClick={() => onPageChange(1)}>«</button>
      <button className={btn} disabled={page <= 1} onClick={() => onPageChange(page - 1)}>‹</button>
      {pageWindow(page, totalPages).map((p) => (
        <button
          key={p}
          onClick={() => onPageChange(p)}
          className={`px-2.5 py-1 text-sm border rounded ${
            p === page
              ? "bg-blue-600 border-blue-600 text-white font-medium"
              : "border-gray-300 hover:bg-gray-50"
          }`}
        >
          {p}
        </button>
      ))}
      <button className={btn} disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>›</button>
      <button className={btn} disabled={page >= totalPages} onClick={() => onPageChange(totalPages)}>»</button>
      <select
        value={pageSize}
        onChange={(e) => onPageSizeChange(Number(e.target.value))}
        className="ml-2 border border-gray-300 rounded px-2 py-1 text-sm bg-white"
      >
        {PAGE_SIZES.map((s) => (
          <option key={s} value={s}>{s}개씩</option>
        ))}
      </select>
    </div>
  );
}
