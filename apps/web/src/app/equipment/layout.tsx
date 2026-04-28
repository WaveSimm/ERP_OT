"use client";

export const dynamic = 'force-dynamic';

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import AppLayout from "@/components/AppLayout";

const TABS = [
  { key: "equipment", label: "장비 관리", href: "/equipment" },
  { key: "sensors", label: "센서 관리", href: "/equipment?tab=sensors" },
  { key: "schedule", label: "전체 일정", href: "/equipment?tab=schedule" },
] as const;

function getActiveTab(pathname: string, searchTab: string | null): string {
  if (pathname.startsWith("/equipment/sensors")) return "sensors";
  if (pathname.startsWith("/equipment/schedule")) return "schedule";
  if (pathname === "/equipment" && (searchTab === "sensors" || searchTab === "schedule")) return searchTab;
  return "equipment";
}

export default function EquipmentLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const activeTab = getActiveTab(pathname, searchParams.get("tab"));
  const isDetailPage = pathname !== "/equipment" && !pathname.startsWith("/equipment/stats");

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-2 mb-4">
          {isDetailPage && (
            <button
              onClick={() => router.push(activeTab === "sensors" ? "/equipment?tab=sensors" : "/equipment")}
              className="text-gray-400 hover:text-gray-600"
            >
              &larr;
            </button>
          )}
          <h1 className="text-2xl font-bold">장비 관리</h1>
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
