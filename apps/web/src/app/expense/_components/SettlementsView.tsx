"use client";

import { useEffect, useState } from "react";
import { expenseApi } from "@/lib/api";
import { fmtDate } from "@/lib/datetime";
import { SettlementStatusBadge } from "./settlement-status-badge";
import { useTableSort } from "@/lib/hooks/useTableSort";
import { SettlementDetail } from "./settlement-detail";
import { TableCard, Table, THead, Th, TBody, Tr, Td, TableEmpty } from "@/components/ui/Table";

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
      <TableCard>
        <Table columnDividers>
          <THead>
            <Th align="center" onClick={() => sort.handleSort("title")} className="cursor-pointer hover:bg-gray-100 select-none">제목{sort.sortIndicator("title")}</Th>
            <Th align="center" onClick={() => sort.handleSort("periodStart")} className="cursor-pointer hover:bg-gray-100 select-none">기간{sort.sortIndicator("periodStart")}</Th>
            <Th align="center" onClick={() => sort.handleSort("totalCount")} className="cursor-pointer hover:bg-gray-100 select-none">건수{sort.sortIndicator("totalCount")}</Th>
            <Th align="center" onClick={() => sort.handleSort("totalAmount")} className="cursor-pointer hover:bg-gray-100 select-none">총액{sort.sortIndicator("totalAmount")}</Th>
            <Th align="center" onClick={() => sort.handleSort("status")} className="cursor-pointer hover:bg-gray-100 select-none">상태{sort.sortIndicator("status")}</Th>
            <Th align="center">결재</Th>
          </THead>
          <TBody>
            {loading ? (
              <TableEmpty colSpan={6}>불러오는 중...</TableEmpty>
            ) : sortedItems.length === 0 ? (
              <TableEmpty colSpan={6}>아직 작성된 정산이 없습니다.</TableEmpty>
            ) : sortedItems.map((s) => {
              // v1.6.4 (2026-05-16): 결재 미연결 DRAFT 정산묶음에만 「결재 작성」 액션
              const canCreateApproval = ["DRAFT", "REJECTED"].includes(s.status) && !s.approvalDocumentId && (s.totalCount ?? 0) > 0;
              return (
                <Tr key={s.id} onClick={() => setSelectedId(s.id)}>
                  <Td strong>{s.title}</Td>
                  <Td align="center" mono className="whitespace-nowrap text-xs">
                    {s.periodStart ? `${fmtDate(s.periodStart)} ~ ${fmtDate(s.periodEnd)}` : "기간 미설정"}
                  </Td>
                  <Td align="right" mono>{s.totalCount ?? 0}</Td>
                  <Td align="right" mono>{Number(s.totalAmount ?? 0).toLocaleString()}원</Td>
                  <Td align="center"><SettlementStatusBadge status={s.status} /></Td>
                  <Td align="center" onClick={(e) => e.stopPropagation()}>
                    {canCreateApproval ? (
                      <a href={`/approval/new?settlementId=${s.id}`}
                        className="inline-flex h-7 items-center rounded-md border border-gray-200 dark:border-gray-600 px-2 text-xs font-medium text-gray-600 dark:text-gray-300 transition-[background-color,color] hover:border-blue-700 hover:bg-blue-700 hover:text-white dark:hover:!border-blue-600 dark:hover:!bg-blue-600 dark:hover:!text-white">
                        결재 작성
                      </a>
                    ) : s.approvalDocumentId ? (
                      <a href={`/approval/${s.approvalDocumentId}`}
                        className="inline-flex h-7 items-center rounded-md border border-gray-200 dark:border-gray-600 px-2 text-xs font-medium text-gray-600 dark:text-gray-300 transition-[background-color,color] hover:border-gray-600 hover:bg-gray-600 hover:text-white dark:hover:!border-gray-500 dark:hover:!bg-gray-500 dark:hover:!text-white">
                        결재 →
                      </a>
                    ) : <span className="text-gray-300">-</span>}
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      </TableCard>
    </div>
  );
}
