"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { inboundRequestApi, supplierApi, procurementApi, inventoryApi, productVariantApi } from "@/lib/api";
import { fmtDateTime24 } from "@/lib/datetime";
import SearchableSelect from "@/components/SearchableSelect";
import SortableHeader from "@/components/SortableHeader";
import { useSortPreference } from "@/hooks/useSortPreference";

const STATUS_LABELS: Record<string, string> = {
  PENDING: "대기",
  RECEIVED: "입고완료",
  CANCELED: "취소",
};
const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-700",
  RECEIVED: "bg-green-100 text-green-700",
  CANCELED: "bg-gray-200 text-gray-500",
};
const SOURCE_LABELS: Record<string, string> = {
  OVERSEAS_ORDER: "해외발주",
  PURCHASE_ORDER: "국내발주",
  EXPENSE_FOLLOWUP: "지출결의",
  EXPENSE_SETTLEMENT: "경비정산",
  MANUAL: "수동",
};
const COMPLETENESS_LABELS: Record<string, string> = {
  AUTO_MATCHED: "자동매칭",
  PARTIAL: "부분",
  MANUAL_NEEDED: "수동필요",
};

interface ReceiveRow {
  inboundRequestItemId: string;
  productMasterId?: string;
  productMasterName?: string;
  variantId?: string;
  variantSku?: string;
  variantOptions?: any[];          // 선택된 master의 variants
  supplierId?: string;
  supplierName?: string;
  unitPrice?: string;
  quantity: number;
  locationId?: string;
  serialNumber?: string;
  notes?: string;
}

