"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { procurementApi } from "@/lib/api";
import Pagination from "@/components/Pagination";
import SortableHeader, { SortOrder } from "@/components/SortableHeader";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "초안", PENDING_APPROVAL: "승인대기", APPROVED: "승인",
  REJECTED: "반려", ORDERED: "승인완료", PURCHASING: "발주완료",
  SHIPPED: "선적", CUSTOMS: "통관중", PARTIALLY_RECEIVED: "부분입고",
  ARRIVED: "입고완료", SETTLEMENT: "송금상태", CLOSED: "마감",
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  PENDING_APPROVAL: "bg-yellow-100 text-yellow-700",
  APPROVED: "bg-green-100 text-green-700",
  REJECTED: "bg-red-100 text-red-700",
  ORDERED: "bg-blue-100 text-blue-700",
  PURCHASING: "bg-sky-100 text-sky-700",
  SHIPPED: "bg-purple-100 text-purple-700",
  CUSTOMS: "bg-orange-100 text-orange-700",
  PARTIALLY_RECEIVED: "bg-amber-100 text-amber-700",
  ARRIVED: "bg-emerald-100 text-emerald-700",
  SETTLEMENT: "bg-cyan-100 text-cyan-700",
  CLOSED: "bg-gray-200 text-gray-600",
};

const CURRENCY_SYMBOLS: Record<string, string> = {
  EUR: "\u20AC", GBP: "\u00A3", USD: "$", KRW: "\u20A9",
};

const STATUS_ORDER = [
  "DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED",
  "ORDERED", "PURCHASING", "SHIPPED", "CUSTOMS",
  "PARTIALLY_RECEIVED", "ARRIVED", "SETTLEMENT", "CLOSED",
];

const FILTER_STATUSES = [
  { key: "", label: "전체" },
  { key: "DRAFT", label: "초안" },
  { key: "PENDING_APPROVAL", label: "승인대기" },
  { key: "ORDERED", label: "승인완료" },
  { key: "PURCHASING", label: "발주완료" },
  { key: "SHIPPED", label: "선적" },
  { key: "CUSTOMS", label: "통관중" },
  // v1.6 (2026-05-14): 부분입고 + 입고완료 통합 필터
  { key: "PARTIALLY_RECEIVED,ARRIVED", label: "입고현황" },
  // v1.6 (2026-05-14): 송금상태 = 송금 요청/완료 내역이 있는 발주 (상태 무관)
  { key: "__HAS_PAYMENT__", label: "송금상태" },
  { key: "CLOSED", label: "마감" },
];

