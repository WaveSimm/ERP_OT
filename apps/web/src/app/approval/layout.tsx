"use client";

import { usePathname, useSearchParams, useRouter } from "next/navigation";
import AppLayout from "@/components/AppLayout";

const TABS = [
  { key: "pending", label: "결재 대기", href: "/approval" },
  { key: "sent", label: "내가 상신", href: "/approval?tab=sent" },
  { key: "completed", label: "완료", href: "/approval?tab=completed" },
  { key: "new", label: "새 결재", href: "/approval/new" },
] as const;

export default function ApprovalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  const isDetailPage = /\/approval\/[^/]+/.test(pathname) && pathname !== "/approval/new";

  let activeTab = "pending";
  if (pathname.startsWith("/approval/new")) activeTab = "new";
  else if (isDetailPage) activeTab = "";
  else activeTab = searchParams.get("tab") || "pending";

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center gap-2 mb-4">
          {isDetailPage && (
            <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600">
              &larr;
            </button>
          )}
          <h1 className="text-2xl font-bold">전자결재</h1>
        </div>

        {!isDetailPage && (
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
        )}

        {children}
      </div>
    </AppLayout>
  );
}
