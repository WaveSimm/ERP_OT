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

  // 시범 릴리즈(2026-06-23): 결재 메뉴는 대메뉴에서 숨기되, 경로는 열어둠.
  //   휴가/휴일근무 신청이 /approval/new(전자결재)에 의존하므로 가드를 걸지 않음.

  const isDetailPage = /\/approval\/[^/]+/.test(pathname) && pathname !== "/approval/new";

  let activeTab = "pending";
  if (pathname.startsWith("/approval/new")) activeTab = "new";
  else if (isDetailPage) activeTab = "";
  else activeTab = searchParams.get("tab") || "pending";

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="sticky top-14 z-30 bg-gray-50 pt-4 pb-0 -mx-4 sm:-mx-6 px-4 sm:px-6 mb-6">
          <div className="flex items-center gap-2 mb-4">
            {isDetailPage && (
              <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600">
                &larr;
              </button>
            )}
            <h1 className="text-2xl font-bold">전자결재</h1>
          </div>

          {!isDetailPage && (
            <div className="flex gap-1 border-b border-gray-200">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => router.push(t.href)}
                  className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === t.key
                      ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
                      : "border-transparent text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {children}
      </div>
    </AppLayout>
  );
}
