"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { settlementApi } from "@/lib/api";
import SortableHeader from "@/components/SortableHeader";
import { useSortPreference } from "@/hooks/useSortPreference";
import { useFillHeight } from "@/hooks/useFillHeight";
import { TableCard, Table, THead, Th, TBody, Tr, Td, TableEmpty, StatusBadge } from "@/components/ui/Table";

export default function SettlementsPage() {
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const { ref: tableBoxRef, maxHeight: tableMaxH } = useFillHeight();
  const [loading, setLoading] = useState(true);
  const { sortBy, sortOrder, handleSort, resetSort } = useSortPreference("settlements", "", "desc");

  useEffect(() => {
    setLoading(true);
    settlementApi.list({ ...(sortBy && { sortBy, sortOrder }) })
      .then((res) => setItems(Array.isArray(res) ? res : []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [sortBy, sortOrder]);

  return (
    <div>
      <div className="flex justify-between items-center gap-3 mb-4">
        <div className="text-sm text-gray-500">{!loading && `총 ${items.length}건`}</div>
        <div className="flex items-center gap-3">
          {sortBy && (
            <button onClick={resetSort} title="정렬을 원래 순서로 되돌립니다"
              className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
              ↺ 정렬 초기화
            </button>
          )}
          <button onClick={() => router.push("/procurement/settlements/new")}
            className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
            + 수입원가정산 작성
          </button>
        </div>
      </div>

      <TableCard scrollRef={tableBoxRef} maxHeight={tableMaxH}>
        <Table fixed columnDividers>
          <colgroup>
            <col className="w-[13%]" />
            <col className="w-[20%]" />
            <col className="w-[8%]" />
            <col className="w-[15%]" />
            <col className="w-[13%]" />
            <col className="w-[15%]" />
            <col className="w-[6%]" />
            <col className="w-[10%]" />
          </colgroup>
          <THead>
            <SortableHeader sortKey="declarationNo" currentSort={sortBy} order={sortOrder} onSort={handleSort} align="center" className="px-4 py-3 font-medium">신고번호</SortableHeader>
            <SortableHeader sortKey="supplier" currentSort={sortBy} order={sortOrder} onSort={handleSort} align="center" className="px-4 py-3 font-medium">공급업체</SortableHeader>
            <Th align="center">통화</Th>
            <Th align="center">수입원가</Th>
            <Th align="center">부대비용</Th>
            <SortableHeader sortKey="totalAmount" currentSort={sortBy} order={sortOrder} onSort={handleSort} align="center" className="px-4 py-3 font-medium">공급가액</SortableHeader>
            <Th align="center">품목</Th>
            <SortableHeader sortKey="declarationDate" currentSort={sortBy} order={sortOrder} onSort={handleSort} align="center" className="px-4 py-3 font-medium">신고일</SortableHeader>
          </THead>
          <TBody>
            {loading ? (
              <TableEmpty colSpan={8}>로딩 중...</TableEmpty>
            ) : items.length === 0 ? (
              <TableEmpty colSpan={8}>수입원가정산 데이터가 없습니다.</TableEmpty>
            ) : items.map((s: any) => (
              <Tr key={s.id} onClick={() => router.push(`/procurement/settlements/${s.id}`)}>
                <Td strong mono align="left" truncate title={s.declarationNo}>{s.declarationNo}</Td>
                <Td dash truncate title={s.supplier || undefined}>{s.supplier}</Td>
                <Td align="center"><StatusBadge color="gray">{s.currency || "USD"}</StatusBadge></Td>
                <Td align="right" mono>₩{Number(s.totalImportCost).toLocaleString()}</Td>
                <Td align="right" mono className="text-orange-600 dark:text-orange-400">
                  {Number(s.totalExtraCost) > 0 ? `₩${Number(s.totalExtraCost).toLocaleString()}` : "-"}
                </Td>
                <Td align="right" mono>₩{Number(s.supplyAmount).toLocaleString()}</Td>
                <Td align="center" mono>{s._count?.items || 0}</Td>
                <Td align="center" mono>{new Date(s.declarationDate).toLocaleDateString("ko-KR")}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </TableCard>
    </div>
  );
}
