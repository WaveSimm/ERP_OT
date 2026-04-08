"use client";

import { usePathname, useRouter } from "next/navigation";
import AppLayout from "@/components/AppLayout";

const TABS = [
  { key: "orders", label: "AS 접수", href: "/repair" },
  { key: "customers", label: "고객 관리", href: "/repair/customers" },
  { key: "parts", label: "부품/재고", href: "/repair/parts" },
  { key: "stats", label: "통계", href: "/repair/stats" },
] as const;

function getActiveTab(pathname: string): string {
  if (pathname.startsWith("/repair/customers")) return "customers";
  if (pathname.startsWith("/repair/parts")) return "parts";
  if (pathname.startsWith("/repair/stats")) return "stats";
  return "orders";
}

export default function RepairLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const activeTab = getActiveTab(pathname);
  const isDetailPage = pathname !== "/repair" &&
    !pathname.startsWith("/repair/customers") &&
    !pathname.startsWith("/repair/parts") &&
    !pathname.startsWith("/repair/stats");

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center gap-2 mb-4">
          {isDetailPage && (
            <button onClick={() => router.push("/repair")} className="text-gray-400 hover:text-gray-600">
              &larr;
            </button>
          )}
          <h1 className="text-2xl font-bold">수리 관리</h1>
        </div>

        <div className="flex gap-1 border-b border-gray-200 mb-6">
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
        </div>

        {children}
      </div>
    </AppLayout>
  );
}
