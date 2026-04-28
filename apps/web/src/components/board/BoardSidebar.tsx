"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface BoardSidebarItem {
  code: string;
  name: string;
  description?: string | null;
}

export default function BoardSidebar({
  catCode,
  catName,
  boards,
  unreadByBoard,
}: {
  catCode: string;
  catName: string;
  boards: BoardSidebarItem[];
  unreadByBoard?: Record<string, number>;
}) {
  const pathname = usePathname();

  return (
    <aside className="w-56 shrink-0">
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700">{catName}</h3>
        </div>
        <nav className="py-1">
          <Link
            href={`/board/${catCode}`}
            className={`block px-4 py-2 text-sm hover:bg-gray-50 ${
              pathname === `/board/${catCode}` ? "bg-blue-50 text-blue-700 font-medium" : "text-gray-600"
            }`}
          >
            <span>📂 전체</span>
          </Link>
          {boards.map((b) => {
            const active = pathname === `/board/${catCode}/${b.code}`;
            const unread = unreadByBoard?.[b.code] ?? 0;
            return (
              <Link
                key={b.code}
                href={`/board/${catCode}/${b.code}`}
                className={`block px-4 py-2 text-sm hover:bg-gray-50 ${
                  active ? "bg-blue-50 text-blue-700 font-medium" : "text-gray-600"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="truncate">{b.name}</span>
                  {unread > 0 && (
                    <span className="bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 min-w-[16px] text-center">
                      {unread > 99 ? "99+" : unread}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
