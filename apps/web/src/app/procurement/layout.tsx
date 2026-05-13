"use client";

import { usePathname, useRouter } from "next/navigation";
import AppLayout from "@/components/AppLayout";

const TABS = [
  { key: "contracts", label: "계약 관리", href: "/procurement/contracts" },
  { key: "customers", label: "고객사", href: "/procurement/customers" },
  { key: "suppliers", label: "제조사/공급사", href: "/procurement/suppliers" },
  { key: "orders", label: "발주 관리", href: "/procurement" },
  { key: "products", label: "장비 마스터", href: "/procurement/products" },
  { key: "inventory", label: "재고 관리", href: "/procurement/inventory" },
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
  if (pathname.startsWith("/procurement/expenses")) return "expenses";
  if (pathname.startsWith("/procurement/settlements")) return "settlements";
  if (pathname.startsWith("/procurement/audits")) return "audits";
  if (pathname.startsWith("/procurement/locations")) return "locations";
  return "orders";
}

export default function ProcurementLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const activeTab = getActiveTab(pathname);
  const isDetailPage = pathname.startsWith("/procurement/orders/") ||
    pathname.startsWith("/procurement/contracts/") ||
    pathname.startsWith("/procurement/customers/") && pathname !== "/procurement/customers" ||
    pathname.startsWith("/procurement/inventory/") ||
    pathname.startsWith("/procurement/settlements/") ||
    pathname.startsWith("/procurement/audits/");

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center gap-2 mb-4">
          {isDetailPage && (
            <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600">
              &larr;
            </button>
          )}
          <h1 className="text-2xl font-bold">구매/회계</h1>
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
