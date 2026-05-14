"use client";

import { useState, useEffect, useCallback } from "react";
import { procurementApi } from "@/lib/api";
import { DateInput } from "@/components/ui/DateInput";

const CURRENCY_SYMBOLS: Record<string, string> = { EUR: "€", GBP: "£", USD: "$", KRW: "₩" };
const fmtAmount = (val: number | string | null | undefined, currency?: string) => {
  if (val == null) return "-";
  const n = Number(val);
  const sym = currency ? (CURRENCY_SYMBOLS[currency] || currency) : "";
  return `${sym}${n.toLocaleString("ko-KR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
};
const fmtDate = (d: string | null | undefined) => {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("ko-KR");
};

interface Props {
  orderId: string;
  orderCurrency: string;
  orderStatus: string;
  refreshSignal?: number;  // v1.6 (2026-05-14): 외부에서 재로드 트리거
}

export default function SettlementSection({ orderId, orderCurrency, orderStatus, refreshSignal }: Props) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [showAmendmentHistory, setShowAmendmentHistory] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [editingPayment, setEditingPayment] = useState<any>(null);
  // v1.6 (2026-05-14): 송금 요청 모달
  const [showRequestModal, setShowRequestModal] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await procurementApi.getSettlement(orderId);
      setData(result);
    } catch (e: any) {
      console.error("[Settlement] load failed:", e);
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => { load(); }, [load, refreshSignal]);

  if (loading) {
    return <div className="bg-white rounded-lg border p-6 mb-4 text-sm text-gray-400">송금상태 로드 중...</div>;
  }

  const invoice = data?.invoice;
  const payments = data?.payments || [];
  const summary = data?.summary || { invoicedAmount: 0, totalPaid: 0, outstanding: 0, fullyPaid: false };
  const displayCurrency = summary.currency || invoice?.currency || orderCurrency;
  const editable = !["CLOSED"].includes(orderStatus);

  return (
    <div className="bg-white rounded-lg border p-6 mb-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-medium">송금상태</h3>
        <div className="text-xs text-gray-400">발주: {orderStatus}</div>
      </div>

      {/* Invoice 영역 */}
      <div className="border-b pb-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-medium text-gray-700">Invoice</h4>
          {editable && (
            <button
              onClick={() => setShowInvoiceModal(true)}
              className="text-xs text-blue-600 hover:underline"
            >
              {invoice ? "편집" : "+ Invoice 등록"}
            </button>
          )}
        </div>
        {invoice ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
            <div>
              <div className="text-gray-500 text-xs">Invoice No.</div>
              <div className="font-mono">{invoice.invoiceNumber}</div>
            </div>
            <div>
              <div className="text-gray-500 text-xs">발행일</div>
              <div>{fmtDate(invoice.invoiceDate)}</div>
            </div>
            <div>
              <div className="text-gray-500 text-xs">금액</div>
              <div className="font-mono font-medium">
                {fmtAmount(invoice.amount, invoice.currency)}
                {Number(invoice.amount) !== Number(invoice.initialAmount) && (
                  <span className="ml-1 text-xs text-gray-400">
                    (최초 {fmtAmount(invoice.initialAmount, invoice.currency)})
                  </span>
                )}
              </div>
            </div>
            <div>
              <div className="text-gray-500 text-xs">결제기한 / 방식</div>
              <div>{fmtDate(invoice.dueDate)} {invoice.paymentTerms && `· ${invoice.paymentTerms}`}</div>
            </div>
            {invoice.notes && (
              <div className="col-span-full">
                <div className="text-gray-500 text-xs">비고</div>
                <div className="text-sm whitespace-pre-wrap">{invoice.notes}</div>
              </div>
            )}
            {/* 수정 이력 */}
            {invoice.amendments && invoice.amendments.length > 0 && (
              <div className="col-span-full mt-2">
                <button
                  onClick={() => setShowAmendmentHistory((v) => !v)}
                  className="text-xs text-blue-600 hover:underline"
                >
                  수정 이력 {invoice.amendments.length}건 {showAmendmentHistory ? "▲ 접기" : "▼ 펼치기"}
                </button>
                {showAmendmentHistory && (
                  <div className="mt-2 bg-gray-50 rounded p-3 space-y-1 text-xs">
                    {invoice.amendments.map((a: any) => (
                      <div key={a.id} className="flex items-center gap-3">
                        <span className="text-gray-400">{fmtDate(a.createdAt)}</span>
                        <span className="font-mono">
                          {fmtAmount(a.previousAmount, invoice.currency)} → {fmtAmount(a.newAmount, invoice.currency)}
                        </span>
                        <span className="px-1.5 py-0.5 bg-white border rounded">{a.reason}</span>
                        {a.description && <span className="text-gray-600">— {a.description}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-400">Invoice가 아직 등록되지 않았습니다.</p>
        )}
      </div>

      {/* 송금 영역 — v1.6 (2026-05-14) status별 표시. 등록은 헤더의 [송금 요청]에서만 */}
      <div className="border-b pb-4 mb-4">
        <h4 className="text-sm font-medium text-gray-700 mb-2">송금 내역 ({payments.length}건)</h4>
        {payments.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500 border-b">
              <tr>
                <th className="text-left py-1.5">상태</th>
                <th className="text-left py-1.5">송금일</th>
                <th className="text-right py-1.5">금액</th>
                <th className="text-left py-1.5 pl-3">방식</th>
                <th className="text-left py-1.5">참조</th>
                <th className="text-left py-1.5">비고</th>
                {editable && <th className="w-20"></th>}
              </tr>
            </thead>
            <tbody>
              {payments.map((p: any) => {
                const statusBadge =
                  p.status === "REQUESTED" ? <span className="px-1.5 py-0.5 text-[10px] rounded bg-amber-100 text-amber-700">요청중</span> :
                  p.status === "REJECTED" ? <span className="px-1.5 py-0.5 text-[10px] rounded bg-red-100 text-red-700">반려</span> :
                  <span className="px-1.5 py-0.5 text-[10px] rounded bg-green-100 text-green-700">완료</span>;
                return (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="py-1.5">{statusBadge}</td>
                    <td className="py-1.5">{p.paymentDate ? fmtDate(p.paymentDate) : "-"}</td>
                    <td className="py-1.5 text-right font-mono">{fmtAmount(p.amount, p.currency)}</td>
                    <td className="py-1.5 pl-3">{p.paymentMethod || "-"}</td>
                    <td className="py-1.5 font-mono text-xs">{p.bankReference || "-"}</td>
                    <td className="py-1.5 text-gray-600 text-xs">
                      {p.status === "REJECTED" && p.rejectReason ? <span className="text-red-600">반려사유: {p.rejectReason}</span> : (p.notes || "")}
                    </td>
                    {editable && (
                      <td className="py-1.5 text-right">
                        {p.status === "REQUESTED" ? (
                          <button
                            onClick={async () => {
                              if (!confirm("이 송금 요청을 취소하시겠습니까?")) return;
                              try { await procurementApi.deletePayment(p.id); await load(); }
                              catch (e: any) { alert(e.message || "취소 실패"); }
                            }}
                            className="text-xs text-red-500 hover:underline"
                          >취소</button>
                        ) : p.status === "COMPLETED" ? (
                          <>
                            <button
                              onClick={() => { setEditingPayment(p); setShowPaymentModal(true); }}
                              className="text-xs text-blue-600 hover:underline mr-2"
                            >편집</button>
                            <button
                              onClick={async () => {
                                if (!confirm("이 송금 내역을 삭제하시겠습니까?")) return;
                                try { await procurementApi.deletePayment(p.id); await load(); }
                                catch (e: any) { alert(e.message || "삭제 실패"); }
                              }}
                              className="text-xs text-red-500 hover:underline"
                            >삭제</button>
                          </>
                        ) : null}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-gray-400">송금 내역이 없습니다.</p>
        )}
      </div>

      {/* 합계 */}
      <div className="grid grid-cols-4 gap-4 text-sm">
        <div>
          <div className="text-gray-500 text-xs">Invoice 합계</div>
          <div className="font-mono font-bold">{fmtAmount(summary.invoicedAmount, displayCurrency)}</div>
        </div>
        <div>
          <div className="text-gray-500 text-xs">송금 완료</div>
          <div className="font-mono font-bold text-blue-700">{fmtAmount(summary.totalPaid, displayCurrency)}</div>
        </div>
        <div>
          <div className="text-gray-500 text-xs">요청중</div>
          <div className="font-mono font-bold text-amber-700">{fmtAmount(summary.totalRequested || 0, displayCurrency)}</div>
        </div>
        <div>
          <div className="text-gray-500 text-xs">잔여</div>
          <div className={`font-mono font-bold ${summary.fullyPaid ? "text-green-700" : "text-amber-700"}`}>
            {fmtAmount(summary.outstanding, displayCurrency)}
            {summary.fullyPaid && <span className="ml-1 text-xs text-green-600">✓ 완납</span>}
          </div>
        </div>
      </div>

      {showInvoiceModal && (
        <InvoiceModal
          orderId={orderId}
          orderCurrency={orderCurrency}
          invoice={invoice}
          onClose={() => setShowInvoiceModal(false)}
          onSaved={async () => { setShowInvoiceModal(false); await load(); }}
        />
      )}

      {showPaymentModal && (
        <PaymentModal
          orderId={orderId}
          orderCurrency={orderCurrency}
          payment={editingPayment}
          onClose={() => setShowPaymentModal(false)}
          onSaved={async () => { setShowPaymentModal(false); setEditingPayment(null); await load(); }}
        />
      )}

      {showRequestModal && (
        <PaymentRequestModal
          orderId={orderId}
          orderCurrency={orderCurrency}
          defaultAmount={Number(summary.outstanding) > 0 ? Number(summary.outstanding) : Number(summary.invoicedAmount)}
          onClose={() => setShowRequestModal(false)}
          onSaved={async () => { setShowRequestModal(false); await load(); }}
        />
      )}
    </div>
  );
}

// ─── 송금 요청 모달 (v1.6, 2026-05-14) — 헤더 버튼에서도 재사용 ─────────────
export function PaymentRequestModal({
  orderId,
  orderCurrency,
  defaultAmount,
  onClose,
  onSaved,
}: {
  orderId: string;
  orderCurrency: string;
  defaultAmount: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    amount: defaultAmount > 0 ? String(defaultAmount) : "",
    currency: orderCurrency,
    paymentMethod: "T/T",
    notes: "",
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!form.amount) {
      alert("금액은 필수입니다.");
      return;
    }
    setSaving(true);
    try {
      const payload: any = {
        amount: Number(form.amount),
        currency: form.currency,
        paymentMethod: form.paymentMethod,
      };
      if (form.notes) payload.notes = form.notes;
      await procurementApi.requestPayment(orderId, payload);
      onSaved();
    } catch (e: any) {
      alert(e.message || "송금 요청 실패");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold mb-2">송금 요청</h3>
        <p className="text-xs text-gray-500 mb-4">재무 접수 &gt; 발주송금 탭에서 처리됩니다.</p>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">금액 *</label>
              <input type="number" step="0.01" min={0} value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm text-right font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">통화</label>
              <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm">
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
                <option value="USD">USD</option>
                <option value="KRW">KRW</option>
              </select>
            </div>
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
            <label className="block text-sm text-gray-600 mb-1">비고 / 재무팀 메모</label>
            <textarea value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
              placeholder="긴급 / 환차 주의 등"
              className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">취소</button>
          <button onClick={handleSubmit} disabled={saving}
            className="px-4 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50">
            {saving ? "요청 중..." : "송금 요청"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Invoice 모달 ─────────────────────────────────────────────────────

function InvoiceModal({
  orderId,
  orderCurrency,
  invoice,
  onClose,
  onSaved,
}: {
  orderId: string;
  orderCurrency: string;
  invoice: any | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!invoice;
  const [form, setForm] = useState({
    invoiceNumber: invoice?.invoiceNumber || "",
    invoiceDate: invoice?.invoiceDate ? invoice.invoiceDate.slice(0, 10) : "",
    amount: invoice?.amount ? String(invoice.amount) : "",
    currency: invoice?.currency || orderCurrency,
    amountKRW: invoice?.amountKRW ? String(invoice.amountKRW) : "",
    dueDate: invoice?.dueDate ? invoice.dueDate.slice(0, 10) : "",
    paymentTerms: invoice?.paymentTerms || "",
    notes: invoice?.notes || "",
    amendReason: "",
    amendDescription: "",
  });
  const [saving, setSaving] = useState(false);

  const previousAmount = invoice ? Number(invoice.amount) : 0;
  const newAmount = Number(form.amount) || 0;
  const amountChanged = isEdit && previousAmount !== newAmount;

  const handleSubmit = async () => {
    if (!form.invoiceNumber || !form.invoiceDate || !form.amount) {
      alert("Invoice No, 발행일, 금액은 필수입니다.");
      return;
    }
    if (isEdit && amountChanged && !form.amendReason) {
      alert("금액 변경 시 사유를 입력해주세요.");
      return;
    }
    setSaving(true);
    try {
      const payload: any = {
        invoiceNumber: form.invoiceNumber,
        invoiceDate: form.invoiceDate,
        amount: newAmount,
        currency: form.currency,
        amountKRW: form.amountKRW ? Number(form.amountKRW) : null,
        dueDate: form.dueDate || null,
        paymentTerms: form.paymentTerms || null,
        notes: form.notes || null,
      };
      if (isEdit) {
        if (amountChanged) {
          payload.amendReason = form.amendReason;
          payload.amendDescription = form.amendDescription || null;
        }
        await procurementApi.updateInvoice(orderId, payload);
      } else {
        // create 시 nullable 필드는 그냥 undefined로
        delete payload.amountKRW;
        delete payload.dueDate;
        delete payload.paymentTerms;
        delete payload.notes;
        if (form.amountKRW) payload.amountKRW = Number(form.amountKRW);
        if (form.dueDate) payload.dueDate = form.dueDate;
        if (form.paymentTerms) payload.paymentTerms = form.paymentTerms;
        if (form.notes) payload.notes = form.notes;
        await procurementApi.createInvoice(orderId, payload);
      }
      onSaved();
    } catch (e: any) {
      alert(e.message || "Invoice 저장 실패");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold mb-4">{isEdit ? "Invoice 수정" : "Invoice 등록"}</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Invoice No *</label>
            <input type="text" value={form.invoiceNumber}
              onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">발행일 *</label>
            <DateInput value={form.invoiceDate}
              onChange={(e) => setForm({ ...form, invoiceDate: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">금액 *</label>
            <input type="number" step="0.01" min={0} value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm text-right font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">통화</label>
            <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
              <option value="USD">USD</option>
              <option value="KRW">KRW</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">결제기한</label>
            <DateInput value={form.dueDate}
              onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">결제방식</label>
            <input type="text" value={form.paymentTerms}
              onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })}
              placeholder="T/T, L/C, 무역금융 등"
              className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="col-span-2">
            <label className="block text-sm text-gray-600 mb-1">비고</label>
            <textarea value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
              className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>

        {amountChanged && (
          <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-3">
            <div className="text-sm">
              <span className="text-amber-700 font-medium">⚠ 금액 변경 감지 — 수정 이력에 기록됩니다</span>
              <span className="ml-2 font-mono text-gray-600">{previousAmount.toLocaleString()} → {newAmount.toLocaleString()}</span>
            </div>
            <div>
              <label className="block text-xs text-gray-700 mb-1">사유 *</label>
              <select value={form.amendReason}
                onChange={(e) => setForm({ ...form, amendReason: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm">
                <option value="">선택...</option>
                <option value="네고">네고</option>
                <option value="추가비용">추가비용</option>
                <option value="환율조정">환율조정</option>
                <option value="할인">할인</option>
                <option value="기타">기타</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-700 mb-1">상세 사유 (선택)</label>
              <input type="text" value={form.amendDescription}
                onChange={(e) => setForm({ ...form, amendDescription: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">취소</button>
          <button onClick={handleSubmit} disabled={saving}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Payment 모달 ─────────────────────────────────────────────────────

function PaymentModal({
  orderId,
  orderCurrency,
  payment,
  onClose,
  onSaved,
}: {
  orderId: string;
  orderCurrency: string;
  payment: any | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!payment;
  const [form, setForm] = useState({
    paymentDate: payment?.paymentDate ? payment.paymentDate.slice(0, 10) : "",
    amount: payment?.amount ? String(payment.amount) : "",
    currency: payment?.currency || orderCurrency,
    amountKRW: payment?.amountKRW ? String(payment.amountKRW) : "",
    exchangeRate: payment?.exchangeRate ? String(payment.exchangeRate) : "",
    paymentMethod: payment?.paymentMethod || "T/T",
    bankReference: payment?.bankReference || "",
    notes: payment?.notes || "",
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!form.paymentDate || !form.amount) {
      alert("송금일과 금액은 필수입니다.");
      return;
    }
    setSaving(true);
    try {
      const payload: any = {
        paymentDate: form.paymentDate,
        amount: Number(form.amount),
        currency: form.currency,
      };
      if (form.amountKRW) payload.amountKRW = Number(form.amountKRW);
      if (form.exchangeRate) payload.exchangeRate = Number(form.exchangeRate);
      if (form.paymentMethod) payload.paymentMethod = form.paymentMethod;
      if (form.bankReference) payload.bankReference = form.bankReference;
      if (form.notes) payload.notes = form.notes;

      if (isEdit) {
        // update 시엔 null 명시 (필드 클리어)
        if (!form.amountKRW) payload.amountKRW = null;
        if (!form.exchangeRate) payload.exchangeRate = null;
        if (!form.bankReference) payload.bankReference = null;
        if (!form.notes) payload.notes = null;
        await procurementApi.updatePayment(payment.id, payload);
      } else {
        await procurementApi.createPayment(orderId, payload);
      }
      onSaved();
    } catch (e: any) {
      alert(e.message || "송금 내역 저장 실패");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold mb-4">{isEdit ? "송금 내역 수정" : "송금 추가"}</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">송금일 *</label>
            <DateInput value={form.paymentDate}
              onChange={(e) => setForm({ ...form, paymentDate: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">송금 방식</label>
            <select value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="T/T">T/T</option>
              <option value="L/C">L/C</option>
              <option value="무역금융">무역금융</option>
              <option value="기타">기타</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">금액 *</label>
            <input type="number" step="0.01" min={0} value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm text-right font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">통화</label>
            <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
              <option value="USD">USD</option>
              <option value="KRW">KRW</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">원화 환산 금액 (선택)</label>
            <input type="number" step="1" min={0} value={form.amountKRW}
              onChange={(e) => setForm({ ...form, amountKRW: e.target.value })}
              placeholder="0"
              className="w-full border rounded-lg px-3 py-2 text-sm text-right font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">환율 (선택)</label>
            <input type="number" step="0.0001" min={0} value={form.exchangeRate}
              onChange={(e) => setForm({ ...form, exchangeRate: e.target.value })}
              placeholder="0.0000"
              className="w-full border rounded-lg px-3 py-2 text-sm text-right font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
          </div>
          <div className="col-span-2">
            <label className="block text-sm text-gray-600 mb-1">송금 참조 번호</label>
            <input type="text" value={form.bankReference}
              onChange={(e) => setForm({ ...form, bankReference: e.target.value })}
              placeholder="은행 송금 reference 등"
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
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">취소</button>
          <button onClick={handleSubmit} disabled={saving}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}
