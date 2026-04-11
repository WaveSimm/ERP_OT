"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { procurementApi } from "@/lib/api";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "초안", PENDING_APPROVAL: "승인대기", APPROVED: "승인",
  REJECTED: "반려", ORDERED: "발주완료", IN_PRODUCTION: "제작중",
  SHIPPED: "출하/선적", CUSTOMS: "통관중", PARTIALLY_RECEIVED: "부분입고",
  ARRIVED: "입고완료", CLOSED: "마감",
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700", PENDING_APPROVAL: "bg-yellow-100 text-yellow-700",
  APPROVED: "bg-green-100 text-green-700", REJECTED: "bg-red-100 text-red-700",
  ORDERED: "bg-blue-100 text-blue-700", IN_PRODUCTION: "bg-indigo-100 text-indigo-700",
  SHIPPED: "bg-purple-100 text-purple-700", CUSTOMS: "bg-orange-100 text-orange-700",
  PARTIALLY_RECEIVED: "bg-amber-100 text-amber-700", ARRIVED: "bg-emerald-100 text-emerald-700",
  CLOSED: "bg-gray-200 text-gray-600",
};

const CONTRACT_STATUS: Record<string, string> = { ACTIVE: "진행중", COMPLETED: "완료", CANCELLED: "취소" };

const CURRENCY_SYMBOLS: Record<string, string> = {
  EUR: "\u20AC", GBP: "\u00A3", USD: "$", KRW: "\u20A9",
};

function fmtDate(d: string | null) {
  return d ? new Date(d).toLocaleDateString("ko-KR") : "-";
}

function fmtAmount(val: string | number, currency?: string) {
  const n = Number(val);
  const sym = currency ? (CURRENCY_SYMBOLS[currency] || currency) : "";
  return `${sym}${n.toLocaleString("ko-KR")}`;
}

export default function ContractDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const [contract, setContract] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setContract(await procurementApi.getContract(id));
    } catch {
      router.push("/procurement/contracts");
    } finally { setLoading(false); }
  }, [id, router]);

  useEffect(() => { load(); }, [load]);

  if (loading || !contract) {
    return <div className="flex items-center justify-center h-64 text-gray-400">로딩 중...</div>;
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.push("/procurement/contracts")} className="text-gray-400 hover:text-gray-600">&larr;</button>
        <div>
          <h1 className="text-xl font-bold">{contract.contractNumber}</h1>
          <p className="text-sm text-gray-500">{contract.name}</p>
        </div>
        <span className={`ml-3 px-3 py-1 rounded-full text-sm font-medium ${
          contract.status === "ACTIVE" ? "bg-green-100 text-green-700" :
          contract.status === "COMPLETED" ? "bg-gray-100 text-gray-600" : "bg-red-100 text-red-700"
        }`}>
          {CONTRACT_STATUS[contract.status]}
        </span>
      </div>

      {/* Contract Info */}
      <div className="bg-white rounded-lg border p-6 mb-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
          <div><span className="text-gray-500">고객사:</span> <span className="ml-2">{contract.client || "-"}</span></div>
          <div><span className="text-gray-500">담당:</span> <span className="ml-2">{contract.clientContact || "-"}</span></div>
          <div><span className="text-gray-500">제작사:</span> <span className="ml-2">{contract.manufacturer || "-"}</span></div>
          <div><span className="text-gray-500">구분:</span> <span className="ml-2">{contract.category} / {contract.contractType}</span></div>
          <div><span className="text-gray-500">계약일:</span> <span className="ml-2">{fmtDate(contract.contractDate)}</span></div>
          <div><span className="text-gray-500">납기:</span> <span className="ml-2">{fmtDate(contract.deadline)}</span></div>
          <div><span className="text-gray-500">담당자:</span> <span className="ml-2">{contract.manager || "-"}</span></div>
          <div><span className="text-gray-500">발주수:</span> <span className="ml-2 font-bold">{contract.orders?.length || 0}건</span></div>
        </div>
        {contract.notes && (
          <div className="mt-3 pt-3 border-t text-sm text-gray-600">{contract.notes}</div>
        )}
      </div>

      {/* Orders under this contract */}
      <h3 className="font-bold mb-3">발주 목록</h3>
      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600">발주번호</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">제조사</th>
              <th className="px-4 py-3 text-center font-medium text-gray-600">통화</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">금액</th>
              <th className="px-4 py-3 text-center font-medium text-gray-600">상태</th>
              <th className="px-4 py-3 text-center font-medium text-gray-600">품목수</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">발주일</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {contract.orders?.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">발주가 없습니다.</td></tr>
            ) : contract.orders?.map((o: any) => (
              <tr key={o.id} onClick={() => router.push(`/procurement/orders/${o.id}`)} className="hover:bg-gray-50 cursor-pointer">
                <td className="px-4 py-3 font-mono text-blue-600">{o.orderNumber}</td>
                <td className="px-4 py-3">{o.manufacturer}</td>
                <td className="px-4 py-3 text-center">{o.currency}</td>
                <td className="px-4 py-3 text-right font-mono">{fmtAmount(o.totalAmount, o.currency)}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[o.status]}`}>
                    {STATUS_LABELS[o.status] || o.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-center text-gray-500">{o._count?.items ?? 0}</td>
                <td className="px-4 py-3 text-gray-500">{fmtDate(o.orderDate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
