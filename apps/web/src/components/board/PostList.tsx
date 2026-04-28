"use client";

import { useEffect, useState } from "react";
import { postApi } from "@/lib/api";
import PostListItem, { type PostListItemData } from "./PostListItem";

export default function PostList({
  boardCode,
  catCode,
  initialSearch = "",
}: {
  boardCode: string;
  catCode: string;
  initialSearch?: string;
}) {
  const [items, setItems] = useState<PostListItemData[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [search, setSearch] = useState(initialSearch);
  const [appliedSearch, setAppliedSearch] = useState(initialSearch);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    postApi
      .list(boardCode, { page, pageSize, search: appliedSearch || undefined })
      .then((res) => {
        if (!cancelled) {
          setItems(res.items);
          setTotal(res.total);
        }
      })
      .catch((e) => console.error("[PostList]", e))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [boardCode, page, pageSize, appliedSearch]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setAppliedSearch(search.trim());
        }}
        className="flex gap-2 mb-3"
      >
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="제목·본문 검색"
          className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          검색
        </button>
      </form>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin w-6 h-6 border-3 border-blue-600 border-t-transparent rounded-full" />
          </div>
        ) : items.length === 0 ? (
          <div className="py-16 text-center text-gray-400 text-sm">등록된 글이 없습니다.</div>
        ) : (
          items.map((p) => <PostListItem key={p.id} post={p} catCode={catCode} />)
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1 mt-4">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1 text-sm rounded border border-gray-300 disabled:opacity-30 hover:bg-gray-50"
          >
            ‹
          </button>
          {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
            let pn: number;
            if (totalPages <= 7) pn = i + 1;
            else if (page <= 4) pn = i + 1;
            else if (page >= totalPages - 3) pn = totalPages - 6 + i;
            else pn = page - 3 + i;
            return (
              <button
                key={pn}
                onClick={() => setPage(pn)}
                className={`px-3 py-1 text-sm rounded ${
                  pn === page ? "bg-blue-600 text-white" : "border border-gray-300 hover:bg-gray-50"
                }`}
              >
                {pn}
              </button>
            );
          })}
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1 text-sm rounded border border-gray-300 disabled:opacity-30 hover:bg-gray-50"
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}
