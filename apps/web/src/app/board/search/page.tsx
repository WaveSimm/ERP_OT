"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import AppLayout from "@/components/AppLayout";
import UnifiedBoardSidebar from "@/components/board/UnifiedBoardSidebar";
import SearchBar from "@/components/board/SearchBar";
import SearchResultCard from "@/components/board/SearchResultCard";
import { searchApi, type SearchResultItem } from "@/lib/api";

type Scope = "all" | "posts" | "worklogs";

export default function SearchPage() {
  const router = useRouter();
  const params = useSearchParams();
  const q = params.get("q") ?? "";
  const [mounted, setMounted] = useState(false);
  const [items, setItems] = useState<SearchResultItem[]>([]);
  const [took, setTook] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("all");

  useEffect(() => {
    const token = localStorage.getItem("erp_token");
    if (!token) {
      router.push("/login");
      return;
    }
    setMounted(true);
  }, [router]);

  const runSearch = useCallback(async () => {
    if (!q || q.trim().length < 2) {
      setItems([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await searchApi.search(q, { scope, limit: 30 });
      setItems(result.items ?? []);
      setTook(result.took ?? 0);
    } catch (e: any) {
      setError(e?.message ?? "검색 실패");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [q, scope]);

  useEffect(() => {
    if (mounted) void runSearch();
  }, [mounted, runSearch]);

  const counts = {
    all: items.length,
    posts: items.filter((i) => i.type === "post").length,
    worklogs: items.filter((i) => i.type === "worklog").length,
  };

  if (!mounted) {
    return (
      <AppLayout>
        <div className="max-w-7xl mx-auto px-6 py-12 flex items-center justify-center">
          <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="text-sm text-gray-500 flex items-center gap-1.5 mb-3">
          <Link href="/board" className="hover:text-gray-700">게시판</Link>
          <span>›</span>
          <span className="text-gray-700 font-medium">검색</span>
        </div>

        <div className="mb-5">
          <SearchBar initialQuery={q} />
        </div>

        <div className="flex gap-6">
          <UnifiedBoardSidebar />

          <div className="flex-1 min-w-0">
            {q.trim().length === 0 ? (
              <div className="bg-white border border-gray-200 rounded-xl py-16 text-center text-gray-400">
                검색어를 입력해주세요.
              </div>
            ) : q.trim().length < 2 ? (
              <div className="bg-white border border-gray-200 rounded-xl py-16 text-center text-gray-400">
                2자 이상 입력해주세요.
              </div>
            ) : (
              <>
                {/* 탭 + 메타 */}
                <div className="flex items-center gap-1 mb-3 border-b border-gray-200">
                  {(["all", "posts", "worklogs"] as Scope[]).map((s) => {
                    const label = s === "all" ? "전체" : s === "posts" ? "게시판" : "프로젝트 비고";
                    const count = counts[s];
                    return (
                      <button
                        key={s}
                        onClick={() => setScope(s)}
                        className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                          scope === s
                            ? "border-blue-600 text-blue-600"
                            : "border-transparent text-gray-500 hover:text-gray-700"
                        }`}
                      >
                        {label} {scope === "all" && s !== "all" ? `(${count})` : s === scope ? `(${count})` : ""}
                      </button>
                    );
                  })}
                  {!loading && (
                    <span className="ml-auto text-xs text-gray-400 pb-2">
                      {items.length}건 · {took}ms
                    </span>
                  )}
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
                ) : items.length === 0 ? (
                  <div className="bg-white border border-gray-200 rounded-xl py-16 text-center text-sm text-gray-400">
                    <div className="mb-2">관련된 글이 없습니다.</div>
                    <div className="text-xs text-gray-400">
                      💡 다른 검색어를 시도하거나 더 일반적인 표현을 사용해보세요.
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {items
                      .filter((i) => scope === "all" || i.type === (scope === "posts" ? "post" : "worklog"))
                      .map((item) => (
                        <SearchResultCard key={`${item.type}-${item.id}`} item={item} />
                      ))}
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
