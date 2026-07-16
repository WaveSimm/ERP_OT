"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { expenseApi } from "@/lib/api";
import { fmtDate, fmtDateTime24 } from "@/lib/datetime";
import { SettlementStatusBadge } from "../_components/settlement-status-badge";
import { useTableSort } from "@/lib/hooks/useTableSort";
import { useBulkSelect } from "@/lib/hooks/useBulkSelect";
import { TableCard, Table, THead, Th, TBody, Tr, Td, TableEmpty, RowButton } from "@/components/ui/Table";

export default function FinanceQueuePage() {
  const [tab, setTab] = useState<"APPROVED" | "RECEIVED">("APPROVED");
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  type SortKey = "title" | "periodStart" | "totalCount" | "totalAmount" | "approvedAt";
  const sort = useTableSort<any, SortKey>(items, {
    initialKey: "approvedAt",
    initialDir: "asc", // 오래된 것부터 처리
    keyExtractor: (s, key) => {
      switch (key) {
        case "title": return s.title ?? "";
        case "periodStart": return new Date(s.periodStart);
        case "totalCount": return s.totalCount ?? 0;
        case "totalAmount": return Number(s.totalAmount ?? 0);
        case "approvedAt": return s.approvedAt ? new Date(s.approvedAt) : null;
      }
    },
  });
  const sortedItems = sort.sortedItems;
  const sel = useBulkSelect<any>(sortedItems, (s) => s.id);

  const load = async () => {
    setLoading(true);
    try {
      const r = await expenseApi.financeQueue(tab);
      setItems(r.items);
      setForbidden(false);
      sel.clear();
    } catch (e: any) {
      if ((e.message ?? "").includes("FORBIDDEN") || (e.message ?? "").includes("권한")) setForbidden(true);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load();   }, [tab]);

  const receive = async (id: string) => {
    if (!confirm("정산서를 접수하시겠습니까?")) return;
    await expenseApi.receive(id);
    load();
  };

  const pay = async (s: any) => {
    const amount = parseInt(prompt(`입금 금액을 확인해 주세요 (총액 ${Number(s.totalAmount).toLocaleString()}원):`, String(s.totalAmount)) ?? "", 10);
    if (!amount) return;
    const note = prompt("입금 메모 (선택):", "") ?? "";
    await expenseApi.pay(s.id, { paidAt: new Date().toISOString(), paidAmount: amount, paidNote: note || undefined });
    load();
  };

  const bulkReceive = async () => {
    if (sel.count === 0) return;
    if (!confirm(`${sel.count}건을 일괄 접수하시겠습니까?`)) return;
    setBulkBusy(true);
    try {
      const results = await Promise.allSettled(sel.ids.map((id) => expenseApi.receive(id)));
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed > 0) alert(`${failed}건 실패`);
      await load();
    } finally {
      setBulkBusy(false);
    }
  };

  if (forbidden) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-12 text-center">
        <h1 className="text-xl font-bold text-gray-900 mb-2">접근 권한 없음</h1>
        <p className="text-gray-600 text-sm">재무팀 또는 관리자만 접근할 수 있는 페이지입니다.</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-6 space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">💰 재무팀 처리</h1>

      <div className="flex gap-1 border-b border-gray-200">
        {([
          { v: "APPROVED" as const, l: "접수 대기" },
          { v: "RECEIVED" as const, l: "입금 대기" },
        ]).map((t) => (
          <button key={t.v} onClick={() => setTab(t.v)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.v ? "border-blue-600 text-blue-600 dark:text-blue-400" : "border-transparent text-gray-500 hover:text-gray-700"
            }`}>
            {t.l}
          </button>
        ))}
      </div>

      {/* 일괄 작업 바 (접수 대기 탭에서만 의미 있음) */}
      {tab === "APPROVED" && items.length > 0 && (
        <div className={`sticky top-14 z-10 border rounded-lg p-3 flex flex-wrap items-center gap-2 transition-colors ${
          sel.count > 0 ? "bg-blue-50 border-blue-300 dark:border-blue-800" : "bg-gray-50 border-gray-200"
        }`}>
          <span className={`text-sm font-medium ${sel.count > 0 ? "text-blue-900 dark:text-blue-300" : "text-gray-500"}`}>
            {sel.count > 0 ? `선택 ${sel.count}건` : "선택된 항목 없음"}
          </span>
          <button onClick={bulkReceive} disabled={bulkBusy || sel.count === 0}
            className="px-3 py-1 text-sm rounded enabled:bg-blue-600 enabled:text-white enabled:hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400">
            {bulkBusy ? "처리 중..." : "일괄 접수"}
          </button>
          {sel.count > 0 && (
            <button onClick={sel.clear} className="text-xs text-gray-600 hover:text-gray-800">선택 해제</button>
          )}
          <span className="ml-auto text-[11px] text-gray-500">💡 입금은 금액별로 단일 처리</span>
        </div>
      )}

      <TableCard>
        <Table columnDividers>
          <THead>
            {tab === "APPROVED" && (
              <Th align="center" className="w-8">
                <input type="checkbox" checked={sel.isAllSelected()} onChange={sel.toggleAll}
                  ref={sel.headerRef} className="cursor-pointer" />
              </Th>
            )}
            <Th align="center" onClick={() => sort.handleSort("title")} className="cursor-pointer hover:bg-gray-100 select-none">정산{sort.sortIndicator("title")}</Th>
            <Th align="center" onClick={() => sort.handleSort("periodStart")} className="cursor-pointer hover:bg-gray-100 select-none">기간{sort.sortIndicator("periodStart")}</Th>
            <Th align="center" onClick={() => sort.handleSort("totalCount")} className="cursor-pointer hover:bg-gray-100 select-none">건수{sort.sortIndicator("totalCount")}</Th>
            <Th align="center" onClick={() => sort.handleSort("totalAmount")} className="cursor-pointer hover:bg-gray-100 select-none">총액{sort.sortIndicator("totalAmount")}</Th>
            <Th align="center" onClick={() => sort.handleSort("approvedAt")} className="cursor-pointer hover:bg-gray-100 select-none">결재완료{sort.sortIndicator("approvedAt")}</Th>
            <Th align="center">상태</Th>
            <Th align="center">작업</Th>
          </THead>
          <TBody>
            {loading ? (
              <TableEmpty colSpan={tab === "APPROVED" ? 8 : 7}>불러오는 중...</TableEmpty>
            ) : sortedItems.length === 0 ? (
              <TableEmpty colSpan={tab === "APPROVED" ? 8 : 7}>처리할 정산이 없습니다.</TableEmpty>
            ) : sortedItems.map((s) => {
              const checked = sel.isSelected(s.id);
              return (
                <Tr key={s.id} className={checked ? "bg-blue-50/40 dark:bg-blue-500/10" : ""}>
                  {tab === "APPROVED" && (
                    <Td align="center">
                      <input type="checkbox" checked={checked}
                        onMouseDown={sel.handleMouseDown}
                        onChange={() => sel.handleChange(s.id)}
                        className="cursor-pointer" />
                    </Td>
                  )}
                  <Td strong>
                    <Link href={`/expense/settlements/${s.id}`} className="hover:underline">{s.title}</Link>
                  </Td>
                  <Td align="center" className="whitespace-nowrap text-xs">{fmtDate(s.periodStart)} ~ {fmtDate(s.periodEnd)}</Td>
                  <Td align="right" mono>{s.totalCount}</Td>
                  <Td align="right" mono>{Number(s.totalAmount).toLocaleString()}원</Td>
                  <Td align="center" mono className="whitespace-nowrap">{s.approvedAt ? fmtDateTime24(s.approvedAt, { short: true }) : "-"}</Td>
                  <Td align="center"><SettlementStatusBadge status={s.status} /></Td>
                  <Td align="center">
                    {s.status === "APPROVED" && (
                      <RowButton onClick={() => receive(s.id)}>접수</RowButton>
                    )}
                    {s.status === "RECEIVED" && (
                      <RowButton onClick={() => pay(s)}>입금 완료</RowButton>
                    )}
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
