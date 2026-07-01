"use client";

import { usePathname, useRouter } from "next/navigation";
import AppLayout from "@/components/AppLayout";

const TABS = [
  { key: "orders", label: "AS 현황", href: "/repair" },
  { key: "parts", label: "수리용부품", href: "/repair/parts" },
  { key: "customers", label: "고객사", href: "/repair/customers" },
  { key: "suppliers", label: "제조사/공급사", href: "/repair/suppliers" },
  { key: "stats", label: "통계", href: "/repair/stats" },
] as const;

function getActiveTab(pathname: string): string {
  if (pathname.startsWith("/repair/parts")) return "parts";
  if (pathname.startsWith("/repair/customers")) return "customers";
  if (pathname.startsWith("/repair/suppliers")) return "suppliers";
  if (pathname.startsWith("/repair/stats")) return "stats";
  return "orders";
}

export default function RepairLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const activeTab = getActiveTab(pathname);
  // AS 접수 상세 페이지(/repair/[id])에만 상단 back 버튼 노출.
  // 고객사·제조사/공급사 상세는 각 페이지 자체 back 버튼이 있음.
  const isDetailPage =
    activeTab === "orders" && pathname !== "/repair";

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="sticky top-14 z-30 bg-gray-50 pt-4 pb-0 -mx-4 sm:-mx-6 px-4 sm:px-6 mb-6">
          <div className="flex items-center gap-2 mb-4">
            {isDetailPage && (
              <button onClick={() => router.push("/repair")} className="text-gray-400 hover:text-gray-600">
                &larr;
              </button>
            )}
            <h1 className="text-2xl font-bold">수리 관리</h1>
          </div>

          <div className="flex items-center gap-1 border-b border-gray-200">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => router.push(t.href)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === t.key
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                {t.label}
              </button>
            ))}
            <a
              href="/manual-as/index.html"
              target="_blank"
              rel="noopener noreferrer"
              title="AS 관리 사용자 매뉴얼 (새 탭)"
              className="ml-auto px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-blue-600 border border-gray-200 hover:border-blue-300 rounded-lg transition-colors"
            >
              📘 매뉴얼
            </a>
          </div>
        </div>

        {children}
      </div>
    </AppLayout>
  );
}
