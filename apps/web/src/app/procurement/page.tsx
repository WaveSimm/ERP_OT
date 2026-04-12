"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { procurementApi } from "@/lib/api";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "초안", PENDING_APPROVAL: "승인대기", APPROVED: "승인",
  REJECTED: "반려", ORDERED: "발주완료", IN_PRODUCTION: "제작중",
  SHIPPED: "출하/선적", CUSTOMS: "통관중", PARTIALLY_RECEIVED: "부분입고",
  ARRIVED: "입고완료", CLOSED: "마감",
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  PENDING_APPROVAL: "bg-yellow-100 text-yellow-700",
  APPROVED: "bg-green-100 text-green-700",
  REJECTED: "bg-red-100 text-red-700",
  ORDERED: "bg-blue-100 text-blue-700",
  IN_PRODUCTION: "bg-indigo-100 text-indigo-700",
  SHIPPED: "bg-purple-100 text-purple-700",
  CUSTOMS: "bg-orange-100 text-orange-700",
  PARTIALLY_RECEIVED: "bg-amber-100 text-amber-700",
  ARRIVED: "bg-emerald-100 text-emerald-700",
  CLOSED: "bg-gray-200 text-gray-600",
};

const CURRENCY_SYMBOLS: Record<string, string> = {
  EUR: "\u20AC", GBP: "\u00A3", USD: "$", KRW: "\u20A9",
};

const STATUS_ORDER = [
  "DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED",
  "ORDERED", "IN_PRODUCTION", "SHIPPED", "CUSTOMS",
  "PARTIALLY_RECEIVED", "ARRIVED", "CLOSED",
];

const FILTER_STATUSES = [
  { key: "", label: "전체" },
  { key: "DRAFT", label: "초안" },
  { key: "PENDING_APPROVAL", label: "승인대기" },
  { key: "ORDERED", label: "발주" },
  { key: "IN_PRODUCTION", label: "제작중" },
  { key: "SHIPPED", label: "출하/선적" },
  { key: "CUSTOMS", label: "통관중" },
  { key: "ARRIVED", label: "입고완료" },
  { key: "CLOSED", label: "마감" },
];

function fmtAmount(val: string | number, currency?: string) {
  const n = Number(val);
  const sym = currency ? (CURRENCY_SYMBOLS[currency] || currency) : "";
  return `${sym}${n.toLocaleString("ko-KR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function fmtDate(d: string | null) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("ko-KR");
}

export default function ProcurementPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [currencyFilter, setCurrencyFilter] = useState("");
  const [orderTypeFilter, setOrderTypeFilter] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [dashboard, setDashboard] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ordersRes, dashRes] = await Promise.all([
        procurementApi.getOrders({
          status: statusFilter || undefined,
          currency: currencyFilter || undefined,
          orderType: orderTypeFilter || undefined,
          search: search || undefined,
          page,
        }),
        procurementApi.getDashboard(),
      ]);
      setOrders(ordersRes.items);
      setTotal(ordersRes.total);
      setDashboard(dashRes);
    } catch (e: any) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, currencyFilter, orderTypeFilter, search, page]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.ceil(total / 50);

  return (
    <div>
      {/* Dashboard Summary */}
      {dashboard && (
        <div className="flex gap-2 mb-4 overflow-x-auto">
          {dashboard.statusCounts
            ?.slice()
            .sort((a: any, b: any) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status))
            .map((sc: any) => (
            <button
              key={sc.status}
              onClick={() => { setStatusFilter(sc.status); setPage(1); }}
              className={`flex-1 min-w-0 rounded-lg px-2 py-1.5 text-center cursor-pointer transition-shadow hover:shadow-md ${STATUS_COLORS[sc.status] || "bg-gray-50"}`}
            >
              <div className="text-lg font-bold">{sc._count}</div>
              <div className="text-[11px]">{STATUS_LABELS[sc.status] || sc.status}</div>
            </button>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex bg-gray-100 rounded-lg p-0.5 overflow-x-auto">
          {FILTER_STATUSES.map((f) => (
            <button
              key={f.key}
              onClick={() => { setStatusFilter(f.key); setPage(1); }}
              className={`px-3 py-1.5 text-sm rounded-md whitespace-nowrap transition-colors ${
                statusFilter === f.key ? "bg-white shadow text-gray-900 font-medium" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <select
          value={orderTypeFilter}
          onChange={(e) => { setOrderTypeFilter(e.target.value); setPage(1); }}
          className="border rounded-lg px-3 py-1.5 text-sm"
        >
          <option value="">전체 유형</option>
          <option value="PURCHASE">유환 발주</option>
          <option value="DUTY_FREE">무환통관</option>
        </select>

        <select
          value={currencyFilter}
          onChange={(e) => { setCurrencyFilter(e.target.value); setPage(1); }}
          className="border rounded-lg px-3 py-1.5 text-sm"
        >
          <option value="">모든 통화</option>
          <option value="EUR">EUR</option>
          <option value="GBP">GBP</option>
          <option value="USD">USD</option>
          <option value="KRW">KRW</option>
        </select>

        <input
          type="text"
          placeholder="발주번호, 제조사 검색..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="border rounded-lg px-3 py-1.5 text-sm w-60"
        />

        <div className="ml-auto flex gap-2">
          <button
            onClick={() => router.push("/procurement/products")}
            className="px-4 py-1.5 text-sm border rounded-lg hover:bg-gray-50"
          >
            장비 마스터
          </button>
          <button
            onClick={() => router.push("/procurement/contracts")}
            className="px-4 py-1.5 text-sm border rounded-lg hover:bg-gray-50"
          >
            계약 관리
          </button>
          <button
            onClick={() => router.push("/procurement/orders/new")}
            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            + 발주 등록
          </button>
        </div>
      </div>

      {/* Orders Table */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600">발주번호</th>
              <th className="px-4 py-3 text-center font-medium text-gray-600">유형</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">제조사</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">계약</th>
              <th className="px-4 py-3 text-center font-medium text-gray-600">통화</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">금액</th>
              <th className="px-4 py-3 text-center font-medium text-gray-600">상태</th>
              <th className="px-4 py-3 text-center font-medium text-gray-600">품목수</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">발주일</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">로딩 중...</td></tr>
            ) : orders.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">발주가 없습니다.</td></tr>
            ) : (
              orders.map((o) => (
                <tr
                  key={o.id}
                  onClick={() => router.push(`/procurement/orders/${o.id}`)}
                  className="hover:bg-gray-50 cursor-pointer"
                >
                  <td className="px-4 py-3 font-mono text-blue-600">{o.orderNumber}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      o.orderType === "DUTY_FREE" ? "bg-teal-100 text-teal-700" : "bg-blue-50 text-blue-600"
                    }`}>
                      {o.orderType === "DUTY_FREE" ? "무환" : "유환"}
                    </span>
                  </td>
                  <td className="px-4 py-3">{o.manufacturer}</td>
                  <td className="px-4 py-3 text-gray-500">{o.contract?.contractNumber || "-"}</td>
                  <td className="px-4 py-3 text-center">{o.currency}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmtAmount(o.totalAmount, o.currency)}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[o.status] || ""}`}>
                      {STATUS_LABELS[o.status] || o.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center text-gray-500">{o._count?.items ?? 0}</td>
                  <td className="px-4 py-3 text-gray-500">{fmtDate(o.orderDate)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-1 mt-4">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <button
              key={p}
              onClick={() => setPage(p)}
              className={`px-3 py-1 rounded text-sm ${p === page ? "bg-blue-600 text-white" : "bg-gray-100 hover:bg-gray-200"}`}
            >
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
