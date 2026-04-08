"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { repairApi } from "@/lib/api";

const STATUS_LABELS: Record<string, string> = {
  RECEIVED: "접수", INSPECTING_1ST: "1차점검", QUOTED: "견적발행", APPROVED: "승인",
  REPAIRING: "수리중", SHIPPED_TO_MFG: "제조사발송", RECEIVED_FROM_MFG: "제조사입고",
  INSPECTING_2ND: "2차점검", COMPLETED: "완료", CLOSED: "종료", CANCELLED: "취소",
};

export default function CustomerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [customer, setCustomer] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showAssetForm, setShowAssetForm] = useState(false);

  const load = useCallback(async () => {
    try {
      setCustomer(await repairApi.getCustomer(id));
    } catch {}
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="py-12 text-center text-gray-400">불러오는 중...</div>;
  if (!customer) return <div className="py-12 text-center text-gray-400">고객을 찾을 수 없습니다.</div>;

  return (
    <div className="space-y-6">
      {/* 뒤로가기 */}
      <button onClick={() => router.push("/repair/customers")} className="text-sm text-gray-500 hover:text-gray-700">&larr; 고객 목록</button>

      {/* 기본 정보 */}
      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <h2 className="text-xl font-bold text-gray-900 mb-3">{customer.name}</h2>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><span className="text-gray-500">담당자: </span>{customer.contactPerson || "-"}{customer.department ? ` (${customer.department})` : ""}</div>
          <div><span className="text-gray-500">전화: </span>{customer.phone || "-"}</div>
          <div><span className="text-gray-500">이메일: </span>{customer.email || "-"}</div>
          <div><span className="text-gray-500">주소: </span>{customer.address || "-"}</div>
        </div>
      </div>

      {/* 보유 자산 */}
      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-800">보유 자산 ({customer.assets?.length || 0})</h3>
          <button onClick={() => setShowAssetForm(true)}
            className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            + 자산 추가
          </button>
        </div>
        {customer.assets?.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 text-xs text-gray-500">유형</th>
                <th className="text-left py-2 text-xs text-gray-500">이름</th>
                <th className="text-left py-2 text-xs text-gray-500">제작사</th>
                <th className="text-left py-2 text-xs text-gray-500">S.N</th>
                <th className="text-left py-2 text-xs text-gray-500">OT재고NO</th>
              </tr>
            </thead>
            <tbody>
              {customer.assets.map((a: any) => (
                <tr key={a.id} className="border-t border-gray-100">
                  <td className="py-2">{a.assetType === "EQUIPMENT" ? "장비" : "센서"}</td>
                  <td className="py-2 font-medium">{a.name}</td>
                  <td className="py-2 text-gray-600">{a.manufacturer || "-"}</td>
                  <td className="py-2 text-gray-500">{a.serialNumber || "-"}</td>
                  <td className="py-2 text-gray-500">{a.otInventoryNo || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-gray-400">등록된 자산이 없습니다.</p>
        )}
      </div>

      {/* AS 이력 */}
      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <h3 className="font-semibold text-gray-800 mb-3">AS 이력 ({customer.repairOrders?.length || 0})</h3>
        {customer.repairOrders?.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 text-xs text-gray-500">접수번호</th>
                <th className="text-left py-2 text-xs text-gray-500">장비</th>
                <th className="text-left py-2 text-xs text-gray-500">증상</th>
                <th className="text-center py-2 text-xs text-gray-500">상태</th>
                <th className="text-center py-2 text-xs text-gray-500">접수일</th>
              </tr>
            </thead>
            <tbody>
              {customer.repairOrders.map((o: any) => (
                <tr key={o.id} className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer"
                  onClick={() => router.push(`/repair/${o.id}`)}>
                  <td className="py-2 text-blue-600 font-medium">{o.orderNumber}</td>
                  <td className="py-2">{o.customerAsset?.name || "-"}</td>
                  <td className="py-2 text-gray-600 truncate max-w-[200px]">{o.symptom || "-"}</td>
                  <td className="py-2 text-center text-xs">{STATUS_LABELS[o.status] || o.status}</td>
                  <td className="py-2 text-center text-xs text-gray-500">{new Date(o.receivedAt).toLocaleDateString("ko-KR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-gray-400">AS 이력이 없습니다.</p>
        )}
      </div>

      {/* 자산 추가 폼 */}
      {showAssetForm && (
        <AssetForm customerId={id} onClose={() => setShowAssetForm(false)} onSaved={() => { setShowAssetForm(false); load(); }} />
      )}
    </div>
  );
}

function AssetForm({ customerId, onClose, onSaved }: { customerId: string; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    assetType: "EQUIPMENT",
    name: "",
    serialNumber: "",
    manufacturer: "",
    model: "",
    otInventoryNo: "",
  });
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await repairApi.createCustomerAsset({ customerId, ...form });
      onSaved();
    } catch (e: any) {
      alert(e.message || "추가 실패");
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">자산 추가</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">유형</label>
            <select value={form.assetType} onChange={(e) => setForm((f) => ({ ...f, assetType: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="EQUIPMENT">장비</option>
              <option value="SENSOR">센서</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">이름 (제품명) *</label>
            <input type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">제작사</label>
              <input type="text" value={form.manufacturer} onChange={(e) => setForm((f) => ({ ...f, manufacturer: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">모델</label>
              <input type="text" value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">시리얼 번호</label>
              <input type="text" value={form.serialNumber} onChange={(e) => setForm((f) => ({ ...f, serialNumber: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">OT재고NO</label>
              <input type="text" value={form.otInventoryNo} onChange={(e) => setForm((f) => ({ ...f, otInventoryNo: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">취소</button>
            <button type="submit" disabled={saving} className="flex-1 bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
              {saving ? "추가 중..." : "추가"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
