"use client";

import { useEffect, useState, useCallback } from "react";
import { useFillHeight } from "@/hooks/useFillHeight";
import Link from "next/link";
import { bundleShipmentApi, procurementApi, inventoryApi } from "@/lib/api";
import { fmtDate } from "@/lib/datetime";
import { DateInput } from "@/components/ui/DateInput";
import SearchableSelect from "@/components/SearchableSelect";
import SortableHeader from "@/components/SortableHeader";
import { useSortPreference } from "@/hooks/useSortPreference";
import { TableCard, Table, THead, Th, TBody, Tr, Td, TableEmpty } from "@/components/ui/Table";

// v1.6 B안 (2026-05-13): BOM 정의 탭 제거. 번들 정의는 /procurement/products에서 관리.
export default function BundlesPage() {
  return <ShipmentTab />;
}

// ─── 출고 이력 탭 ───────────────────────────────────────────
function ShipmentTab() {
  const [list, setList] = useState<any[]>([]);
  const { ref: tableBoxRef, maxHeight: tableMaxH } = useFillHeight();
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<any | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const { sortBy, sortOrder, handleSort, resetSort } = useSortPreference("bundles", "shippedAt", "desc");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await bundleShipmentApi.list({ limit: 100, sortBy, sortOrder });
      setList(res.items ?? []);
    } catch (e: any) { alert(e.message || "조회 실패"); }
    finally { setLoading(false); }
  }, [sortBy, sortOrder]);

  useEffect(() => { load(); }, [load]);

  const openDetail = async (id: string) => {
    try {
      const data = await bundleShipmentApi.getById(id);
      setDetail(data);
    } catch (e: any) { alert(e.message || "상세 실패"); }
  };

  return (
    <>
      <TableCard
        title="번들 출고"
        count={list.length}
        scrollRef={tableBoxRef}
        maxHeight={tableMaxH}
        actions={
          <>
            <Link href="/procurement/products?itemType=BUNDLE"
              className="text-xs text-amber-700 hover:underline dark:text-amber-300">
              📦 번들 마스터 관리 →
            </Link>
            {sortBy && (
              <button onClick={resetSort} title="정렬을 원래 순서로 되돌립니다"
                className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
                ↺ 정렬 초기화
              </button>
            )}
            <button onClick={() => setShowCreate(true)}
              className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              + 번들 출고
            </button>
          </>
        }
      >
        <Table fixed columnDividers>
          <colgroup>
            <col className="w-[16%]" />
            <col className="w-[18%]" />
            <col className="w-[20%]" />
            <col className="w-[12%]" />
            <col className="w-[8%]" />
            <col className="w-[8%]" />
            <col className="w-[18%]" />
          </colgroup>
          <THead>
            <SortableHeader sortKey="code" currentSort={sortBy} order={sortOrder} onSort={handleSort} align="center" className="px-3 py-3 font-medium">번들 코드</SortableHeader>
            <SortableHeader sortKey="customer" currentSort={sortBy} order={sortOrder} onSort={handleSort} align="center" className="px-3 py-3 font-medium">고객사</SortableHeader>
            <SortableHeader sortKey="parentMaster" currentSort={sortBy} order={sortOrder} onSort={handleSort} align="center" className="px-3 py-3 font-medium">BOM</SortableHeader>
            <SortableHeader sortKey="shippedAt" currentSort={sortBy} order={sortOrder} onSort={handleSort} align="center" className="px-3 py-3 font-medium">출고일</SortableHeader>
            <Th align="center">품목</Th>
            <Th align="center">자산</Th>
            <SortableHeader sortKey="warrantyUntil" currentSort={sortBy} order={sortOrder} onSort={handleSort} align="center" className="px-3 py-3 font-medium">보증만료</SortableHeader>
          </THead>
          <TBody>
            {loading ? (
              <TableEmpty colSpan={7}>로딩중...</TableEmpty>
            ) : list.length === 0 ? (
              <TableEmpty colSpan={7}>출고 이력 없음</TableEmpty>
            ) : list.map((b: any) => (
              <Tr key={b.id} onClick={() => openDetail(b.id)}>
                <Td strong mono align="left" truncate title={b.code}>{b.code}</Td>
                <Td dash truncate title={b.customer?.name || undefined}>{b.customer?.name}</Td>
                <Td dash truncate title={b.parentMaster?.name || undefined}>{b.parentMaster?.name}</Td>
                <Td align="center" mono>{fmtDate(b.shippedAt)}</Td>
                <Td align="center" mono>{b._count?.items ?? 0}</Td>
                <Td align="center" mono>{b._count?.customerAssets ?? 0}</Td>
                <Td align="center" mono dash>{b.warrantyUntil ? fmtDate(b.warrantyUntil) : undefined}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </TableCard>

      {detail && <ShipmentDetail detail={detail} onClose={() => setDetail(null)} />}
      {showCreate && <ShipmentCreate onClose={() => setShowCreate(false)} onSaved={() => { setShowCreate(false); load(); }} />}
    </>
  );
}

// ─── 출고 상세 모달 ───────────────────────────────────────────
function ShipmentDetail({ detail, onClose }: { detail: any; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold">번들 출고 {detail.code}</h3>
            <div className="text-xs text-gray-500 mt-1">
              {detail.customer?.name} · {fmtDate(detail.shippedAt)} · {detail.shipTo || ""}
            </div>
            {detail.warrantyUntil && (
              <div className="text-xs text-amber-600 mt-1 dark:text-amber-400">보증만료: {fmtDate(detail.warrantyUntil)}</div>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
        </div>

        <div className="mb-4">
          <div className="text-sm font-medium mb-2">출고 품목</div>
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-2 py-2 text-left">품명</th>
                  <th className="px-2 py-2 text-left">SKU</th>
                  <th className="px-2 py-2 text-center">수량</th>
                  <th className="px-2 py-2 text-center">슬롯</th>
                  <th className="px-2 py-2 text-left">재고 출처</th>
                  <th className="px-2 py-2 text-left">고객 자산</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(detail.items ?? []).map((it: any) => (
                  <tr key={it.id}>
                    <td className="px-2 py-1.5">{it.productMaster?.name || "-"}</td>
                    <td className="px-2 py-1.5 font-mono text-[10px]">{it.variant?.skuCode || "-"}</td>
                    <td className="px-2 py-1.5 text-center">{it.quantity}</td>
                    <td className="px-2 py-1.5 text-center">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] ${it.slotType === "MAIN" ? "bg-blue-50 text-blue-700 dark:text-blue-300" : "bg-gray-100 text-gray-600"}`}>
                        {it.slotType}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 font-mono text-[10px]">{it.inventoryItem?.inventoryNo || "-"}</td>
                    <td className="px-2 py-1.5 text-[10px]">
                      {it.customerAsset?.name || "-"}
                      {it.customerAsset?.serialNumber && <span className="text-gray-400"> ({it.customerAsset.serialNumber})</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {detail.customerAssets?.length > 0 && (
          <div>
            <div className="text-sm font-medium mb-2">생성된 고객 자산 ({detail.customerAssets.length}건)</div>
            <div className="grid grid-cols-2 gap-2">
              {detail.customerAssets.map((a: any) => (
                <div key={a.id} className="border rounded-lg p-2 text-xs bg-emerald-50 dark:bg-emerald-950">
                  <div className="font-medium">{a.name}</div>
                  <div className="text-gray-500 text-[10px]">SN: {a.serialNumber || "-"} · 역할: {a.bundleRole || "-"}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {detail.notes && (
          <div className="mt-4 p-2 bg-gray-50 rounded text-xs text-gray-600">{detail.notes}</div>
        )}

        <div className="flex justify-end mt-4">
          <button onClick={onClose} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">닫기</button>
        </div>
      </div>
    </div>
  );
}

// ─── 출고 생성 모달 (v1.6 B안 사전 조립, 2026-05-13) ───────────────
// 사전 조립된 번들 재고 (INV-...) 1건을 선택 → 1건 차감.
function ShipmentCreate({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [inventoryNoSearch, setInventoryNoSearch] = useState("");
  const [inv, setInv] = useState<any | null>(null);
  const [customerId, setCustomerId] = useState<string>("");
  const [customerName, setCustomerName] = useState<string>("");
  const [shippedAt, setShippedAt] = useState<string>(new Date().toISOString().slice(0, 10));
  const [shipTo, setShipTo] = useState("");
  const [warrantyUntil, setWarrantyUntil] = useState<string>("");
  const [totalPrice, setTotalPrice] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [locationId, setLocationId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [customerAssetName, setCustomerAssetName] = useState("");
  const [saving, setSaving] = useState(false);

  // 재고번호 검색 → InventoryItem 매칭 + 번들 마스터 검증
  const onSearchInv = async (no: string) => {
    setInventoryNoSearch(no);
    setInv(null);
    setLocationId("");
    if (no.match(/^INV-\d{4}-\d{4}$/)) {
      try {
        const found = await inventoryApi.getByNo(no);
        const detail = await inventoryApi.getById(found.id);
        if (detail.productMaster?.itemType !== "BUNDLE") {
          alert("이 재고는 번들 마스터가 아닙니다. (단일 품목은 일반 출고를 사용)");
          return;
        }
        if (detail.currentStatus !== "IN_STOCK") {
          alert(`재고 상태가 IN_STOCK이 아닙니다: ${detail.currentStatus}`);
          return;
        }
        setInv(detail);
        setLocationId(detail.locations?.[0]?.locationId || "");
        setCustomerAssetName(detail.productMaster?.name || "");
      } catch (e: any) { /* 매칭 실패 시 무시 */ }
    }
  };

  const handleSave = async () => {
    if (!inv) { alert("번들 재고를 지정하십시오 (재고번호 입력)."); return; }
    if (!customerId) { alert("고객사를 선택하십시오."); return; }
    setSaving(true);
    try {
      await bundleShipmentApi.create({
        inventoryItemId: inv.id,
        customerId,
        shippedAt,
        quantity,
        ...(locationId && { locationId }),
        ...(shipTo && { shipTo }),
        ...(warrantyUntil && { warrantyUntil }),
        ...(totalPrice && { totalPrice: Number(totalPrice) }),
        ...(notes && { notes }),
        ...(customerAssetName && { customerAssetName }),
      });
      onSaved();
    } catch (e: any) { alert(e.message || "생성 실패"); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold mb-1">번들 출고 생성</h3>
        <p className="text-xs text-gray-500 mb-4">사전 조립된 번들 재고(INV-...) 1건을 차감합니다. 조립이 안 된 번들은 [품목 관리] → [조립]에서 먼저 만드십시오.</p>

        <div className="border rounded-lg p-3 bg-emerald-50/30 mb-4 dark:bg-emerald-500/10">
          <label className="block text-xs text-gray-500 mb-1">번들 재고번호 *</label>
          <input type="text" value={inventoryNoSearch}
            onChange={e => onSearchInv(e.target.value)}
            placeholder="INV-YYMM-NNNN"
            className="w-full border rounded px-3 py-2 text-sm font-mono" />
          {inv && (
            <div className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">
              ✓ {inv.productMaster?.name} · 재고 {inv.quantity}건
              {inv.serialNumber && <span> · SN: <span className="font-mono">{inv.serialNumber}</span></span>}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">고객사 *</label>
            <SearchableSelect
              value={customerName}
              onChange={setCustomerName}
              onSelect={(item) => {
                if (item) { setCustomerId(item.id); setCustomerName(item.name); }
                else { setCustomerId(""); setCustomerName(""); }
              }}
              placeholder="고객사 검색..."
              loadOptions={async (q) => {
                const res = await fetch(`/api/v1/customers?search=${encodeURIComponent(q)}&limit=20`, { credentials: "include" }).then(r => r.json());
                return (res.items || []).map((c: any) => ({ id: c.id, name: c.name }));
              }}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">출고일 *</label>
            <DateInput value={shippedAt} onChange={e => setShippedAt(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">차감 수량</label>
            <input type="number" value={quantity}
              onChange={e => setQuantity(Number(e.target.value))}
              className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">차감 위치</label>
            <select value={locationId}
              onChange={e => setLocationId(e.target.value)}
              disabled={!inv}
              className="w-full border rounded-lg px-3 py-2 text-sm disabled:bg-gray-100">
              <option value="">자동</option>
              {inv?.locations?.map((l: any) => (
                <option key={l.id} value={l.locationId}>
                  {l.location?.name || l.locationId} ({l.quantity})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">납품처 (선택)</label>
            <input type="text" value={shipTo} onChange={e => setShipTo(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">보증만료일 (선택)</label>
            <DateInput value={warrantyUntil} onChange={e => setWarrantyUntil(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">총 가격 (선택)</label>
            <input type="number" value={totalPrice} onChange={e => setTotalPrice(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">고객 자산명 (INDIVIDUAL만)</label>
            <input type="text" value={customerAssetName} onChange={e => setCustomerAssetName(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="기본: 번들 마스터명" />
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">메모</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" rows={2} />
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">취소</button>
          <button onClick={handleSave} disabled={saving || !inv || !customerId}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300">
            {saving ? "처리 중..." : "출고 등록"}
          </button>
        </div>
      </div>
    </div>
  );
}
