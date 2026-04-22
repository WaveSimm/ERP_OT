"use client";

import { usePathname, useRouter } from "next/navigation";
import AppLayout from "@/components/AppLayout";
import { getUser } from "@/lib/api";

const TABS = [
  { key: "history", label: "처리 이력", href: "/ocr" },
  { key: "scan", label: "새 스캔", href: "/ocr/scan" },
  { key: "templates", label: "템플릿 관리", href: "/ocr/templates", adminOnly: true },
] as const;

function getActiveTab(pathname: string): string {
  if (pathname.startsWith("/ocr/scan")) return "scan";
  if (pathname.startsWith("/ocr/templates")) return "templates";
  return "history";
}

export default function OcrLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const activeTab = getActiveTab(pathname);
  const user = getUser();
  const isAdmin = user?.role === "ADMIN";

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center gap-2 mb-4">
          <h1 className="text-2xl font-bold">OCR 문서인식</h1>
        </div>

        <div className="flex gap-1 border-b border-gray-200 mb-6">
          {TABS.filter((t) => !("adminOnly" in t && t.adminOnly) || isAdmin).map((t) => (
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