function fmtAmount(val: string | number, currency?: string) {
  const n = Number(val);
  const sym = currency ? (CURRENCY_SYMBOLS[currency] || currency) : "";
  return `${sym}${n.toLocaleString("ko-KR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function fmtDate(d: string | null) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("ko-KR", { year: "2-digit", month: "numeric", day: "numeric" });
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
  const [sortBy, setSortBy] = useState<string>("");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const handleSort = (k: string, o: SortOrder) => { setSortBy(k); setSortOrder(o); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // v1.6 (2026-05-14): 회계정산 특수 키 → hasPayment param 으로 변환
      const isHasPaymentFilter = statusFilter === "__HAS_PAYMENT__";
      const [ordersRes, dashRes] = await Promise.all([
        procurementApi.getOrders({
          status: isHasPaymentFilter ? undefined : (statusFilter || undefined),
          currency: currencyFilter || undefined,
          orderType: orderTypeFilter || undefined,
          search: search || undefined,
          page,
          ...(sortBy && { sortBy, sortOrder }),
          ...(isHasPaymentFilter && { hasPayment: true }),
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
  }, [statusFilter, currencyFilter, orderTypeFilter, search, page, sortBy, sortOrder]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.ceil(total / 50);

  return (
    <div>
      {/* v1.6 (2026-05-14): 상태 카운트 + 필터 행 sticky (layout sticky 영역 아래) */}
      <div className="sticky top-[112px] z-20 bg-gray-50 -mx-4 sm:-mx-6 px-4 sm:px-6 pt-2 pb-2 mb-2">
      {/* Dashboard Summary — v1.6 (2026-05-14): 부분입고·입고완료 별도 셀 + 0건이어도 항상 표시 */}
      {dashboard && (
        <div className="flex gap-2 mb-3 overflow-x-auto">
          {(() => {
            // 항상 표시할 주요 상태 (0건이어도 셀 노출)
            const ALWAYS_VISIBLE = new Set([
              "DRAFT", "PENDING_APPROVAL", "ORDERED", "PURCHASING",
              "SHIPPED", "CUSTOMS", "PARTIALLY_RECEIVED", "ARRIVED",
              "CLOSED",
              // SETTLEMENT 제거 — 더 이상 상태 전환 안 함 (송금 요청은 OrderPayment로 별도 관리)
            ]);
            const countMap: Record<string, number> = {};
            for (const sc of dashboard.statusCounts || []) {
              countMap[sc.status] = sc._count;
            }
            // STATUS_ORDER 기준 정렬, ALWAYS_VISIBLE + 데이터 있는 항목 모두 표시
            const keys = STATUS_ORDER.filter((s) => ALWAYS_VISIBLE.has(s) || countMap[s] > 0);
            return keys.map((s) => (
              <button
                key={s}
                onClick={() => { setStatusFilter(s); setPage(1); }}
                className={`flex-1 min-w-0 rounded-lg px-2 py-1.5 text-center cursor-pointer transition-shadow hover:shadow-md ${STATUS_COLORS[s] || "bg-gray-50"}`}
              >
                <div className="text-lg font-bold">{countMap[s] ?? 0}</div>
                <div className="text-[11px]">{STATUS_LABELS[s] || s}</div>
              </button>
            ));
          })()}
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
      </div>
      {/* /sticky 영역 끝 */}

      {/* Orders Table */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <SortableHeader sortKey="orderNumber" currentSort={sortBy} order={sortOrder} onSort={handleSort} className="px-4 py-3 text-left font-medium text-gray-600">발주번호</SortableHeader>
              <th className="px-4 py-3 text-left font-medium text-gray-600">품목명</th>
              <SortableHeader sortKey="manufacturer" currentSort={sortBy} order={sortOrder} onSort={handleSort} className="px-4 py-3 text-left font-medium text-gray-600">제조사</SortableHeader>
              <th className="px-4 py-3 text-left font-medium text-gray-600">계약</th>
              <SortableHeader sortKey="totalAmount" currentSort={sortBy} order={sortOrder} onSort={handleSort} align="right" className="px-4 py-3 text-right font-medium text-gray-600">금액</SortableHeader>
              <SortableHeader sortKey="status" currentSort={sortBy} order={sortOrder} onSort={handleSort} align="center" className="px-4 py-3 text-center font-medium text-gray-600">발주현황</SortableHeader>
              <th className="px-4 py-3 text-center font-medium text-gray-600 whitespace-nowrap">송금현황</th>
              <th className="px-4 py-3 text-center font-medium text-gray-600">품목수</th>
              <SortableHeader sortKey="orderDate" currentSort={sortBy} order={sortOrder} onSort={handleSort} className="px-4 py-3 text-left font-medium text-gray-600">발주일</SortableHeader>
              <SortableHeader sortKey="estimatedShipDate" currentSort={sortBy} order={sortOrder} onSort={handleSort} className="px-4 py-3 text-left font-medium text-gray-600">선적예정일</SortableHeader>
              <SortableHeader sortKey="actualShipDate" currentSort={sortBy} order={sortOrder} onSort={handleSort} className="px-4 py-3 text-left font-medium text-gray-600">실제선적일</SortableHeader>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={11} className="px-4 py-8 text-center text-gray-400">로딩 중...</td></tr>
            ) : orders.length === 0 ? (
              <tr><td colSpan={11} className="px-4 py-8 text-center text-gray-400">발주가 없습니다.</td></tr>
            ) : (
              orders.map((o) => (
                <tr
                  key={o.id}
                  onClick={() => router.push(`/procurement/orders/${o.id}`)}
                  className="hover:bg-gray-50 cursor-pointer"
                >
                  <td className="px-4 py-3 font-mono text-blue-600 whitespace-nowrap min-w-[14ch]">{o.orderNumber}</td>
                  <td className="px-4 py-3 text-gray-700">
                    {o.firstItemName ? (
                      <span className="truncate inline-block max-w-[16ch]" title={o.firstItemName}>
                        {o.firstItemName}
                        {(o._count?.items ?? 0) > 1 && <span className="text-gray-400 text-xs ml-1">외 {o._count.items - 1}건</span>}
                      </span>
                    ) : <span className="text-gray-300">-</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className="truncate inline-block max-w-[10ch]" title={o.manufacturer}>{o.manufacturer}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {o.contract ? (
                      <span className="inline-block truncate max-w-[20ch]" title={`${o.contract.contractNumber}${o.contract.name ? ` - ${o.contract.name}` : ""}`}>
                        {o.contract.contractNumber}{o.contract.name ? ` - ${o.contract.name}` : ""}
                      </span>
                    ) : "-"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">{fmtAmount(o.totalAmount, o.currency)}</td>
                  <td className="px-4 py-3 text-center whitespace-nowrap">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[o.status] || ""}`}>
                      {STATUS_LABELS[o.status] || o.status}
                    </span>
                  </td>
                  {/* v1.6 (2026-05-14): 송금현황 — 송금요청 / N차송금 / 완료 / 반려 */}
                  <td className="px-4 py-3 text-center whitespace-nowrap">
                    {(() => {
                      const ps = o.paymentSummary || { requested: 0, completed: 0, rejected: 0, total: 0 };
                      if (ps.total === 0) return <span className="text-gray-300 text-xs">-</span>;
                      // 요청중 + 완료 0 → "송금요청"
                      if (ps.requested > 0 && ps.completed === 0) {
                        return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">송금요청</span>;
                      }
                      // 요청중 + 완료 N → "N차송금" (현재까지 N번 완료, 추가 요청 대기)
                      if (ps.requested > 0 && ps.completed > 0) {
                        return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">{ps.completed}차송금</span>;
                      }
                      // 요청 없음 + 완료 N → "완료"
                      if (ps.requested === 0 && ps.completed > 0) {
                        return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">완료</span>;
                      }
                      // 요청 없음 + 완료 없음 + 반려만 → "반려"
                      if (ps.rejected > 0) {
                        return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">반려</span>;
                      }
                      return <span className="text-gray-300 text-xs">-</span>;
                    })()}
                  </td>
                  <td className="px-4 py-3 text-center text-gray-500">{o._count?.items ?? 0}</td>
                  <td className="px-4 py-3 text-gray-500">{fmtDate(o.orderDate)}</td>
                  <td className="px-4 py-3 text-gray-500">{fmtDate(o.estimatedShipDate)}</td>
                  <td className="px-4 py-3 text-gray-500">{fmtDate(o.actualShipDate)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} total={total} className="mt-4 border rounded-lg" />
    </div>
  );
}
