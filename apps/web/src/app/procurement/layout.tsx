"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import AppLayout from "@/components/AppLayout";
import { getUser } from "@/lib/api";

const TABS = [
  { key: "contracts", label: "계약 관리", href: "/procurement/contracts" },
  { key: "customers", label: "고객사", href: "/procurement/customers" },
  { key: "suppliers", label: "제조사/공급사", href: "/procurement/suppliers" },
  { key: "orders", label: "발주 관리", href: "/procurement" },
  { key: "products", label: "품목 관리", href: "/procurement/products" },
  { key: "inventory", label: "재고 관리", href: "/procurement/inventory" },
  { key: "inbound", label: "입고 큐", href: "/procurement/inbound" },
  { key: "bundles", label: "번들 출고", href: "/procurement/bundles" },
  { key: "expenses", label: "재무 접수", href: "/procurement/expenses" },
  { key: "settlements", label: "수입원가정산", href: "/procurement/settlements" },
  { key: "audits", label: "재고실사", href: "/procurement/audits" },
  { key: "locations", label: "창고관리", href: "/procurement/locations" },
] as const;

function getActiveTab(pathname: string): string {
  if (pathname.startsWith("/procurement/contracts")) return "contracts";
  if (pathname.startsWith("/procurement/customers")) return "customers";
  if (pathname.startsWith("/procurement/suppliers")) return "suppliers";
  if (pathname.startsWith("/procurement/products")) return "products";
  if (pathname.startsWith("/procurement/inventory")) return "inventory";
  if (pathname.startsWith("/procurement/inbound")) return "inbound";
  if (pathname.startsWith("/procurement/bundles")) return "bundles";
  if (pathname.startsWith("/procurement/expenses")) return "expenses";
  if (pathname.startsWith("/procurement/settlements")) return "settlements";
  if (pathname.startsWith("/procurement/audits")) return "audits";
  if (pathname.startsWith("/procurement/locations")) return "locations";
  return "orders";
}

export default function ProcurementLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  // 시범 릴리즈(2026-06-23): 회계 메뉴는 관리자 전용 — 비관리자 직접 URL 접근 차단
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    const u = getUser();
    if (!u || u.role !== "ADMIN") { router.replace("/me/dashboard"); setAllowed(false); }
    else setAllowed(true);
  }, [router]);

  // 헤더(56px) + 서브탭 바 높이를 실측해, 하위 sticky(툴바/표헤더)의 top 기준(--top-chrome)으로 내려줌
  const chromeRef = useRef<HTMLDivElement>(null);
  const [chrome, setChrome] = useState(157);
  useEffect(() => {
    const el = chromeRef.current; if (!el) return;
    const update = () => setChrome(56 + el.offsetHeight);
    update();
    const ro = new ResizeObserver(update); ro.observe(el);
    window.addEventListener("resize", update);
    return () => { ro.disconnect(); window.removeEventListener("resize", update); };
  }, []);

  const activeTab = getActiveTab(pathname);
  const isDetailPage = pathname.startsWith("/procurement/orders/") ||
    pathname.startsWith("/procurement/contracts/") ||
    pathname.startsWith("/procurement/customers/") && pathname !== "/procurement/customers" ||
    pathname.startsWith("/procurement/inventory/") ||
    pathname.startsWith("/procurement/settlements/") ||
    pathname.startsWith("/procurement/audits/");

  if (allowed !== true) return null;

  return (
    <AppLayout>
      <div className="px-6 pb-6" style={{ ["--top-chrome" as any]: `${chrome}px` }}>
        {/* v1.6 (2026-05-14): 페이지 제목 + 서브 탭 sticky — 모든 서브 페이지 공통 */}
        <div ref={chromeRef} className="sticky top-14 z-30 bg-gray-50 dark:bg-gray-900 -mx-6 px-6 pt-6 pb-0 mb-6">
          <div className="flex items-center gap-2 mb-3">
            {isDetailPage && (
              <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600">
                &larr;
              </button>
            )}
            <h1 className="text-2xl font-bold text-gray-900">구매/회계</h1>
          </div>

          <div className="flex gap-1 border-b border-gray-200">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => router.push(t.href)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === t.key
                    ? "border-blue-600 dark:border-blue-400 text-blue-600 dark:text-blue-400"
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
