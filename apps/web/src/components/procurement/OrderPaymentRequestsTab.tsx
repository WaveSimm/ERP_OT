"use client";

import { useEffect, useState, useCallback } from "react";
import { procurementApi } from "@/lib/api";
import { DateInput } from "@/components/ui/DateInput";
import { fmtDate, fmtDateTime24 } from "@/lib/datetime";

const CURRENCY_SYMBOLS: Record<string, string> = { EUR: "€", GBP: "£", USD: "$", KRW: "₩" };
const fmtAmount = (v: any, c?: string) => {
  if (v == null) return "-";
  const n = Number(v);
  const sym = c ? (CURRENCY_SYMBOLS[c] || c) : "";
  return `${sym}${n.toLocaleString("ko-KR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
};
const fmtDateTime = (d: any) => fmtDateTime24(d) || "-";

type StatusTab = "REQUESTED" | "COMPLETED" | "REJECTED";

/**
 * 발주송금 큐 — 재무팀이 발주별 송금 요청을 처리하는 탭
 *  v1.6 (2026-05-14)
 */
export default function OrderPaymentRequestsTab() {
  const [statusTab, setStatusTab] = useState<StatusTab>("REQUESTED");
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await procurementApi.listPaymentRequests(statusTab);
      setItems(Array.isArray(data) ? data : []);
    } catch { setItems([]); }
    finally { setLoading(false); }
  }, [statusTab]);

  useEffect(() => { load(); }, [load]);

  const counts = items.length;

  return (
    <div>
      {/* status sub-tab */}
      <div className="flex gap-2 mb-4">
        {(["REQUESTED", "COMPLETED", "REJECTED"] as StatusTab[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatusTab(s)}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              statusTab === s ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {s === "REQUESTED" ? "대기" : s === "COMPLETED" ? "완료" : "반려"}
            {statusTab === s && ` (${counts})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">로딩 중...</div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          {statusTab === "REQUESTED" ? "대기 중인 송금 요청이 없습니다." : "내역이 없습니다."}
        </div>
      ) : (
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">발주번호</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">제조사</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">고객사</th>
                <th className="px-4 py-3 text-center font-medium text-gray-600">방식</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">금액</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">요청일시</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">비고</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((p: any) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono">
                    <a href={`/procurement/orders/${p.order?.id}`} className="text-blue-600 hover:underline">{p.order?.orderNumber}</a>
                  </td>
                  <td className="px-4 py-3">{p.order?.manufacturer || "-"}</td>
                  <td className="px-4 py-3 text-gray-600">{p.order?.customer || "-"}</td>
                  <td className="px-4 py-3 text-center">{p.paymentMethod || "-"}</td>
                  <td className="px-4 py-3 text-right font-mono font-medium">{fmtAmount(p.amount, p.currency)}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{fmtDateTime(p.requestedAt)}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">
                    {statusTab === "REJECTED" && p.rejectReason ? <span className="text-red-600">반려: {p.rejectReason}</span> : (p.notes || "")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {statusTab === "REQUESTED" && (
                      <button
                        onClick={() => setSelected(p)}
                        className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
                      >처리</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <ProcessRequestModal
          payment={selected}
          onClose={() => setSelected(null)}
          onDone={async () => { setSelected(null); await load(); }}
        />
      )}
    </div>
  );
}

