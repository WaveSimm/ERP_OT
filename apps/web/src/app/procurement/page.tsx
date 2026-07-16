"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { procurementApi } from "@/lib/api";
import Pagination from "@/components/Pagination";
import SortableHeader from "@/components/SortableHeader";
import { useFillHeight } from "@/hooks/useFillHeight";
import { useSortPreference } from "@/hooks/useSortPreference";
import { TableCard, Table, THead, Th, TBody, Tr, Td, TableEmpty } from "@/components/ui/Table";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "초안", PENDING_APPROVAL: "승인대기", APPROVED: "승인",
  REJECTED: "반려", ORDERED: "승인완료", PURCHASING: "발주완료",
  SHIPPED: "선적 완료", CUSTOMS: "통관중", PARTIALLY_RECEIVED: "부분입고",
  ARRIVED: "입고완료", SETTLEMENT: "송금상태", CLOSED: "마감",
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200",
  PENDING_APPROVAL: "bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300",
  APPROVED: "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300",
  REJECTED: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300",
  ORDERED: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300",
  PURCHASING: "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300",
  SHIPPED: "bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300",
  CUSTOMS: "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300",
  PARTIALLY_RECEIVED: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
  ARRIVED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
  SETTLEMENT: "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300",
  CLOSED: "bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
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
  { key: "SHIPPED", label: "선적 완료" },
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
  const { ref: tableBoxRef, maxHeight: tableMaxH } = useFillHeight();
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [currencyFilter, setCurrencyFilter] = useState("");
  const [orderTypeFilter, setOrderTypeFilter] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [dashboard, setDashboard] = useState<any>(null);
  const { sortBy, sortOrder, handleSort, resetSort } = useSortPreference("orders", "", "desc");

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
      <div className="sticky top-[156px] z-20 bg-gray-50 -mx-4 sm:-mx-6 px-4 sm:px-6 pt-3 pb-2 mb-2">
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
          className="border border-gray-300 dark:border-gray-600 dark:bg-gray-800 rounded-lg px-3 py-1.5 text-sm"
        >
          <option value="">전체 유형</option>
          <option value="PURCHASE">유환 발주</option>
          <option value="DUTY_FREE">무환통관</option>
        </select>

        <select
          value={currencyFilter}
          onChange={(e) => { setCurrencyFilter(e.target.value); setPage(1); }}
          className="border border-gray-300 dark:border-gray-600 dark:bg-gray-800 rounded-lg px-3 py-1.5 text-sm"
        >
          <option value="">모든 통화</option>
          <option value="EUR">EUR</option>
          <option value="GBP">GBP</option>
          <option value="USD">USD</option>
          <option value="KRW">KRW</option>
        </select>

        <div className="ml-auto flex gap-2">
          <input
            type="text"
            placeholder="발주번호, 제조사 검색..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="border border-gray-300 dark:border-gray-600 dark:bg-gray-800 rounded-lg px-3 py-1.5 text-sm w-60"
          />
          {sortBy && (
            <button onClick={resetSort} title="정렬을 원래 순서로 되돌립니다"
              className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
              ↺ 정렬 초기화
            </button>
          )}
          <button
            onClick={() => router.push("/procurement/products")}
            className="px-4 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            품목 관리
          </button>
          <button
            onClick={() => router.push("/procurement/contracts")}
            className="px-4 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
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
      <TableCard
        scrollRef={tableBoxRef}
        maxHeight={tableMaxH}
        footer={<Pagination page={page} totalPages={totalPages} onPageChange={setPage} total={total} />}
      >
        <Table fixed columnDividers>
          <colgroup>
            <col className="w-[10%]" />
            <col className="w-[13%]" />
            <col className="w-[9%]" />
            <col className="w-[12%]" />
            <col className="w-[10%]" />
            <col className="w-[10%]" />
            <col className="w-[9%]" />
            <col className="w-[5%]" />
            <col className="w-[8%]" />
            <col className="w-[8%]" />
            <col className="w-[6%]" />
          </colgroup>
          <THead>
            <SortableHeader sortKey="orderNumber" currentSort={sortBy} order={sortOrder} onSort={handleSort} align="center" className="px-4 py-3 font-medium">발주번호</SortableHeader>
            <Th align="center">품목명</Th>
            <SortableHeader sortKey="manufacturer" currentSort={sortBy} order={sortOrder} onSort={handleSort} align="center" className="px-4 py-3 font-medium">제조사</SortableHeader>
            <Th align="center">계약</Th>
            <SortableHeader sortKey="totalAmount" currentSort={sortBy} order={sortOrder} onSort={handleSort} align="center" className="px-4 py-3 font-medium">금액</SortableHeader>
            <SortableHeader sortKey="status" currentSort={sortBy} order={sortOrder} onSort={handleSort} align="center" className="px-4 py-3 font-medium">발주현황</SortableHeader>
            <Th align="center">송금현황</Th>
            <Th align="center">품목수</Th>
            <SortableHeader sortKey="orderDate" currentSort={sortBy} order={sortOrder} onSort={handleSort} align="center" className="px-4 py-3 font-medium">발주일</SortableHeader>
            <SortableHeader sortKey="estimatedShipDate" currentSort={sortBy} order={sortOrder} onSort={handleSort} align="center" className="px-4 py-3 font-medium">선적예정일</SortableHeader>
            <SortableHeader sortKey="actualShipDate" currentSort={sortBy} order={sortOrder} onSort={handleSort} align="center" className="px-4 py-3 font-medium">실제선적일</SortableHeader>
          </THead>
          <TBody>
            {loading ? (
              <TableEmpty colSpan={11}>로딩 중...</TableEmpty>
            ) : orders.length === 0 ? (
              <TableEmpty colSpan={11}>발주가 없습니다.</TableEmpty>
            ) : orders.map((o) => (
              <Tr key={o.id} onClick={() => router.push(`/procurement/orders/${o.id}`)}>
                <Td strong mono align="left" truncate title={o.orderNumber}>{o.orderNumber}</Td>
                <Td truncate title={o.firstItemName || undefined}>
                  {o.firstItemName ? (
                    <>{o.firstItemName}{(o._count?.items ?? 0) > 1 && <span className="text-gray-400 text-xs ml-1">외 {o._count.items - 1}건</span>}</>
                  ) : <span className="text-gray-400">-</span>}
                </Td>
                <Td dash truncate title={o.manufacturer || undefined}>{o.manufacturer}</Td>
                <Td dash truncate title={o.contract ? `${o.contract.contractNumber}${o.contract.name ? ` - ${o.contract.name}` : ""}` : undefined}>
                  {o.contract ? `${o.contract.contractNumber}${o.contract.name ? ` - ${o.contract.name}` : ""}` : undefined}
                </Td>
                <Td align="right" mono>{fmtAmount(o.totalAmount, o.currency)}</Td>
                <Td align="center">
                  {/* v1.6.1 (2026-05-15): CUSTOMS는 customsTax.status로 세금납부대기/완료 sub-status 표시 */}
                  {(() => {
                    if (o.status === "CUSTOMS") {
                      const taxPaid = o.customsTax?.status === "PAID";
                      const taxRejected = o.customsTax?.status === "REJECTED";
                      const label = taxPaid ? "세금납부완료" : taxRejected ? "세금납부반려" : "세금납부대기";
                      const cls = taxPaid ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
                        : taxRejected ? "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300"
                        : "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300";
                      return (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${cls}`}>{label}</span>
                      );
                    }
                    return (
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${STATUS_COLORS[o.status] || ""}`}>
                        {STATUS_LABELS[o.status] || o.status}
                      </span>
                    );
                  })()}
                </Td>
                {/* v1.6 (2026-05-14): 송금현황 — 송금요청 / N차송금 / 완료 / 반려 */}
                <Td align="center">
                  {(() => {
                    const ps = o.paymentSummary || { requested: 0, completed: 0, rejected: 0, total: 0 };
                    if (ps.total === 0) return <span className="text-gray-400 text-xs">-</span>;
                    if (ps.requested > 0 && ps.completed === 0) {
                      return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">송금요청</span>;
                    }
                    if (ps.requested > 0 && ps.completed > 0) {
                      return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">{ps.completed}차송금</span>;
                    }
                    if (ps.requested === 0 && ps.completed > 0) {
                      return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300">완료</span>;
                    }
                    if (ps.rejected > 0) {
                      return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300">반려</span>;
                    }
                    return <span className="text-gray-400 text-xs">-</span>;
                  })()}
                </Td>
                <Td align="center" mono>{o._count?.items ?? 0}</Td>
                <Td align="center" mono>{fmtDate(o.orderDate)}</Td>
                <Td align="center" mono>{fmtDate(o.estimatedShipDate)}</Td>
                <Td align="center" mono>{fmtDate(o.actualShipDate)}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </TableCard>
    </div>
  );
}
