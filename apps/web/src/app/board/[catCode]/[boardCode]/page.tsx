"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppLayout from "@/components/AppLayout";
import UnifiedBoardSidebar from "@/components/board/UnifiedBoardSidebar";
import SearchBar from "@/components/board/SearchBar";
import PostList from "@/components/board/PostList";
import { boardApi } from "@/lib/api";

export default function BoardPage({ params }: { params: { catCode: string; boardCode: string } }) {
  const { catCode, boardCode } = params;
  const router = useRouter();
  const [board, setBoard] = useState<any>(null);
  const [boards, setBoards] = useState<any[]>([]);
  const [catName, setCatName] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("erp_user");
    if (!token) {
      router.push("/login");
      return;
    }

    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [b, cats] = await Promise.all([boardApi.getBoard(boardCode), boardApi.listCategories()]);
        if (cancelled) return;
        setBoard(b);
        const cat = (cats as any[]).find((c) => c.code === catCode);
        if (cat) {
          setCatName(cat.name);
          setBoards(cat.boards);
        }
      } catch (e) {
        console.error("[board] load error:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [boardCode, catCode, router]);

  return (
    <AppLayout>
      <div className="px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="text-sm text-gray-500 flex items-center gap-1.5">
              <Link href="/board" className="hover:text-gray-700">게시판</Link>
              <span>›</span>
              <Link href={`/board/${catCode}`} className="hover:text-gray-700">{catName}</Link>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mt-1">{board?.name ?? "로딩..."}</h1>
            {board?.description && <p className="text-sm text-gray-500 mt-0.5">{board.description}</p>}
          </div>
          <Link
            href={`/board/${catCode}/${boardCode}/write`}
            className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            + 글쓰기
          </Link>
        </div>

        <div className="mb-5">
          <SearchBar />
        </div>

        <div className="flex gap-6">
          <UnifiedBoardSidebar />
          <div className="flex-1 min-w-0">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
              </div>
            ) : (
              <PostList boardCode={boardCode} catCode={catCode} />
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
