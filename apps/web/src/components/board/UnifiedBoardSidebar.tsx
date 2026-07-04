"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { boardApi, workLogApi } from "@/lib/api";

interface BoardItem {
  code: string;
  name: string;
}

interface CategoryWithBoards {
  code: string;
  name: string;
  icon?: string;
  boards: BoardItem[];
}

interface ProjectItem {
  projectId: string;
  projectName: string;
  status: string;
  logCount: number;
  lastLogAt: string | null;
}

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: "bg-blue-500",
  IN_PROGRESS: "bg-blue-500",
  ON_HOLD: "bg-amber-500",
  COMPLETED: "bg-gray-400",
  CANCELLED: "bg-red-400",
  PLANNING: "bg-purple-500",
};

export default function UnifiedBoardSidebar() {
  const pathname = usePathname();
  const [categories, setCategories] = useState<CategoryWithBoards[]>([]);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      boardApi.listCategories().catch(() => []),
      workLogApi.myProjects().catch(() => []),
    ])
      .then(([cats, projs]: any) => {
        if (cancelled) return;
        setCategories((cats ?? []) as CategoryWithBoards[]);
        const sorted = [...((projs ?? []) as ProjectItem[])].sort((a, b) => {
          if (!a.lastLogAt && !b.lastLogAt) return a.projectName.localeCompare(b.projectName);
          if (!a.lastLogAt) return 1;
          if (!b.lastLogAt) return -1;
          return b.lastLogAt.localeCompare(a.lastLogAt);
        });
        setProjects(sorted);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <aside className="w-64 shrink-0">
        <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-center min-h-[200px]">
          <div className="animate-spin w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full" />
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-64 shrink-0">
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {/* NAS 통합검색 (OT-Brain) — 고정 진입점 */}
        <Link
          href="/board/knowledge"
          className={`flex items-center gap-2 px-4 py-3 border-b border-gray-100 ${
            pathname === "/board/knowledge" ? "bg-blue-50" : "bg-gray-50 hover:bg-gray-100"
          }`}
        >
          <span className="text-base">🔎</span>
          <span className={`text-sm font-semibold ${pathname === "/board/knowledge" ? "text-blue-700" : "text-gray-700"}`}>NAS 통합검색</span>
        </Link>
        {categories.map((cat) => (
          <div key={cat.code} className="border-b border-gray-100 last:border-b-0">
            <Link
              href={`/board/${cat.code}`}
              className="flex items-center gap-2 px-4 py-3 bg-gray-50 hover:bg-gray-100 border-b border-gray-100"
            >
              <span className="text-base">{cat.icon}</span>
              <span className="text-sm font-semibold text-gray-700">{cat.name}</span>
              <span className="ml-auto text-xs text-gray-400">{cat.boards.length}</span>
            </Link>
            <nav className="py-1">
              {cat.boards.map((b) => {
                const active = pathname === `/board/${cat.code}/${b.code}` || pathname?.startsWith(`/board/${cat.code}/${b.code}/`);
                return (
                  <Link
                    key={b.code}
                    href={`/board/${cat.code}/${b.code}`}
                    className={`block px-4 py-1.5 text-sm hover:bg-gray-50 ${
                      active ? "bg-blue-50 text-blue-700 font-medium" : "text-gray-600"
                    }`}
                  >
                    <span className="truncate">{b.name}</span>
                  </Link>
                );
              })}
            </nav>
          </div>
        ))}

        {/* 프로젝트 게시판 (작업비고) */}
        <div>
          <Link
            href="/work-logs"
            className="flex items-center gap-2 px-4 py-3 bg-gray-50 hover:bg-gray-100 border-b border-gray-100"
          >
            <span className="text-base">📝</span>
            <span className="text-sm font-semibold text-gray-700">프로젝트 게시판</span>
            <span className="ml-auto text-xs text-gray-400">{projects.length}</span>
          </Link>
          <nav className="py-1 max-h-[260px] overflow-y-auto">
            {projects.length === 0 ? (
              <div className="px-4 py-3 text-xs text-gray-400">
                프로젝트 없음
              </div>
            ) : (
              projects.map((p) => {
                const active = pathname === `/work-logs/${p.projectId}`;
                return (
                  <Link
                    key={p.projectId}
                    href={`/work-logs/${p.projectId}`}
                    className={`block px-4 py-1.5 hover:bg-gray-50 ${
                      active ? "bg-blue-50" : ""
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_COLOR[p.status] ?? "bg-gray-300"}`} />
                      <span className={`text-sm truncate ${active ? "text-blue-700 font-medium" : "text-gray-600"}`}>
                        {p.projectName}
                      </span>
                      {p.logCount > 0 && (
                        <span className="text-[10px] text-gray-400 shrink-0 ml-auto">{p.logCount}</span>
                      )}
                    </div>
                  </Link>
                );
              })
            )}
          </nav>
        </div>
      </div>
    </aside>
  );
}
