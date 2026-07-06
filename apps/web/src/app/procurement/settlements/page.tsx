"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { settlementApi } from "@/lib/api";
import SortableHeader from "@/components/SortableHeader";
import { useSortPreference } from "@/hooks/useSortPreference";
import { useFillHeight } from "@/hooks/useFillHeight";

export default function SettlementsPage() {
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const { ref: tableBoxRef, maxHeight: tableMaxH } = useFillHeight();
  const [loading, setLoading] = useState(true);
  const { sortBy, sortOrder, handleSort } = useSortPreference("settlements", "", "desc");

  useEffect(() => {
    setLoading(true);
    settlementApi.list({ ...(sortBy && { sortBy, sortOrder }) })
      .then((res) => setItems(Array.isArray(res) ? res : []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [sortBy, sortOrder]);

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div className="text-sm text-gray-500">{!loading && `총 ${items.length}건`}</div>
        <button onClick={() => router.push("/procurement/settlements/new")}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
          + 수입원가정산 작성
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">로딩 중...</div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-gray-400">수입원가정산 데이터가 없습니다.</div>
      ) : (
        <div ref={tableBoxRef} className="bg-white rounded-lg border overflow-auto" style={{ maxHeight: tableMaxH }}>
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-gray-50 text-gray-600 [&>tr>th]:border-b [&>tr>th]:border-gray-200">
              <tr>
                <SortableHeader sortKey="declarationNo" currentSort={sortBy} order={sortOrder} onSort={handleSort} className="text-left px-4 py-3 font-medium">신고번호</SortableHeader>
                <SortableHeader sortKey="supplier" currentSort={sortBy} order={sortOrder} onSort={handleSort} className="text-left px-4 py-3 font-medium">공급업체</SortableHeader>
                <th className="text-center px-3 py-3 font-medium">통화</th>
                <th className="text-right px-4 py-3 font-medium">수입원가</th>
                <th className="text-right px-4 py-3 font-medium">부대비용</th>
                <SortableHeader sortKey="totalAmount" currentSort={sortBy} order={sortOrder} onSort={handleSort} align="right" className="text-right px-4 py-3 font-medium">공급가액</SortableHeader>
                <th className="text-center px-3 py-3 font-medium">품목</th>
                <SortableHeader sortKey="declarationDate" currentSort={sortBy} order={sortOrder} onSort={handleSort} align="right" className="text-right px-4 py-3 font-medium">신고일</SortableHeader>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((s: any) => (
                <tr key={s.id} className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => router.push(`/procurement/settlements/${s.id}`)}>
                  <td className="px-4 py-3 font-mono text-xs">{s.declarationNo}</td>
                  <td className="px-4 py-3">{s.supplier}</td>
                  <td className="px-3 py-3 text-center">
                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{s.currency || "USD"}</span>
                  </td>
                  <td className="px-4 py-3 text-right font-medium">₩{Number(s.totalImportCost).toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-orange-600 dark:text-orange-400">
                    {Number(s.totalExtraCost) > 0 ? `₩${Number(s.totalExtraCost).toLocaleString()}` : "-"}
                  </td>
                  <td className="px-4 py-3 text-right">₩{Number(s.supplyAmount).toLocaleString()}</td>
                  <td className="px-3 py-3 text-center text-gray-500 text-xs">{s._count?.items || 0}</td>
                  <td className="px-4 py-3 text-right text-gray-500">
                    {new Date(s.declarationDate).toLocaleDateString("ko-KR")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