// ─── 송금 요청 처리 모달 ──────────────────────────────────────────────
function ProcessRequestModal({
  payment,
  onClose,
  onDone,
}: {
  payment: any;
  onClose: () => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<"complete" | "reject">("complete");
  const [form, setForm] = useState({
    paymentDate: new Date().toISOString().slice(0, 10),
    amount: payment.amount ? String(payment.amount) : "",
    amountKRW: "",
    exchangeRate: "",
    paymentMethod: payment.paymentMethod || "T/T",
    bankReference: "",
    notes: payment.notes || "",
    rejectReason: "",
  });
  const [saving, setSaving] = useState(false);

  const requestedAmount = Number(payment.amount) || 0;
  const actualAmount = Number(form.amount) || 0;
  const isPartial = actualAmount > 0 && actualAmount < requestedAmount;
  const remaining = isPartial ? requestedAmount - actualAmount : 0;

  const handleComplete = async () => {
    if (!form.paymentDate) { alert("송금일은 필수입니다."); return; }
    if (actualAmount <= 0) { alert("송금액은 0보다 커야 합니다."); return; }
    // 부분 결제 시 확인
    if (isPartial) {
      const confirmMsg = `실제 송금액(${actualAmount.toLocaleString()})이 요청 금액(${requestedAmount.toLocaleString()})보다 적습니다.\n\n잔여 ${remaining.toLocaleString()}는 새 송금 요청으로 자동 생성됩니다.\n\n진행하시겠습니까?`;
      if (!confirm(confirmMsg)) return;
    }
    setSaving(true);
    try {
      const payload: any = {
        paymentDate: form.paymentDate,
        paymentMethod: form.paymentMethod,
        amount: actualAmount,
      };
      if (form.amountKRW) payload.amountKRW = Number(form.amountKRW);
      if (form.exchangeRate) payload.exchangeRate = Number(form.exchangeRate);
      if (form.bankReference) payload.bankReference = form.bankReference;
      if (form.notes) payload.notes = form.notes;
      await procurementApi.completePaymentRequest(payment.id, payload);
      onDone();
    } catch (e: any) {
      alert(e.message || "완료 처리 실패");
    } finally { setSaving(false); }
  };

  const handleReject = async () => {
    if (!form.rejectReason.trim()) { alert("반려 사유는 필수입니다."); return; }
    if (!confirm(`송금 요청을 반려하시겠습니까?\n사유: ${form.rejectReason}`)) return;
    setSaving(true);
    try {
      await procurementApi.rejectPaymentRequest(payment.id, form.rejectReason);
      onDone();
    } catch (e: any) {
      alert(e.message || "반려 실패");
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold mb-1">송금 요청 처리</h3>
        <p className="text-xs text-gray-500 mb-4">
          발주: <a href={`/procurement/orders/${payment.order?.id}`} target="_blank" rel="noreferrer"
            className="text-blue-600 hover:underline font-mono">{payment.order?.orderNumber}</a>
          {" · "}{payment.order?.manufacturer}
          {payment.order?.customer && ` · ${payment.order.customer}`}
        </p>

        <div className="flex gap-2 mb-4">
          <button onClick={() => setMode("complete")}
            className={`px-3 py-1.5 text-sm rounded ${mode === "complete" ? "bg-green-600 text-white" : "bg-gray-100"}`}>완료 처리</button>
          <button onClick={() => setMode("reject")}
            className={`px-3 py-1.5 text-sm rounded ${mode === "reject" ? "bg-red-600 text-white" : "bg-gray-100"}`}>반려</button>
        </div>

        {mode === "complete" ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">송금일 *</label>
              <DateInput value={form.paymentDate}
                onChange={(e: any) => setForm({ ...form, paymentDate: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">결제 방식</label>
              <select value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm">
                <option value="T/T">T/T</option>
                <option value="L/C">L/C</option>
                <option value="무역금융">무역금융</option>
                <option value="기타">기타</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">
                실제 송금액 ({payment.currency})
                <span className="text-gray-400 text-xs ml-2">요청: {requestedAmount.toLocaleString()}</span>
              </label>
              <input type="number" step="0.01" min={0} value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                className={`w-full border rounded-lg px-3 py-2 text-sm text-right font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
                  isPartial ? "border-amber-400 bg-amber-50/30" : ""
                }`} />
              {isPartial && (
                <div className="text-xs text-amber-700 mt-1">
                  ⚠ 부분 결제 — 잔여 <span className="font-mono font-medium">{remaining.toLocaleString()} {payment.currency}</span>는 새 송금 요청으로 자동 생성됩니다
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">원화 환산</label>
              <input type="number" step="1" min={0} value={form.amountKRW}
                onChange={(e) => setForm({ ...form, amountKRW: e.target.value })}
                placeholder="0"
                className="w-full border rounded-lg px-3 py-2 text-sm text-right font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">환율</label>
              <input type="number" step="0.0001" min={0} value={form.exchangeRate}
                onChange={(e) => setForm({ ...form, exchangeRate: e.target.value })}
                placeholder="0.0000"
                className="w-full border rounded-lg px-3 py-2 text-sm text-right font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">송금 참조 번호</label>
              <input type="text" value={form.bankReference}
                onChange={(e) => setForm({ ...form, bankReference: e.target.value })}
                placeholder="REF1234"
                className="w-full border rounded-lg px-3 py-2 text-sm font-mono" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm text-gray-600 mb-1">비고</label>
              <textarea value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
                className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
        ) : (
          <div>
            <label className="block text-sm text-gray-600 mb-1">반려 사유 *</label>
            <textarea value={form.rejectReason}
              onChange={(e) => setForm({ ...form, rejectReason: e.target.value })}
              rows={3}
              placeholder="반려 사유를 입력하세요"
              className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
        )}

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">취소</button>
          {mode === "complete" ? (
            <button onClick={handleComplete} disabled={saving}
              className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
              {saving ? "처리 중..." : "송금 완료"}
            </button>
          ) : (
            <button onClick={handleReject} disabled={saving}
              className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">
              {saving ? "처리 중..." : "반려 확정"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
