"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { procurementApi, supplierApi, repairApi } from "@/lib/api";
import { DateInput } from "@/components/ui/DateInput";

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
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);

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
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
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
        <div className="flex gap-2">
          {contract.status === "ACTIVE" && (
            <>
              <button onClick={async () => {
                if (!confirm("이 계약을 완료 처리하시겠습니까?")) return;
                await procurementApi.updateContract(id, { status: "COMPLETED" }); load();
              }} className="px-3 py-1.5 text-sm border border-green-300 text-green-600 rounded-lg hover:bg-green-50">완료</button>
              <button onClick={async () => {
                if (!confirm("이 계약을 취소 처리하시겠습니까?")) return;
                await procurementApi.updateContract(id, { status: "CANCELLED" }); load();
              }} className="px-3 py-1.5 text-sm border border-red-300 text-red-600 rounded-lg hover:bg-red-50">취소</button>
            </>
          )}
          {contract.status !== "CANCELLED" && (
            <button onClick={() => {
              setForm({
                name: contract.name || "",
                client: contract.client || "",
                clientContact: contract.clientContact || "",
                manufacturer: contract.manufacturer || "",
                category: contract.category || "물품",
                contractType: contract.contractType || "내자",
                contractDate: contract.contractDate?.slice(0, 10) || "",
                deadline: contract.deadline?.slice(0, 10) || "",
                manager: contract.manager || "",
                notes: contract.notes || "",
              });
              setEditing(true);
            }} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg">편집</button>
          )}
        </div>
      </div>

      {/* Contract Info */}
      <div className="bg-white rounded-lg border p-6 mb-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
          <div><span className="text-gray-500">고객사:</span> {contract.client ? (
            <button onClick={async () => {
              try {
                const res = await repairApi.getCustomers({ search: contract.client, limit: 1 });
                const list = res.items || res;
                const match = list.find((c: any) => c.name === contract.client);
                if (match) router.push(`/repair/customers/${match.id}`);
                else router.push(`/repair/customers?search=${encodeURIComponent(contract.client)}`);
              } catch { router.push(`/repair/customers?search=${encodeURIComponent(contract.client)}`); }
            }} className="ml-2 text-blue-600 hover:underline">{contract.client}</button>
          ) : <span className="ml-2">-</span>}</div>
          <div><span className="text-gray-500">담당:</span> <span className="ml-2">{contract.clientContact || "-"}</span></div>
          <div><span className="text-gray-500">제작사:</span> {contract.manufacturer ? (
            <button onClick={async () => {
              try {
                const s = await supplierApi.findByName(contract.manufacturer);
                if (s?.id) router.push(`/procurement/suppliers/${s.id}`);
                else router.push(`/procurement/suppliers?search=${encodeURIComponent(contract.manufacturer)}`);
              } catch { router.push(`/procurement/suppliers?search=${encodeURIComponent(contract.manufacturer)}`); }
            }} className="ml-2 text-blue-600 hover:underline">{contract.manufacturer}</button>
          ) : <span className="ml-2">-</span>}</div>
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

      {/* 편집 모달 */}
      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setEditing(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">계약 수정</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-sm text-gray-600">계약명</label>
                <input value={form.name} onChange={(e) => setForm((p: any) => ({ ...p, name: e.target.value }))}
                  className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-sm text-gray-600">고객사</label>
                <input value={form.client} onChange={(e) => setForm((p: any) => ({ ...p, client: e.target.value }))}
                  className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-sm text-gray-600">고객 담당자</label>
                <input value={form.clientContact} onChange={(e) => setForm((p: any) => ({ ...p, clientContact: e.target.value }))}
                  className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-sm text-gray-600">제작사</label>
                <input value={form.manufacturer} onChange={(e) => setForm((p: any) => ({ ...p, manufacturer: e.target.value }))}
                  className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-sm text-gray-600">담당자</label>
                <input value={form.manager} onChange={(e) => setForm((p: any) => ({ ...p, manager: e.target.value }))}
                  className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-sm text-gray-600">구분</label>
                <select value={form.category} onChange={(e) => setForm((p: any) => ({ ...p, category: e.target.value }))}
                  className="w-full border rounded px-3 py-2 text-sm">
                  <option value="물품">물품</option><option value="용역">용역</option>
                </select>
              </div>
              <div>
                <label className="text-sm text-gray-600">내자/외자</label>
                <select value={form.contractType} onChange={(e) => setForm((p: any) => ({ ...p, contractType: e.target.value }))}
                  className="w-full border rounded px-3 py-2 text-sm">
                  <option value="내자">내자</option><option value="외자">외자</option>
                </select>
              </div>
              <div>
                <label className="text-sm text-gray-600">계약일</label>
                <DateInput value={form.contractDate} onChange={(e) => setForm((p: any) => ({ ...p, contractDate: e.target.value }))}
                  className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-sm text-gray-600">납기</label>
                <DateInput value={form.deadline} onChange={(e) => setForm((p: any) => ({ ...p, deadline: e.target.value }))}
                  className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <div className="col-span-2">
                <label className="text-sm text-gray-600">메모</label>
                <textarea value={form.notes} onChange={(e) => setForm((p: any) => ({ ...p, notes: e.target.value }))}
                  className="w-full border rounded px-3 py-2 text-sm" rows={2} />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setEditing(false)} className="px-4 py-2 border rounded-lg text-sm">취소</button>
              <button disabled={saving} onClick={async () => {
                setSaving(true);
                try {
                  await procurementApi.updateContract(id, form);
                  setEditing(false);
                  load();
                } catch (e: any) { alert(e.message); }
                finally { setSaving(false); }
              }} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50">저장</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
