"use client";

import Link from "next/link";

export interface MyProjectBoardItem {
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

export default function ProjectBoardSidebar({
  projects,
  selectedId,
}: {
  projects: MyProjectBoardItem[];
  selectedId: string | null;
}) {
  // 정렬: lastLogAt 최신순 (없으면 뒤로)
  const sorted = [...projects].sort((a, b) => {
    if (!a.lastLogAt && !b.lastLogAt) return a.projectName.localeCompare(b.projectName);
    if (!a.lastLogAt) return 1;
    if (!b.lastLogAt) return -1;
    return b.lastLogAt.localeCompare(a.lastLogAt);
  });

  return (
    <aside className="w-64 shrink-0">
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700">📂 프로젝트</h3>
          <p className="text-xs text-gray-400 mt-0.5">{projects.length}개</p>
        </div>
        <nav className="py-1 max-h-[600px] overflow-y-auto">
          {sorted.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-gray-400">
              참여 프로젝트 없음
            </div>
          ) : (
            sorted.map((p) => {
              const active = p.projectId === selectedId;
              return (
                <Link
                  key={p.projectId}
                  href={`/work-logs/${p.projectId}`}
                  className={`block px-4 py-2.5 hover:bg-gray-50 border-b border-gray-50 last:border-b-0 ${
                    active ? "bg-blue-50" : ""
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_COLOR[p.status] ?? "bg-gray-300"}`} />
                    <span className={`text-sm truncate ${active ? "text-blue-700 dark:text-blue-300 font-medium" : "text-gray-800"}`}>
                      {p.projectName}
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-0.5 ml-3.5">
                    <span className="text-[11px] text-gray-400">
                      비고 {p.logCount}건
                    </span>
                    {p.lastLogAt && (
                      <span className="text-[11px] text-gray-400">{p.lastLogAt}</span>
                    )}
                  </div>
                </Link>
              );
            })
          )}
        </nav>
      </div>
    </aside>
  );
}
