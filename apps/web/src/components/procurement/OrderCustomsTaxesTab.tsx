"use client";

import { useCallback, useEffect, useState } from "react";
import { procurementApi } from "@/lib/api";
import { fmtDate } from "@/lib/datetime";

type Status = "PENDING" | "PAID" | "REJECTED";

const fmtKRW = (v: any) => v == null ? "-" : `₩${Number(v).toLocaleString()}`;

/**
 * 발주송금 관부가세 큐 — 재무팀이 통관 시 관부가세를 처리하는 탭
 *  v1.6.1 (2026-05-15)
 *
 *   PENDING: 통관 시작된 발주, 관부가세 납부 대기 → 처리 모달
 *   PAID:    납부 완료된 이력
 *   REJECTED: 반려된 이력
 */
export default function OrderCustomsTaxesTab() {
  const [statusTab, setStatusTab] = useState<Status>("PENDING");
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await procurementApi.listCustomsTaxes(statusTab);
      setItems(Array.isArray(res) ? res : []);
    } finally { setLoading(false); }
  }, [statusTab]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="flex gap-2 mb-3">
        {(["PENDING", "PAID", "REJECTED"] as Status[]).map(s => (
          <button key={s} onClick={() => setStatusTab(s)}
            className={`px-3 py-1.5 text-sm rounded ${statusTab === s ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700"}`}>
            {s === "PENDING" ? "처리 대기" : s === "PAID" ? "납부 완료" : "반려"}
          </button>
        ))}
        <div className="ml-auto text-sm text-gray-500 self-center">총 {items.length}건</div>
      </div>

      {loading ? <div className="text-center py-12 text-gray-400">로딩 중...</div>
       : items.length === 0 ? <div className="text-center py-12 text-gray-400">{statusTab === "PENDING" ? "처리 대기 중인 관부가세가 없습니다." : "이력이 없습니다."}</div>
       : (
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">발주번호</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">제조사</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">고객사</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">통관일</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">관세</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">부가세</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">합계</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">납부일 / 사유</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map(t => (
                <tr key={t.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono">
                    <a href={`/procurement/orders/${t.order?.id}`} className="text-blue-600 hover:underline">{t.order?.orderNumber}</a>
                  </td>
                  <td className="px-4 py-3">{t.order?.manufacturer || "-"}</td>
                  <td className="px-4 py-3 text-gray-600">{t.order?.customer || "-"}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{t.order?.customsDate ? fmtDate(t.order.customsDate) : "-"}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmtKRW(t.customsDuty)}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmtKRW(t.vat)}</td>
                  <td className="px-4 py-3 text-right font-mono font-medium">{fmtKRW(t.totalAmount)}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">
                    {t.status === "PAID" && t.paidAt ? fmtDate(t.paidAt) :
                     t.status === "REJECTED" && t.rejectReason ? <span className="text-red-600">반려: {t.rejectReason}</span> :
                     t.notes || ""}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {statusTab === "PENDING" && (
                      <button onClick={() => setSelected(t)} className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700">처리</button>
                    )}
                    {statusTab === "PAID" && (
                      <button onClick={() => setSelected({ ...t, _editMode: true })} className="text-xs px-3 py-1 border border-blue-500 text-blue-600 rounded hover:bg-blue-50">정정</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <ProcessModal
          tax={selected}
          onClose={() => setSelected(null)}
          onSaved={async () => { setSelected(null); await load(); }}
        />
      )}
    </div>
  );
}

function ProcessModal({ tax, onClose, onSaved }: { tax: any; onClose: () => void; onSaved: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const isEditMode = !!tax._editMode;
  const [form, setForm] = useState({
    customsDuty: tax.customsDuty ? String(tax.customsDuty) : "",
    vat: tax.vat ? String(tax.vat) : "",
    paidAt: tax.paidAt ? tax.paidAt.slice(0, 10) : today,
    notes: tax.notes || "",
    rejectReason: "",
  });
  const [saving, setSaving] = useState(false);
  const totalAmount = (Number(form.customsDuty || 0) + Number(form.vat || 0));

  const handlePay = async () => {
    if (!form.customsDuty && !form.vat) { alert("관세 또는 부가세를 입력해주세요."); return; }
    setSaving(true);
    try {
      const payload = {
        ...(form.customsDuty ? { customsDuty: Number(form.customsDuty) } : {}),
        ...(form.vat ? { vat: Number(form.vat) } : {}),
        totalAmount,
        paidAt: form.paidAt,
        ...(form.notes ? { notes: form.notes } : {}),
      };
      if (isEditMode) {
        await procurementApi.correctCustomsTax(tax.id, payload);
      } else {
        await procurementApi.payCustomsTax(tax.id, payload);
      }
      onSaved();
    } catch (e: any) { alert(e.message || (isEditMode ? "정정 실패" : "처리 실패")); }
    finally { setSaving(false); }
  };

  const handleReject = async () => {
    if (!form.rejectReason) { alert("반려 사유를 입력해주세요."); return; }
    if (!confirm("관부가세를 반려하시겠습니까?")) return;
    setSaving(true);
    try {
      await procurementApi.rejectCustomsTax(tax.id, form.rejectReason);
      onSaved();
    } catch (e: any) { alert(e.message || "반려 실패"); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold mb-1">{isEditMode ? "관부가세 정정" : "관부가세 처리"}</h3>
        <p className="text-xs text-gray-500 mb-4">
          <a href={`/procurement/orders/${tax.order?.id}`} target="_blank" className="text-blue-600 hover:underline">{tax.order?.orderNumber}</a>
          {tax.order?.manufacturer && ` · ${tax.order.manufacturer}`}
        </p>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">관세 (KRW)</label>
            <input type="number" min={0} value={form.customsDuty}
              onChange={(e) => setForm({ ...form, customsDuty: e.target.value })}
              placeholder="0"
              className="w-full border rounded-lg px-3 py-2 text-sm text-right font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">부가세 (KRW)</label>
            <input type="number" min={0} value={form.vat}
              onChange={(e) => setForm({ ...form, vat: e.target.value })}
              placeholder="0"
              className="w-full border rounded-lg px-3 py-2 text-sm text-right font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
          </div>
          <div className="col-span-2 p-3 bg-gray-50 rounded-lg flex items-center justify-between">
            <span className="text-sm text-gray-600">합계</span>
            <span className="font-mono font-bold text-lg">₩{totalAmount.toLocaleString()}</span>
          </div>
          <div className="col-span-2">
            <label className="block text-sm text-gray-600 mb-1">납부일</label>
            <input type="date" value={form.paidAt}
              onChange={(e) => setForm({ ...form, paidAt: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="col-span-2">
            <label className="block text-sm text-gray-600 mb-1">메모</label>
            <textarea value={form.notes} rows={2}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>

        {!isEditMode && (
          <details className="mb-4">
            <summary className="text-sm text-red-600 cursor-pointer">반려 처리</summary>
            <div className="mt-2">
              <input type="text" value={form.rejectReason}
                onChange={(e) => setForm({ ...form, rejectReason: e.target.value })}
                placeholder="반려 사유"
                className="w-full border rounded-lg px-3 py-2 text-sm mb-2" />
              <button onClick={handleReject} disabled={saving || !form.rejectReason}
                className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">
                반려
              </button>
            </div>
          </details>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={saving} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">취소</button>
          <button onClick={handlePay} disabled={saving || totalAmount <= 0}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {saving ? "처리 중..." : (isEditMode ? "정정 저장" : "납부 완료")}
          </button>
        </div>
      </div>
    </div>
  );
}
