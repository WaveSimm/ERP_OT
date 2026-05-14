"use client";

import { useEffect, useState, useCallback } from "react";
import { expenseFollowupApi } from "@/lib/api";
import SortableHeader, { SortOrder } from "@/components/SortableHeader";
import OrderPaymentRequestsTab from "@/components/procurement/OrderPaymentRequestsTab";

const STATUS_LABELS: Record<string, string> = {
  FINANCE_RECEIVED: "재무 접수",
  INVENTORY_DECIDED: "재고 판정",
  ARRIVED: "입고 완료",
  COMPLETED: "처리 완료",
};
const STATUS_COLORS: Record<string, string> = {
  FINANCE_RECEIVED: "bg-yellow-100 text-yellow-700",
  INVENTORY_DECIDED: "bg-blue-100 text-blue-700",
  ARRIVED: "bg-green-100 text-green-700",
  COMPLETED: "bg-gray-100 text-gray-600",
};

function fmtMoney(v: number | string | null | undefined) {
  if (v == null) return "-";
  return `₩${Number(v).toLocaleString()}`;
}

// v1.6 (2026-05-14): 재무 접수 sub-tab — 결재송금 / 발주송금
type SubTab = "approval" | "order";

export default function ExpensesPage() {
  const [subTab, setSubTab] = useState<SubTab>("approval");
  return (
    <div>
      <div className="flex gap-2 border-b border-gray-200 mb-4">
        <button
          onClick={() => setSubTab("approval")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            subTab === "approval" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >결재송금</button>
        <button
          onClick={() => setSubTab("order")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            subTab === "order" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >발주송금</button>
      </div>
      {subTab === "approval" ? <ExpenseApprovalTab /> : <OrderPaymentRequestsTab />}
    </div>
  );
}

function ExpenseApprovalTab() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [sortBy, setSortBy] = useState<string>("");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const handleSort = (k: string, o: SortOrder) => { setSortBy(k); setSortOrder(o); };
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [acting, setActing] = useState(false);
  const [checkedItems, setCheckedItems] = useState<number[]>([]);
  const [decisionNote, setDecisionNote] = useState("");

  // 송금 처리 입력 상태
  const [payDate, setPayDate] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [payNote, setPayNote] = useState("");

  // 입고 처리 상태 폐기 (v1.6, 2026-05-13): InboundRequest 큐로 이관

  // 영수증 미리보기 패널 (인라인 표시용)
  const [previewReceipt, setPreviewReceipt] = useState<{ id: string; name?: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await expenseFollowupApi.list({
        ...(statusFilter && { status: statusFilter }),
        ...(sortBy && { sortBy, sortOrder }),
      });
      setItems(Array.isArray(res) ? res : []);
    } catch { setItems([]); }
    finally { setLoading(false); }
  }, [statusFilter, sortBy, sortOrder]);

  useEffect(() => { load(); }, [load]);

  const openDetail = (item: any) => {
    setSelectedItem(item);
    setCheckedItems([]);
    setDecisionNote("");
    setPreviewReceipt(null);
    // 송금 처리 — 기존 값 복원, 없으면 오늘 날짜+결재 금액 기본
    if (item.paymentCompletedAt) {
      setPayDate(new Date(item.paymentCompletedAt).toISOString().slice(0, 10));
      setPayAmount(item.paymentAmount?.toString() ?? "");
      setPayNote(item.paymentNote ?? "");
    } else {
      setPayDate(new Date().toISOString().slice(0, 10));
      const ad = item.approvalDocument;
      setPayAmount((ad?.itemsTotal ?? ad?.amount ?? "").toString());
      setPayNote("");
    }
    // 입고 처리 입력 폐기 (v1.6, 2026-05-13): InboundRequest 큐로 이관
    // 기존 판정된 인덱스 복원
    if (item.notes) {
      try {
        const parsed = JSON.parse(item.notes);
        if (parsed.inventoryItemIndices) setCheckedItems(parsed.inventoryItemIndices);
      } catch {}
    }
    // 첫 번째 영수증 자동 프리뷰
    const items = getItemsData(item);
    const firstWithReceipt = items.find((row: any) => row.receiptId);
    if (firstWithReceipt) {
      setPreviewReceipt({ id: firstWithReceipt.receiptId, name: firstWithReceipt.evidence });
    }
  };

  // referenceType으로 송금 종류 판별
  const getPaymentType = (item: any): { label: string; color: string } => {
    const refType = item?.approvalDocument?.referenceType;
    if (refType === "EXPENSE_SETTLEMENT") {
      return { label: "개인경비 송금", color: "bg-purple-100 text-purple-700" };
    }
    return { label: "업체 송금", color: "bg-cyan-100 text-cyan-700" };
  };

  const handleMarkPayment = async () => {
    if (!selectedItem) return;
    if (!payDate) { alert("송금일을 입력하세요."); return; }
    setActing(true);
    try {
      await expenseFollowupApi.markPayment(selectedItem.id, {
        paidAt: payDate,
        ...(payAmount && { paidAmount: Number(payAmount) }),
        ...(payNote && { paidNote: payNote }),
      });
      load();
      setSelectedItem(null);
    } catch (e: any) { alert(e.message); }
    finally { setActing(false); }
  };

  const handleClearPayment = async () => {
    if (!selectedItem) return;
    if (!confirm("송금 처리를 해제하시겠습니까?")) return;
    setActing(true);
    try {
      await expenseFollowupApi.clearPayment(selectedItem.id);
      load();
      setSelectedItem(null);
    } catch (e: any) { alert(e.message); }
    finally { setActing(false); }
  };

  const getItemsData = (item: any): any[] => {
    const doc = item?.approvalDocument;
    if (!doc) return [];
    const data = doc.itemsData || doc.items_data;
    if (!data) return [];
    if (typeof data === "string") {
      try { return JSON.parse(data); } catch { return []; }
    }
    return Array.isArray(data) ? data : [];
  };

  const toggleItem = (idx: number) => {
    setCheckedItems((prev) =>
      prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]
    );
  };

  const toggleAll = (itemsData: any[]) => {
    if (checkedItems.length === itemsData.length) {
      setCheckedItems([]);
    } else {
      setCheckedItems(itemsData.map((_, i) => i));
    }
  };

  const handleDecide = async () => {
    if (!selectedItem) return;
    setActing(true);
    try {
      await expenseFollowupApi.decide(selectedItem.id, {
        isInventoryTarget: checkedItems.length > 0,
        inventoryItems: checkedItems.length > 0 ? checkedItems : undefined,
        note: decisionNote || undefined,
      });
      load();
      setSelectedItem(null);
    } catch (e: any) { alert(e.message); }
    finally { setActing(false); }
  };

  // handleConfirm 폐기 (v1.6, 2026-05-13):
  //   재고 판정 시 InboundRequest 자동 생성 → 자재 담당자가 입고 큐에서 receive 처리.

  const doc = selectedItem?.approvalDocument;
  const itemsData = selectedItem ? getItemsData(selectedItem) : [];

  return (
    <div>
      <div className="flex gap-2 mb-4">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm">
          <option value="">전체 상태</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">로딩 중...</div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          재무 접수 건이 없습니다.
          <p className="text-xs mt-2">지출결의서·개인정산 결재 승인 후 자동으로 등록됩니다.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">문서번호</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">제목</th>
                <th className="px-4 py-3 text-center font-medium text-gray-600">종류</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">상신자</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">총액</th>
                <SortableHeader sortKey="receivedAt" currentSort={sortBy} order={sortOrder} onSort={handleSort} align="center" className="px-4 py-3 text-center font-medium text-gray-600">접수일</SortableHeader>
                <SortableHeader sortKey="status" currentSort={sortBy} order={sortOrder} onSort={handleSort} align="center" className="px-4 py-3 text-center font-medium text-gray-600">상태</SortableHeader>
                <SortableHeader sortKey="paymentCompletedAt" currentSort={sortBy} order={sortOrder} onSort={handleSort} align="center" className="px-4 py-3 text-center font-medium text-gray-600">송금</SortableHeader>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((item: any) => {
                const ad = item.approvalDocument;
                const payType = getPaymentType(item);
                return (
                  <tr key={item.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => openDetail(item)}>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">
                      {ad?.documentNumber || ad?.document_number || "-"}
                    </td>
                    <td className="px-4 py-3 font-medium">{ad?.title || "-"}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded ${payType.color}`}>{payType.label}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{ad?.requesterName || ad?.requester_name || "-"}</td>
                    <td className="px-4 py-3 text-right">{fmtMoney(ad?.itemsTotal || ad?.items_total || ad?.amount)}</td>
                    <td className="px-4 py-3 text-center text-gray-500">
                      {item.receivedAt ? new Date(item.receivedAt).toLocaleDateString("ko-KR") : "-"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs px-2 py-1 rounded ${STATUS_COLORS[item.status]}`}>
                        {STATUS_LABELS[item.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {item.paymentCompletedAt
                        ? <span className="text-xs text-emerald-600 font-medium">✓ {new Date(item.paymentCompletedAt).toLocaleDateString("ko-KR")}</span>
                        : <span className="text-xs text-gray-400">미처리</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 상세/액션 모달 — 좌: 정보·액션, 우: 영수증 미리보기 */}
      {selectedItem && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setSelectedItem(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl mx-4 h-[90vh] flex" onClick={(e) => e.stopPropagation()}>
            {/* 좌측 패널: 정보 + 액션 */}
            <div className="flex-1 min-w-0 overflow-y-auto">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between z-10">
              <h3 className="text-lg font-bold">후속처리 상세</h3>
              <button onClick={() => setSelectedItem(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>

            <div className="px-6 py-4 space-y-5">
              {/* 문서 기본정보 */}
              <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">문서번호</span>
                  <span className="font-mono text-xs">{doc?.documentNumber || doc?.document_number || "-"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">제목</span>
                  <span className="font-medium">{doc?.title || "-"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">상신자</span>
                  <span>{doc?.requesterName || doc?.requester_name || "-"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">총액</span>
                  <span className="font-semibold text-blue-700">{fmtMoney(doc?.itemsTotal || doc?.items_total || doc?.amount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">처리상태</span>
                  <span className={`text-xs px-2 py-0.5 rounded ${STATUS_COLORS[selectedItem.status]}`}>
                    {STATUS_LABELS[selectedItem.status]}
                  </span>
                </div>
              </div>

              {/* 내역 리스트 */}
              {itemsData.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-semibold text-gray-700">지출 내역 ({itemsData.length}건)</h4>
                    {selectedItem.status === "FINANCE_RECEIVED" && (
                      <button onClick={() => toggleAll(itemsData)}
                        className="text-xs text-blue-600 hover:underline">
                        {checkedItems.length === itemsData.length ? "전체 해제" : "전체 선택"}
                      </button>
                    )}
                  </div>
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 text-gray-600">
                        <tr>
                          {selectedItem.status === "FINANCE_RECEIVED" && (
                            <th className="px-3 py-2 text-center w-10">재고</th>
                          )}
                          <th className="px-3 py-2 text-left">품목</th>
                          <th className="px-3 py-2 text-center w-16">수량</th>
                          <th className="px-3 py-2 text-right w-24">단가</th>
                          <th className="px-3 py-2 text-right w-24">금액</th>
                          <th className="px-3 py-2 text-center w-16">영수증</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {itemsData.map((row: any, idx: number) => (
                          <tr key={idx} className={`${checkedItems.includes(idx) ? "bg-blue-50" : ""}`}>
                            {selectedItem.status === "FINANCE_RECEIVED" && (
                              <td className="px-3 py-2 text-center">
                                <input type="checkbox" checked={checkedItems.includes(idx)}
                                  onChange={() => toggleItem(idx)}
                                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                              </td>
                            )}
                            <td className="px-3 py-2">{row.description || row.name || "-"}</td>
                            <td className="px-3 py-2 text-center">{row.quantity || 1}</td>
                            <td className="px-3 py-2 text-right">{fmtMoney(row.unitPrice)}</td>
                            <td className="px-3 py-2 text-right font-medium">{fmtMoney(row.subtotal || (Number(row.unitPrice || 0) * Number(row.quantity || 1)))}</td>
                            <td className="px-3 py-2 text-center">
                              {row.receiptId ? (
                                <button
                                  onClick={(e) => { e.stopPropagation(); setPreviewReceipt({ id: row.receiptId, name: row.evidence }); }}
                                  title={row.evidence || "영수증 보기"}
                                  className={`hover:bg-blue-100 rounded px-1.5 ${previewReceipt?.id === row.receiptId ? "bg-blue-100" : ""}`}>
                                  <span className="text-blue-600">📎</span>
                                </button>
                              ) : row.evidence ? (
                                <span title={row.evidence} className="text-gray-400 text-xs">📄</span>
                              ) : (
                                <span className="text-gray-300 text-xs">-</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {selectedItem.status === "FINANCE_RECEIVED" && checkedItems.length > 0 && (
                    <p className="text-xs text-blue-600 mt-1">{checkedItems.length}건 재고 대상 선택됨</p>
                  )}
                </div>
              )}

              {/* 기존 판정 정보 */}
              {selectedItem.isInventoryTarget !== null && selectedItem.status !== "FINANCE_RECEIVED" && (
                <div className="bg-gray-50 rounded-lg p-4 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">재고 대상</span>
                    <span className={selectedItem.isInventoryTarget ? "text-blue-600 font-medium" : "text-gray-500"}>
                      {selectedItem.isInventoryTarget ? "예" : "아니오"}
                    </span>
                  </div>
                  {selectedItem.inventoryDecisionNote && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">메모</span>
                      <span>{selectedItem.inventoryDecisionNote}</span>
                    </div>
                  )}
                  {selectedItem.notes && (() => {
                    try {
                      const parsed = JSON.parse(selectedItem.notes);
                      if (parsed.inventoryItemIndices && itemsData.length > 0) {
                        const names = parsed.inventoryItemIndices.map((i: number) =>
                          itemsData[i]?.description || itemsData[i]?.name || `#${i + 1}`
                        );
                        return (
                          <div className="flex justify-between">
                            <span className="text-gray-500">재고 품목</span>
                            <span className="text-right">{names.join(", ")}</span>
                          </div>
                        );
                      }
                    } catch {}
                    return null;
                  })()}
                </div>
              )}

              {/* 재고 판정 (FINANCE_RECEIVED 상태) */}
              {selectedItem.status === "FINANCE_RECEIVED" && (
                <div className="space-y-3">
                  <div>
                    <label className="text-sm text-gray-600">판정 메모</label>
                    <input type="text" value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)}
                      placeholder="선택 사항" className="w-full border rounded px-3 py-2 text-sm mt-1" />
                  </div>
                  <div className="flex gap-2">
                    <button disabled={acting} onClick={handleDecide}
                      className="flex-1 px-3 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
                      {checkedItems.length > 0 ? `재고 대상 판정 (${checkedItems.length}건)` : "비재고 판정"}
                    </button>
                  </div>
                </div>
              )}

              {/* 입고 큐 안내 (재고 대상 + INVENTORY_DECIDED/ARRIVED) — v1.6 2026-05-13 */}
              {selectedItem.isInventoryTarget && ["INVENTORY_DECIDED", "ARRIVED"].includes(selectedItem.status) && (
                <div className="border-t pt-4">
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-amber-800 font-semibold text-sm">📦 입고 대기 중</span>
                    </div>
                    <p className="text-xs text-amber-700">
                      이 건은 자동으로 <a href="/procurement/inbound" className="underline font-medium">입고 큐</a>에 등록되었습니다.
                      자재 담당자가 큐에서 receive 처리하면 재고가 생성되고 본 항목도 자동으로 완료 처리됩니다.
                    </p>
                  </div>
                </div>
              )}

              {/* 입고 완료 표시 (COMPLETED) */}
              {selectedItem.isInventoryTarget && selectedItem.status === "COMPLETED" && (
                <div className="border-t pt-4">
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                    <div className="text-sm font-semibold text-emerald-800">✓ 입고 완료</div>
                    {selectedItem.inventoryItemId && (
                      <p className="text-xs text-emerald-700 mt-1">재고가 생성되었습니다.</p>
                    )}
                  </div>
                </div>
              )}

              {/* 송금 처리 — 입고와 독립, 항상 표시 */}
              <div className="border-t pt-4 mt-2">
                <div className="flex items-center gap-2 mb-3">
                  <h4 className="text-sm font-semibold text-gray-700">송금 처리</h4>
                  <span className={`text-xs px-2 py-0.5 rounded ${getPaymentType(selectedItem).color}`}>
                    {getPaymentType(selectedItem).label}
                  </span>
                  {selectedItem.paymentCompletedAt && (
                    <span className="text-xs text-emerald-600 ml-auto">✓ 송금 완료</span>
                  )}
                </div>
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-gray-500">송금일</label>
                      <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)}
                        className="w-full border rounded px-2 py-1.5 text-sm mt-0.5" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">송금 금액</label>
                      <input type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)}
                        placeholder="결재 금액과 다를 시 입력"
                        className="w-full border rounded px-2 py-1.5 text-sm mt-0.5 text-right" />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">메모/사유</label>
                    <input type="text" value={payNote} onChange={(e) => setPayNote(e.target.value)}
                      placeholder="계좌·참조·특이사항"
                      className="w-full border rounded px-2 py-1.5 text-sm mt-0.5" />
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button disabled={acting} onClick={handleMarkPayment}
                      className="flex-1 px-3 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
                      {selectedItem.paymentCompletedAt ? "송금 정보 업데이트" : "송금 완료 처리"}
                    </button>
                    {selectedItem.paymentCompletedAt && (
                      <button disabled={acting} onClick={handleClearPayment}
                        className="px-3 py-2 border border-red-300 text-red-600 rounded-lg text-sm disabled:opacity-50">
                        해제
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
            </div>

            {/* 우측 패널: 영수증 미리보기 */}
            <div className="w-[480px] border-l bg-gray-50 flex flex-col">
              <div className="px-4 py-3 border-b bg-white flex items-center justify-between">
                <h4 className="text-sm font-semibold text-gray-700">영수증</h4>
                {previewReceipt && (
                  <a href={`/api/v1/expense/receipts/${previewReceipt.id}/download`}
                    target="_blank" rel="noopener"
                    className="text-xs text-blue-600 hover:underline">새 창</a>
                )}
              </div>
              {previewReceipt ? (
                <div className="flex-1 overflow-hidden flex flex-col">
                  {(previewReceipt.name || "").toLowerCase().endsWith(".pdf") ? (
                    <iframe
                      src={`/api/v1/expense/receipts/${previewReceipt.id}/download`}
                      className="flex-1 w-full bg-white"
                      title={previewReceipt.name || "receipt"}
                    />
                  ) : (
                    <div className="flex-1 overflow-auto flex items-center justify-center bg-white p-2">
                      <img
                        src={`/api/v1/expense/receipts/${previewReceipt.id}/download`}
                        alt={previewReceipt.name || "receipt"}
                        className="max-w-full max-h-full object-contain"
                      />
                    </div>
                  )}
                  {previewReceipt.name && (
                    <div className="px-3 py-2 text-xs text-gray-500 border-t bg-white truncate" title={previewReceipt.name}>
                      📎 {previewReceipt.name}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
                  지출 내역의 영수증 아이콘을 클릭하세요
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