export default function InboundRequestPage() {
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("PENDING");
  const router = useRouter();
  const { sortBy, sortOrder, handleSort } = useSortPreference("inbound", "requestedAt", "desc");
  const [detail, setDetail] = useState<any | null>(null);
  const [receiveRows, setReceiveRows] = useState<ReceiveRow[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [showManualForm, setShowManualForm] = useState(false);
  const [saving, setSaving] = useState(false);

  // 수동 입고 폼
  const [manualForm, setManualForm] = useState({
    sourceDocNumber: "",
    notes: "",
    items: [{ itemNameRaw: "", description: "", quantity: 1, unitPrice: "" }],
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await inboundRequestApi.list({ status: statusFilter || undefined, limit: 100, sortBy, sortOrder });
      setList(Array.isArray(res) ? res : (res.items ?? []));
    } catch (e: any) { alert(e.message || "조회 실패"); }
    finally { setLoading(false); }
  }, [statusFilter, sortBy, sortOrder]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    inventoryApi.getLocations({ limit: 200 }).then(r => setLocations(r.items ?? []));
  }, []);

  const openDetail = async (id: string) => {
    try {
      const data = await inboundRequestApi.getById(id);
      setDetail(data);
      // PENDING이면 receive 폼 초기화
      if (data.status === "PENDING") {
        const rows: ReceiveRow[] = (data.items ?? []).map((it: any) => ({
          inboundRequestItemId: it.id,
          productMasterId: it.productMasterId ?? undefined,
          productMasterName: it.variant?.productMaster?.name,
          variantId: it.variantId ?? undefined,
          variantSku: it.variant?.skuCode,
          variantOptions: [],
          supplierId: it.supplierId ?? undefined,
          unitPrice: it.unitPrice ? String(it.unitPrice) : "",
          quantity: it.quantity,
          serialNumber: "",
          notes: it.description ?? "",
        }));
        setReceiveRows(rows);
        // 기존 productMasterId 있는 행은 variant 목록 미리 로드
        rows.forEach((r, idx) => {
          if (r.productMasterId) {
            productVariantApi.listByMaster(r.productMasterId, false)
              .then(opts => {
                setReceiveRows(curr => curr.map((cr, i) => i === idx ? { ...cr, variantOptions: opts } : cr));
              })
              .catch(() => {});
          }
        });
      }
    } catch (e: any) { alert(e.message || "상세 조회 실패"); }
  };

  // 마스터 선택시 variant 옵션 로드
  const onSelectMaster = async (idx: number, master: any | null) => {
    if (!master) {
      updateReceiveRow(idx, { productMasterId: undefined, productMasterName: undefined, variantId: undefined, variantSku: undefined, variantOptions: [] });
      return;
    }
    updateReceiveRow(idx, {
      productMasterId: master.id,
      productMasterName: master.name,
      variantId: undefined,
      variantSku: undefined,
      variantOptions: [],
    });
    try {
      const opts = await productVariantApi.listByMaster(master.id, false);
      setReceiveRows(curr => curr.map((cr, i) => i === idx ? { ...cr, variantOptions: opts } : cr));
    } catch {}
  };

  const updateReceiveRow = (idx: number, patch: Partial<ReceiveRow>) => {
    setReceiveRows(rows => rows.map((r, i) => i === idx ? { ...r, ...patch } : r));
  };

  const handleReceive = async () => {
    if (!detail) return;
    if (!confirm(`이 입고 요청을 처리하시겠습니까?\n${receiveRows.length}건의 InventoryItem이 생성됩니다.`)) return;
    setSaving(true);
    try {
      await inboundRequestApi.receive(detail.id, {
        receivedItems: receiveRows.map(r => ({
          inboundRequestItemId: r.inboundRequestItemId,
          ...(r.productMasterId && { productMasterId: r.productMasterId }),
          ...(r.variantId && { variantId: r.variantId }),
          ...(r.supplierId && { supplierId: r.supplierId }),
          ...(r.unitPrice && { unitPrice: Number(r.unitPrice) }),
          quantity: r.quantity,
          ...(r.locationId && { locationId: r.locationId }),
          ...(r.serialNumber && { serialNumber: r.serialNumber }),
          ...(r.notes && { notes: r.notes }),
        })),
      });
      alert("입고 처리 완료");
      setDetail(null);
      await load();
    } catch (e: any) { alert(e.message || "입고 처리 실패"); }
    finally { setSaving(false); }
  };

  const handleCancel = async () => {
    if (!detail) return;
    const reason = prompt("취소 사유 (선택):");
    if (reason === null) return;
    try {
      await inboundRequestApi.cancel(detail.id, reason);
      setDetail(null);
      await load();
    } catch (e: any) { alert(e.message || "취소 실패"); }
  };

  const handleCreateManual = async () => {
    if (manualForm.items.length === 0) { alert("최소 1개 품목 필요"); return; }
    setSaving(true);
    try {
      await inboundRequestApi.create({
        sourceType: "MANUAL",
        sourceDocNumber: manualForm.sourceDocNumber || undefined,
        notes: manualForm.notes || undefined,
        items: manualForm.items
          .filter(it => it.itemNameRaw || it.description)
          .map(it => ({
            itemNameRaw: it.itemNameRaw || undefined,
            description: it.description || undefined,
            quantity: it.quantity,
            unitPrice: it.unitPrice ? Number(it.unitPrice) : undefined,
            completenessFlag: "MANUAL_NEEDED",
          })),
      });
      setShowManualForm(false);
      setManualForm({ sourceDocNumber: "", notes: "", items: [{ itemNameRaw: "", description: "", quantity: 1, unitPrice: "" }] });
      await load();
    } catch (e: any) { alert(e.message || "생성 실패"); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-lg font-bold">입고 대기 큐</h2>
        <span className="text-sm text-gray-400">{list.length}건</span>

        <div className="ml-auto flex gap-2">
          {(["PENDING", "RECEIVED", "CANCELED", ""] as const).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 text-xs rounded-lg border ${
                statusFilter === s ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              {s ? STATUS_LABELS[s] : "전체"}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <SortableHeader sortKey="code" currentSort={sortBy} order={sortOrder} onSort={handleSort} className="px-3 py-2 text-left font-medium text-gray-600">코드</SortableHeader>
              <SortableHeader sortKey="status" currentSort={sortBy} order={sortOrder} onSort={handleSort} className="px-3 py-2 text-left font-medium text-gray-600">상태</SortableHeader>
              <SortableHeader sortKey="sourceType" currentSort={sortBy} order={sortOrder} onSort={handleSort} className="px-3 py-2 text-left font-medium text-gray-600">출처</SortableHeader>
              <SortableHeader sortKey="sourceDocNumber" currentSort={sortBy} order={sortOrder} onSort={handleSort} className="px-3 py-2 text-left font-medium text-gray-600">출처 문서</SortableHeader>
              <th className="px-3 py-2 text-right font-medium text-gray-600">수량</th>
              <th className="px-3 py-2 text-left font-medium text-gray-600">재고번호</th>
              <SortableHeader sortKey="requestedAt" currentSort={sortBy} order={sortOrder} onSort={handleSort} className="px-3 py-2 text-left font-medium text-gray-600">요청 시각</SortableHeader>
              <th className="px-3 py-2 text-left font-medium text-gray-600">메모</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">로딩중...</td></tr>
            ) : list.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">데이터 없음</td></tr>
            ) : list.map((r: any) => (
              <tr key={r.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => openDetail(r.id)}>
                <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
                <td className="px-3 py-2">
                  <span className={`px-2 py-0.5 rounded text-xs ${STATUS_COLORS[r.status]}`}>
                    {STATUS_LABELS[r.status]}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-gray-500">{SOURCE_LABELS[r.sourceType] || r.sourceType}</td>
                <td className="px-3 py-2 text-xs truncate max-w-[200px]" title={r.sourceDocNumber}>{r.sourceDocNumber || "-"}</td>
                <td className="px-3 py-2 text-right text-xs font-mono">{(r.items ?? []).reduce((s: number, i: any) => s + (i.quantity || 0), 0)}</td>
                <td className="px-3 py-2 text-xs">
                  {Array.isArray(r.inventoryItems) && r.inventoryItems.length > 0
                    ? r.inventoryItems.map((inv: any) => (
                        <a key={inv.id} href={`/procurement/inventory/${inv.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-block mr-1 mb-0.5 px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded font-mono text-[10px] hover:bg-blue-100">
                          {inv.inventoryNo}
                        </a>
                      ))
                    : <span className="text-gray-300">-</span>}
                </td>
                <td className="px-3 py-2 text-xs text-gray-500">{fmtDateTime24(r.requestedAt, { short: true })}</td>
                <td className="px-3 py-2 text-xs text-gray-500 truncate max-w-[300px]" title={r.notes}>{r.notes || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 상세 / receive 모달 */}
      {detail && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={() => setDetail(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold">입고 요청 {detail.code}</h3>
                <div className="text-xs text-gray-500 mt-1">
                  {SOURCE_LABELS[detail.sourceType]} · {detail.sourceDocNumber || "-"}
                  <span className={`ml-3 px-2 py-0.5 rounded ${STATUS_COLORS[detail.status]}`}>
                    {STATUS_LABELS[detail.status]}
                  </span>
                </div>
              </div>
              <button onClick={() => setDetail(null)} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
            </div>

            {detail.notes && (
              <div className="mb-3 p-2 bg-gray-50 rounded text-xs text-gray-600">{detail.notes}</div>
            )}

            {detail.status === "PENDING" ? (
              <div>
                <div className="text-sm font-medium mb-2">입고 처리 — 매칭 정보 보강 후 처리</div>

                <div className="space-y-3">
                  {receiveRows.map((r, idx) => {
                    const orig = detail.items[idx];
                    return (
                      <div key={r.inboundRequestItemId} className="border rounded-lg p-3 bg-gray-50">
                        {/* 원본 정보 */}
                        <div className="flex items-center justify-between mb-2 pb-2 border-b border-gray-200">
                          <div>
                            <div className="font-medium text-sm">{orig?.itemNameRaw || orig?.description || "-"}</div>
                            {orig?.description && orig?.itemNameRaw && (
                              <div className="text-[10px] text-gray-500">{orig.description}</div>
                            )}
                          </div>
                          <span className="text-[10px] px-2 py-0.5 rounded bg-gray-200 text-gray-600">
                            {COMPLETENESS_LABELS[orig?.completenessFlag] || ""}
                          </span>
                        </div>

                        {/* 매칭 정보 */}
                        <div className="grid grid-cols-3 gap-2 mb-2">
                          <div>
                            <label className="block text-[10px] text-gray-500 mb-0.5">품목</label>
                            <SearchableSelect
                              value={r.productMasterName || ""}
                              onChange={(v) => updateReceiveRow(idx, { productMasterName: v })}
                              onSelect={(item) => onSelectMaster(idx, item)}
                              placeholder="품목 검색 (한글·영문 모두 가능, 예: R500·USB·거치대)"
                              loadOptions={async (q) => {
                                const res = await procurementApi.getProducts({ search: q, limit: 20 });
                                return (res.items || []).map((p: any) => ({ id: p.id, name: p.name, sub: p.manufacturer }));
                              }}
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] text-gray-500 mb-0.5">Variant (옵션)</label>
                            <select
                              value={r.variantId || ""}
                              onChange={e => {
                                const v = (r.variantOptions || []).find((x: any) => x.id === e.target.value);
                                updateReceiveRow(idx, {
                                  variantId: e.target.value || undefined,
                                  variantSku: v?.skuCode || undefined,
                                });
                              }}
                              disabled={!r.productMasterId}
                              className="w-full border rounded px-2 py-1.5 text-xs disabled:bg-gray-100">
                              <option value="">{r.productMasterId ? "default 또는 선택" : "마스터 먼저 선택"}</option>
                              {(r.variantOptions || []).map((v: any) => (
                                <option key={v.id} value={v.id}>
                                  {v.skuCode || `Variant ${v.id.slice(0, 6)}`}
                                  {v.variantSpecs && Object.keys(v.variantSpecs).length > 0
                                    ? ` (${Object.entries(v.variantSpecs).map(([k, val]) => `${k}=${val}`).join(",")})`
                                    : ""}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-[10px] text-gray-500 mb-0.5">공급사</label>
                            <SearchableSelect
                              value={r.supplierName || ""}
                              onChange={(v) => updateReceiveRow(idx, { supplierName: v })}
                              onSelect={(item) => {
                                if (item) updateReceiveRow(idx, { supplierId: item.id, supplierName: item.name });
                                else updateReceiveRow(idx, { supplierId: undefined, supplierName: undefined });
                              }}
                              placeholder="공급사 검색..."
                              loadOptions={async (q) => {
                                const res = await supplierApi.list({ search: q, limit: 20 });
                                const arr = Array.isArray(res) ? res : (res.items ?? []);
                                return arr.map((s: any) => ({ id: s.id, name: s.name, sub: s.country || undefined }));
                              }}
                            />
                          </div>
                        </div>

                        {/* 입고 정보 */}
                        <div className="grid grid-cols-5 gap-2">
                          <div>
                            <label className="block text-[10px] text-gray-500 mb-0.5">단가</label>
                            <input type="number" value={r.unitPrice ?? ""}
                              onChange={e => updateReceiveRow(idx, { unitPrice: e.target.value })}
                              className="w-full border rounded px-2 py-1.5 text-xs" />
                          </div>
                          <div>
                            <label className="block text-[10px] text-gray-500 mb-0.5">수량</label>
                            <input type="number" value={r.quantity}
                              onChange={e => updateReceiveRow(idx, { quantity: Number(e.target.value) })}
                              className="w-full border rounded px-2 py-1.5 text-xs" />
                          </div>
                          <div>
                            <label className="block text-[10px] text-gray-500 mb-0.5">보관 위치</label>
                            <select value={r.locationId || ""}
                              onChange={e => updateReceiveRow(idx, { locationId: e.target.value || undefined })}
                              className="w-full border rounded px-2 py-1.5 text-xs">
                              <option value="">선택</option>
                              {locations.map((l: any) => (
                                <option key={l.id} value={l.id}>{l.name}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-[10px] text-gray-500 mb-0.5">시리얼 (개별)</label>
                            <input type="text" value={r.serialNumber || ""}
                              onChange={e => updateReceiveRow(idx, { serialNumber: e.target.value || undefined })}
                              placeholder="개별 추적시"
                              className="w-full border rounded px-2 py-1.5 text-xs" />
                          </div>
                          <div>
                            <label className="block text-[10px] text-gray-500 mb-0.5">메모</label>
                            <input type="text" value={r.notes || ""}
                              onChange={e => updateReceiveRow(idx, { notes: e.target.value })}
                              className="w-full border rounded px-2 py-1.5 text-xs" />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex justify-end gap-2 mt-4">
                  <button onClick={handleCancel} disabled={saving}
                    className="px-4 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50">
                    요청 취소
                  </button>
                  <button onClick={() => setDetail(null)}
                    className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">
                    닫기
                  </button>
                  <button onClick={handleReceive} disabled={saving}
                    className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300">
                    {saving ? "처리 중..." : "입고 처리"}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className="text-sm font-medium mb-2">처리 결과</div>
                <div className="border rounded-lg overflow-hidden mb-3">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="px-2 py-2 text-left">품명</th>
                        <th className="px-2 py-2 text-center">수량</th>
                        <th className="px-2 py-2 text-left">단가</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {(detail.items ?? []).map((it: any) => (
                        <tr key={it.id}>
                          <td className="px-2 py-1.5">{it.itemNameRaw || it.description || "-"}</td>
                          <td className="px-2 py-1.5 text-center">{it.quantity}</td>
                          <td className="px-2 py-1.5 font-mono">{it.unitPrice ? Number(it.unitPrice).toLocaleString() : "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {detail.inventoryItems?.length > 0 && (
                  <div>
                    <div className="text-sm font-medium mb-1">생성된 재고</div>
                    <div className="flex flex-wrap gap-1">
                      {detail.inventoryItems.map((inv: any) => (
                        <span key={inv.id} className="px-2 py-0.5 bg-green-50 text-green-700 rounded text-xs font-mono">
                          {inv.inventoryNo}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex justify-end mt-4">
                  <button onClick={() => setDetail(null)}
                    className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">닫기</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 수동 입고 폼 */}
      {showManualForm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={() => setShowManualForm(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">수동 입고 요청 생성</h3>

            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">참조 문서 번호 (선택)</label>
                <input type="text" value={manualForm.sourceDocNumber}
                  onChange={e => setManualForm({ ...manualForm, sourceDocNumber: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="예: 메모 #123" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">메모</label>
                <textarea value={manualForm.notes}
                  onChange={e => setManualForm({ ...manualForm, notes: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm" rows={2} />
              </div>
            </div>

            <div className="text-sm font-medium mb-2">품목</div>
            <div className="border rounded-lg overflow-hidden mb-3">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-2 py-2 text-left">품명</th>
                    <th className="px-2 py-2 text-left">설명</th>
                    <th className="px-2 py-2 text-left">수량</th>
                    <th className="px-2 py-2 text-left">단가</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {manualForm.items.map((it, idx) => (
                    <tr key={idx}>
                      <td className="px-2 py-1.5">
                        <input type="text" value={it.itemNameRaw}
                          onChange={e => {
                            const items = [...manualForm.items];
                            items[idx] = { ...items[idx]!, itemNameRaw: e.target.value };
                            setManualForm({ ...manualForm, items });
                          }}
                          className="w-full border rounded px-1 py-0.5 text-xs" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="text" value={it.description}
                          onChange={e => {
                            const items = [...manualForm.items];
                            items[idx] = { ...items[idx]!, description: e.target.value };
                            setManualForm({ ...manualForm, items });
                          }}
                          className="w-full border rounded px-1 py-0.5 text-xs" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="number" value={it.quantity}
                          onChange={e => {
                            const items = [...manualForm.items];
                            items[idx] = { ...items[idx]!, quantity: Number(e.target.value) };
                            setManualForm({ ...manualForm, items });
                          }}
                          className="w-20 border rounded px-1 py-0.5 text-xs" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="number" value={it.unitPrice}
                          onChange={e => {
                            const items = [...manualForm.items];
                            items[idx] = { ...items[idx]!, unitPrice: e.target.value };
                            setManualForm({ ...manualForm, items });
                          }}
                          className="w-24 border rounded px-1 py-0.5 text-xs" />
                      </td>
                      <td className="px-2 py-1.5">
                        <button onClick={() => {
                          const items = manualForm.items.filter((_, i) => i !== idx);
                          setManualForm({ ...manualForm, items: items.length > 0 ? items : [{ itemNameRaw: "", description: "", quantity: 1, unitPrice: "" }] });
                        }} className="text-red-500 text-xs">×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button onClick={() => setManualForm({ ...manualForm, items: [...manualForm.items, { itemNameRaw: "", description: "", quantity: 1, unitPrice: "" }] })}
              className="text-blue-600 text-xs hover:underline mb-3">+ 품목 추가</button>

            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowManualForm(false)} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">취소</button>
              <button onClick={handleCreateManual} disabled={saving}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300">
                {saving ? "저장 중..." : "생성"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
