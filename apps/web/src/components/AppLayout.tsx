"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { clearToken, getUser } from "@/lib/api";
import clsx from "clsx";

const NAV = [
  { href: "/projects", label: "프로젝트", icon: "📋" },
  { href: "/resources", label: "자원 관리", icon: "👥" },
  { href: "/my-tasks", label: "내 작업", icon: "✅" },
];

const STORAGE_KEY = "erp_last_path";

function getLastPaths(): Record<string, string> {
  try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "{}"); } catch { return {}; }
}
function saveLastPath(section: string, path: string) {
  try {
    const map = getLastPaths();
    map[section] = path;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {}
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "관리자",
  MANAGER: "매니저",
  OPERATOR: "운영자",
  VIEWER: "조회자",
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [currentUser, setCurrentUser] = useState<{ name: string; role: string } | null>(null);

  useEffect(() => {
    setCurrentUser(getUser());
  }, []);

  // 현재 경로를 해당 섹션의 마지막 경로로 저장
  useEffect(() => {
    const section = NAV.find((n) => pathname.startsWith(n.href));
    if (section) saveLastPath(section.href, pathname);
  }, [pathname]);

  const handleNavClick = (href: string) => {
    if (pathname.startsWith(href)) return;
    const last = getLastPaths()[href];
    router.push(last && last.startsWith(href) ? last : href);
  };

  const handleLogout = () => {
    clearToken();
    router.push("/login");
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-20">
        <div className="max-w-full px-6 h-14 flex items-center gap-6">
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-7 h-7 bg-blue-600 rounded-md flex items-center justify-center">
              <span className="text-white text-xs font-bold">ERP</span>
            </div>
            <span className="font-semibold text-gray-900 text-sm">OT 관리</span>
          </div>

          <nav className="flex items-center gap-1">
            {NAV.map((n) => (
              <button
                key={n.href}
                onClick={() => handleNavClick(n.href)}
                className={clsx(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                  pathname.startsWith(n.href)
                    ? "bg-blue-50 text-blue-700"
                    : "text-gray-600 hover:bg-gray-100",
                )}
              >
                <span>{n.icon}</span>
                {n.label}
              </button>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-4">
            {currentUser && (
              <span className="text-sm text-gray-600">
                {currentUser.name}
                <span className="ml-1 text-xs text-gray-400">
                  ({ROLE_LABELS[currentUser.role] ?? currentUser.role})
                </span>
              </span>
            )}
            {currentUser?.role === "ADMIN" && (
              <button
                onClick={() => router.push("/admin/users")}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                사용자 관리
              </button>
            )}
            <button
              onClick={handleLogout}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              로그아웃
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>
    </div>
  );
}
