"use client";

// 관리(관리부서 전용) 섹션 레이아웃 — 회계팀·경영지원팀·임원·대표이사 + ADMIN.
//   비대상 계정의 직접 URL 접근은 홈으로 돌려보냄 (메뉴 숨김 + 라우트 가드 이중).
import { useEffect, useRef, useState } from "react";
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

  // 하위 페이지의 전사근태 sticky 바가 이 레이아웃의 sticky 헤더 아래에 붙도록,
  // 헤더 높이를 측정해 --attn-sticky-top(글로벌 헤더 3.5rem + 이 헤더 높이)으로 주입.
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerH, setHeaderH] = useState(112);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeaderH(el.offsetHeight));
    ro.observe(el);
    setHeaderH(el.offsetHeight);
    return () => ro.disconnect();
  }, [allowed]);

  if (allowed === null) return <AppLayout><div className="py-16 text-center text-gray-400">확인 중…</div></AppLayout>;
  if (!allowed) return null;

  return (
    <AppLayout>
      <div className="px-6 pb-6" style={{ ["--attn-sticky-top" as any]: `calc(3.5rem + ${headerH}px)` }}>
        <div ref={headerRef} className="sticky top-14 z-30 bg-gray-50 dark:bg-gray-900 -mx-6 px-6 pt-6 pb-0 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <h1 className="text-2xl font-bold text-gray-900">관리</h1>
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
