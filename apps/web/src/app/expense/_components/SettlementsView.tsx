"use client";

import { useEffect, useState } from "react";
import { expenseApi } from "@/lib/api";
import { fmtDate } from "@/lib/datetime";
import { SettlementStatusBadge } from "./settlement-status-badge";
import { useTableSort } from "@/lib/hooks/useTableSort";
import { SettlementDetail } from "./settlement-detail";

export function SettlementsView({ statusFilter }: { statusFilter?: string } = {}) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  type SortKey = "title" | "periodStart" | "totalCount" | "totalAmount" | "status";
  // statusFilter 적용
  const filteredItems = items.filter((s) => {
    if (statusFilter === "SETTLED") return ["SUBMITTED", "APPROVED", "RECEIVED"].includes(s.status);
    if (statusFilter === "PAID") return s.status === "PAID";
    return true;
  });
  const sort = useTableSort<any, SortKey>(filteredItems, {
    initialKey: "periodStart",
    initialDir: "desc",
    keyExtractor: (s, key) => {
      switch (key) {
        case "title": return s.title ?? "";
        case "periodStart": return new Date(s.periodStart);
        case "totalCount": return s.totalCount ?? 0;
        case "totalAmount": return Number(s.totalAmount ?? 0);
        case "status": return s.status;
      }
    },
  });
  const sortedItems = sort.sortedItems;

  const load = async () => {
    setLoading(true);
    try {
      const r = await expenseApi.listSettlements({ limit: 200 });
      setItems(r.items);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  if (selectedId) {
    return <SettlementDetail id={selectedId} onBack={() => { setSelectedId(null); load(); }} />;
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-6 space-y-4">
      {loading ? (
        <div className="py-12 text-center text-gray-400">불러오는 중...</div>
      ) : sortedItems.length === 0 ? (
        <div className="py-12 text-center text-gray-400">아직 작성된 정산이 없습니다.</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 text-xs text-gray-500">
              <tr>
                <th onClick={() => sort.handleSort("title")} className="px-3 py-2 text-left cursor-pointer hover:bg-gray-100 select-none">제목{sort.sortIndicator("title")}</th>
                <th onClick={() => sort.handleSort("periodStart")} className="px-3 py-2 text-left cursor-pointer hover:bg-gray-100 select-none">기간{sort.sortIndicator("periodStart")}</th>
                <th onClick={() => sort.handleSort("totalCount")} className="px-3 py-2 text-right cursor-pointer hover:bg-gray-100 select-none">건수{sort.sortIndicator("totalCount")}</th>
                <th onClick={() => sort.handleSort("totalAmount")} className="px-3 py-2 text-right cursor-pointer hover:bg-gray-100 select-none">총액{sort.sortIndicator("totalAmount")}</th>
                <th onClick={() => sort.handleSort("status")} className="px-3 py-2 text-center cursor-pointer hover:bg-gray-100 select-none">상태{sort.sortIndicator("status")}</th>
              </tr>
            </thead>
            <tbody>
              {sortedItems.map((s) => {
                // v1.6.4 (2026-05-16): 결재 미연결 DRAFT 정산묶음에만 「결재 작성」 액션
                const canCreateApproval = ["DRAFT", "REJECTED"].includes(s.status) && !s.approvalDocumentId && (s.totalCount ?? 0) > 0;
                return (
                  <tr key={s.id} onClick={() => setSelectedId(s.id)}
                    className="border-t border-gray-100 hover:bg-blue-50/40 dark:hover:bg-blue-500/10 cursor-pointer">
                    <td colSpan={5} className="p-0">
                      <div className="grid grid-cols-[3fr_2fr_1fr_1fr_1fr_auto] gap-2 px-3 py-2 items-center">
                        <span className="font-medium text-gray-900 truncate">{s.title}</span>
                        <span className="text-xs text-gray-500">
                          {s.periodStart ? `${fmtDate(s.periodStart)} ~ ${fmtDate(s.periodEnd)}` : "기간 미설정"}
                        </span>
                        <span className="text-right tabular-nums text-xs">{s.totalCount ?? 0}</span>
                        <span className="text-right tabular-nums font-medium">{Number(s.totalAmount ?? 0).toLocaleString()}원</span>
                        <span className="text-center"><SettlementStatusBadge status={s.status} /></span>
                        <span className="text-right whitespace-nowrap">
                          {canCreateApproval ? (
                            <a
                              href={`/approval/new?settlementId=${s.id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="text-xs px-2 py-0.5 border border-blue-300 text-blue-700 rounded hover:bg-blue-50 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950"
                            >
                              결재 작성
                            </a>
                          ) : s.approvalDocumentId ? (
                            <a
                              href={`/approval/${s.approvalDocumentId}`}
                              onClick={(e) => e.stopPropagation()}
                              className="text-xs px-2 py-0.5 border border-gray-300 text-gray-600 rounded hover:bg-gray-50"
                            >
                              결재 →
                            </a>
                          ) : null}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
