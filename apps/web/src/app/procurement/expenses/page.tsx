"use client";

import { useEffect, useState, useCallback } from "react";
import { expenseFollowupApi } from "@/lib/api";

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

export default function ExpensesPage() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [acting, setActing] = useState(false);
  const [checkedItems, setCheckedItems] = useState<number[]>([]);
  const [decisionNote, setDecisionNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await expenseFollowupApi.list(statusFilter || undefined);
      setItems(Array.isArray(res) ? res : []);
    } catch { setItems([]); }
    finally { setLoading(false); }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const openDetail = (item: any) => {
    setSelectedItem(item);
    setCheckedItems([]);
    setDecisionNote("");
    // 기존 판정된 인덱스 복원
    if (item.notes) {
      try {
        const parsed = JSON.parse(item.notes);
        if (parsed.inventoryItemIndices) setCheckedItems(parsed.inventoryItemIndices);
      } catch {}
    }
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

  const handleConfirm = async (id: string) => {
    setActing(true);
    try {
      await expenseFollowupApi.confirmArrival(id, { arrivalDate: new Date().toISOString().slice(0, 10) });
      load();
      setSelectedItem(null);
    } catch (e: any) { alert(e.message); }
    finally { setActing(false); }
  };

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
          지출결의서 후속처리 건이 없습니다.
          <p className="text-xs mt-2">결재 승인 후 자동으로 등록됩니다.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">문서번호</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">제목</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">상신자</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">총액</th>
                <th className="px-4 py-3 text-center font-medium text-gray-600">접수일</th>
                <th className="px-4 py-3 text-center font-medium text-gray-600">상태</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((item: any) => {
                const ad = item.approvalDocument;
                return (
                  <tr key={item.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => openDetail(item)}>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">
                      {ad?.documentNumber || ad?.document_number || "-"}
                    </td>
                    <td className="px-4 py-3 font-medium">{ad?.title || "-"}</td>
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
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 상세/액션 모달 */}
      {selectedItem && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setSelectedItem(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            {/* 헤더 */}
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
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

              {/* 입고 확인 (INVENTORY_DECIDED 상태) */}
              {selectedItem.status === "INVENTORY_DECIDED" && selectedItem.isInventoryTarget && (
                <button disabled={acting} onClick={() => handleConfirm(selectedItem.id)}
                  className="w-full px-3 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
                  입고 확인
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
