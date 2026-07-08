"use client";

// 관리(관리부서 전용) 섹션 레이아웃 — 회계팀·경영지원팀·임원·대표이사 + ADMIN.
//   비대상 계정의 직접 URL 접근은 홈으로 돌려보냄 (메뉴 숨김 + 라우트 가드 이중).
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import AppLayout from "@/components/AppLayout";
import { isManagementUser } from "@/lib/management";

const TABS = [
  { key: "attendance", label: "근태현황", href: "/management/attendance" },
];

export default function ManagementLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    isManagementUser().then((ok) => {
      if (!alive) return;
      if (!ok) { router.replace("/me/dashboard"); setAllowed(false); }
      else setAllowed(true);
    });
    return () => { alive = false; };
  }, [router]);

  const activeTab = TABS.find((t) => pathname.startsWith(t.href))?.key;

  if (allowed === null) return <AppLayout><div className="py-16 text-center text-gray-400">확인 중…</div></AppLayout>;
  if (!allowed) return null;

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="sticky top-14 z-30 bg-gray-50 pt-4 pb-0 -mx-4 sm:-mx-6 px-4 sm:px-6 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <h1 className="text-2xl font-bold">관리</h1>
            <span className="text-xs text-gray-400 mt-1.5">관리부서 전용</span>
          </div>
          <div className="flex gap-1 border-b border-gray-200">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => router.push(t.href)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === t.key
                    ? "border-blue-600 text-blue-600 dark:text-blue-400"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        {children}
      </div>
    </AppLayout>
  );
}
