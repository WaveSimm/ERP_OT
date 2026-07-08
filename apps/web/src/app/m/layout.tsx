"use client";

// 모바일 전용 크롬 — 데스크톱 AppLayout(전체 네비)을 쓰지 않고 최소 상단바만 제공.
// 실제 메뉴(근태·칸반·작업목록)는 하위 DashboardPage(mobile)의 탭 바가 담당.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clearToken, getUser } from "@/lib/api";

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [name, setName] = useState("");

  useEffect(() => {
    const u = getUser();
    if (u) setName(u.name);
  }, []);

  // PC 버전으로 전환 — viewMode=desktop 쿠키로 middleware 리다이렉트 우회
  const goDesktop = () => {
    document.cookie = `viewMode=desktop; path=/; max-age=${60 * 60 * 24 * 30}`;
    router.push("/me/dashboard");
  };

  const handleLogout = () => {
    clearToken();
    router.push("/login");
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="sticky top-0 z-40 bg-white border-b border-gray-200 h-12 flex items-center gap-2 px-3">
        <div className="w-6 h-6 bg-blue-600 rounded flex items-center justify-center shrink-0">
          <span className="text-white text-[10px] font-bold">ERP</span>
        </div>
        <span className="text-sm font-semibold text-gray-800">현장</span>
        <div className="ml-auto flex items-center gap-3 shrink-0">
          {name && <span className="text-xs text-gray-500 max-w-[80px] truncate">{name}</span>}
          <button onClick={goDesktop} className="text-xs text-gray-400 hover:text-gray-600" title="PC 버전으로">
            PC
          </button>
          <button onClick={handleLogout} className="text-xs text-red-500 hover:text-red-600">
            로그아웃
          </button>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
