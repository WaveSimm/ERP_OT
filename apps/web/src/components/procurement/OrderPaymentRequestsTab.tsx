"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { procurementApi } from "@/lib/api";
import { DateInput } from "@/components/ui/DateInput";
import { fmtDate, fmtDateTime24 } from "@/lib/datetime";
import SortableHeader, { SortOrder } from "@/components/SortableHeader";
import { TableCard, Table, THead, Th, TBody, Tr, Td, TableEmpty, RowButton } from "@/components/ui/Table";

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
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<string>("requestedAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const handleSort = (k: string, o: SortOrder) => { setSortBy(k); setSortOrder(o); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await procurementApi.listPaymentRequests(statusTab);
      setItems(Array.isArray(data) ? data : []);
    } catch { setItems([]); }
    finally { setLoading(false); }
  }, [statusTab]);

  useEffect(() => { load(); }, [load]);

  // 클라이언트 필터·정렬
  const displayItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = q
      ? items.filter((p) => {
          const hay = `${p.order?.orderNumber || ""} ${p.order?.manufacturer || ""} ${p.order?.customer || ""}`.toLowerCase();
          return hay.includes(q);
        })
      : items;
    const dir = sortOrder === "asc" ? 1 : -1;
    list = [...list].sort((a, b) => {
      let av: any, bv: any;
      switch (sortBy) {
        case "orderNumber": av = a.order?.orderNumber || ""; bv = b.order?.orderNumber || ""; break;
        case "manufacturer": av = a.order?.manufacturer || ""; bv = b.order?.manufacturer || ""; break;
        case "customer": av = a.order?.customer || ""; bv = b.order?.customer || ""; break;
        case "amount": av = Number(a.amount) || 0; bv = Number(b.amount) || 0; break;
        case "paymentDate": av = a.paymentDate || ""; bv = b.paymentDate || ""; break;
        case "requestedAt": av = a.requestedAt || ""; bv = b.requestedAt || ""; break;
        default: av = a[sortBy]; bv = b[sortBy];
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return list;
  }, [items, search, sortBy, sortOrder]);

  const counts = displayItems.length;

  return (
    <div>
      {/* status sub-tab + 검색 */}
      <div className="flex items-center gap-2 mb-4">
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
        <div className="ml-auto">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="발주번호·제조사·고객사 검색"
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-800 rounded-md w-64"
          />
        </div>
      </div>

      <TableCard>
        <Table fixed columnDividers>
          <colgroup>
            <col className="w-[12%]" />
            <col className="w-[14%]" />
            <col className="w-[14%]" />
            <col className="w-[8%]" />
            <col className="w-[14%]" />
            <col className="w-[13%]" />
            <col className="w-[15%]" />
            <col className="w-[10%]" />
          </colgroup>
          <THead>
            <SortableHeader sortKey="orderNumber" currentSort={sortBy} order={sortOrder} onSort={handleSort} align="center" className="px-4 py-3 font-medium">발주번호</SortableHeader>
            <SortableHeader sortKey="manufacturer" currentSort={sortBy} order={sortOrder} onSort={handleSort} align="center" className="px-4 py-3 font-medium">제조사</SortableHeader>
            <SortableHeader sortKey="customer" currentSort={sortBy} order={sortOrder} onSort={handleSort} align="center" className="px-4 py-3 font-medium">고객사</SortableHeader>
            <Th align="center">방식</Th>
            <SortableHeader sortKey="amount" currentSort={sortBy} order={sortOrder} onSort={handleSort} align="center" className="px-4 py-3 font-medium">금액</SortableHeader>
            <SortableHeader sortKey="requestedAt" currentSort={sortBy} order={sortOrder} onSort={handleSort} align="center" className="px-4 py-3 font-medium">요청일시</SortableHeader>
            <Th align="center">비고</Th>
            <Th align="center">관리</Th>
          </THead>
          <TBody>
            {loading ? (
              <TableEmpty colSpan={8}>로딩 중...</TableEmpty>
            ) : displayItems.length === 0 ? (
              <TableEmpty colSpan={8}>
                {search ? `'${search}' 검색 결과 없음` : (statusTab === "REQUESTED" ? "대기 중인 송금 요청이 없습니다." : "내역이 없습니다.")}
              </TableEmpty>
            ) : displayItems.map((p: any) => (
              <Tr key={p.id}>
                <Td strong mono align="left">
                  <a href={`/procurement/orders/${p.order?.id}`} className="hover:underline">{p.order?.orderNumber}</a>
                </Td>
                <Td dash truncate title={p.order?.manufacturer || undefined}>{p.order?.manufacturer}</Td>
                <Td dash truncate title={p.order?.customer || undefined}>{p.order?.customer}</Td>
                <Td dash align="center">{p.paymentMethod}</Td>
                <Td align="right" mono>{fmtAmount(p.amount, p.currency)}</Td>
                <Td align="center" mono>{fmtDateTime(p.requestedAt)}</Td>
                <Td truncate title={statusTab === "REJECTED" && p.rejectReason ? `반려: ${p.rejectReason}` : (p.notes || "")}>
                  {statusTab === "REJECTED" && p.rejectReason ? <span className="text-red-600 dark:text-red-400">반려: {p.rejectReason}</span> : (p.notes || "")}
                </Td>
                <Td align="center">
                  {statusTab === "REQUESTED" && (
                    <RowButton solid onClick={() => setSelected(p)}>처리</RowButton>
                  )}
                  {statusTab === "COMPLETED" && (
                    <RowButton onClick={() => setSelected({ ...p, _editMode: true })}>정정</RowButton>
                  )}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </TableCard>

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
  const isEditMode = !!payment._editMode;
  const [mode, setMode] = useState<"complete" | "reject">("complete");
  const [form, setForm] = useState({
    paymentDate: isEditMode && payment.paymentDate
      ? String(payment.paymentDate).slice(0, 10)
      : new Date().toISOString().slice(0, 10),
    amount: payment.amount ? String(payment.amount) : "",
    amountKRW: payment.amountKRW ? String(payment.amountKRW) : "",
    exchangeRate: payment.exchangeRate ? String(payment.exchangeRate) : "",
    paymentMethod: payment.paymentMethod || "T/T",
    bankReference: payment.bankReference || "",
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
    // 부분 결제 시 확인 (정정 모드에선 잔여 자동 생성 없음, skip)
    if (isPartial && !isEditMode) {
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
      if (isEditMode) {
        await procurementApi.updatePayment(payment.id, payload);
      } else {
        await procurementApi.completePaymentRequest(payment.id, payload);
      }
      onDone();
    } catch (e: any) {
      alert(e.message || (isEditMode ? "정정 실패" : "완료 처리 실패"));
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
        <h3 className="text-lg font-bold mb-1">{isEditMode ? "송금 내역 정정" : "송금 요청 처리"}</h3>
        <p className="text-xs text-gray-500 mb-4">
          발주: <a href={`/procurement/orders/${payment.order?.id}`} target="_blank" rel="noreferrer"
            className="text-blue-600 hover:underline font-mono dark:text-blue-400">{payment.order?.orderNumber}</a>
          {" · "}{payment.order?.manufacturer}
          {payment.order?.customer && ` · ${payment.order.customer}`}
        </p>

        {!isEditMode && (
          <div className="flex gap-2 mb-4">
            <button onClick={() => setMode("complete")}
              className={`px-3 py-1.5 text-sm rounded ${mode === "complete" ? "bg-green-600 text-white" : "bg-gray-100"}`}>완료 처리</button>
            <button onClick={() => setMode("reject")}
              className={`px-3 py-1.5 text-sm rounded ${mode === "reject" ? "bg-red-600 text-white" : "bg-gray-100"}`}>반려</button>
          </div>
        )}

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
                  isPartial ? "border-amber-400 bg-amber-50/30 dark:bg-amber-500/10" : ""
                }`} />
              {isPartial && (
                <div className="text-xs text-amber-700 mt-1 dark:text-amber-300">
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
                onChange={(e) => {
                  const rate = e.target.value;
                  const amt = Number(form.amount);
                  const newKRW = rate && amt > 0 ? String(Math.round(amt * Number(rate))) : form.amountKRW;
                  setForm({ ...form, exchangeRate: rate, amountKRW: newKRW });
                }}
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
              {saving ? "처리 중..." : (isEditMode ? "정정 저장" : "송금 완료")}
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
