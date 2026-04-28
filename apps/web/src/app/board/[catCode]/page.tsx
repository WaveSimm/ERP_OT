"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppLayout from "@/components/AppLayout";
import UnifiedBoardSidebar from "@/components/board/UnifiedBoardSidebar";
import PostListItem, { type PostListItemData } from "@/components/board/PostListItem";
import SearchBar from "@/components/board/SearchBar";
import { boardApi, postApi } from "@/lib/api";

interface BoardItem {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  category: { code: string; name: string };
}

export default function CategoryPage({ params }: { params: { catCode: string } }) {
  const { catCode } = params;
  const router = useRouter();
  const [boards, setBoards] = useState<BoardItem[]>([]);
  const [items, setItems] = useState<Array<PostListItemData & { boardCode: string }>>([]);
  const [catName, setCatName] = useState("");
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("erp_token");
    if (!token) {
      router.push("/login");
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const cats = await boardApi.listCategories();
        const cat = (cats as any[]).find((c) => c.code === catCode);
        if (!cat) {
          if (!cancelled) setLoading(false);
          return;
        }
        if (!cancelled) {
          setCatName(cat.name);
          setBoards(cat.boards);
        }

        // 카테고리 통합: 모든 보드의 글을 모아서 시간순으로 (간단히 각 보드에서 페치)
        const allItems: Array<PostListItemData & { boardCode: string }> = [];
        for (const b of cat.boards) {
          const res = await postApi.list(b.code, { page: 1, pageSize: 10 });
          for (const p of res.items) {
            allItems.push({ ...(p as PostListItemData), boardCode: b.code });
          }
        }
        // 핀 우선 → 발행일 desc 통합 정렬
        allItems.sort((a, b) => {
          if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
          return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
        });
        if (!cancelled) setItems(allItems.slice(0, 30));
      } catch (e) {
        console.error("[category] load error:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [catCode, router]);

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <Link href="/board" className="text-sm text-gray-500 hover:text-gray-700">
              ← 게시판
            </Link>
            <h2 className="text-xl font-bold text-gray-900 mt-1">{catName}</h2>
          </div>
        </div>

        <div className="mb-5">
          <SearchBar />
        </div>

        <div className="flex gap-6">
          <UnifiedBoardSidebar />

          <div className="flex-1 min-w-0">
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

            {(() => {
              const visibleItems = appliedSearch
                ? items.filter((p) => {
                    const q = appliedSearch.toLowerCase();
                    return (
                      (p.title ?? "").toLowerCase().includes(q) ||
                      (p.summary ?? "").toLowerCase().includes(q)
                    );
                  })
                : items;
              if (loading) {
                return (
                  <div className="flex items-center justify-center py-16">
                    <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
                  </div>
                );
              }
              if (visibleItems.length === 0) {
                return (
                  <div className="bg-white border border-gray-200 rounded-xl py-16 text-center text-gray-400 text-sm">
                    {appliedSearch ? "검색 결과가 없습니다." : "등록된 글이 없습니다."}
                  </div>
                );
              }
              return (
                <>
                  {appliedSearch && (
                    <div className="text-xs text-gray-400 mb-2">
                      검색 결과 {visibleItems.length}건 (전체 {items.length}건 중)
                    </div>
                  )}
                  <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                    {visibleItems.map((p) => (
                      <PostListItem key={p.id} post={p} catCode={catCode} />
                    ))}
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
