"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { inventoryApi, procurementApi, supplierApi } from "@/lib/api";
import LocationSelect from "@/components/LocationSelect";
import SearchableSelect from "@/components/SearchableSelect";
import Pagination from "@/components/Pagination";

const STATUS_COLORS: Record<string, string> = {
  IN_STOCK: "bg-green-100 text-green-700",
  RELEASED: "bg-blue-100 text-blue-700",
  IN_REPAIR: "bg-orange-100 text-orange-700",
};
const STATUS_LABELS: Record<string, string> = {
  IN_STOCK: "재고",
  RELEASED: "출고",
  IN_REPAIR: "수리중",
};
const CATEGORY_LABELS: Record<string, string> = {
  IN_TRANSIT: "미착품",
  PRODUCT: "상품",
  RAW_MATERIAL: "원재료",
  PREV_PRODUCT: "전기상품",
  PREV_RAW_MATERIAL: "전기원재료",
};

export default function InventoryPage() {
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [filterOptions, setFilterOptions] = useState<{ locations: string[]; projects: string[]; assignees: string[] }>({ locations: [], projects: [], assignees: [] });
  const [stats, setStats] = useState<any>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [form, setForm] = useState({
    productMasterId: "", itemName: "", manufacturer: "", serialNumber: "",
    trackingMode: "INDIVIDUAL", quantity: "1", category: "PRODUCT",
    currentLocation: "", unitPrice: "",
    supplierId: "", supplierName: "",  // 2026-05-13: BULK 머지 조건
    projectName: "", assigneeName: "", notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [pmSearch, setPmSearch] = useState("");
  const [pmResults, setPmResults] = useState<any[]>([]);

  // 공급사 검색 (BULK 머지용)
  const [supSearch, setSupSearch] = useState("");
  const [supResults, setSupResults] = useState<any[]>([]);
  const [showSupDropdown, setShowSupDropdown] = useState(false);

  const searchSuppliers = async (q: string) => {
    setSupSearch(q);
    if (!q.trim()) { setSupResults([]); setShowSupDropdown(false); return; }
    try {
      const r = await supplierApi.list({ search: q, limit: 10 });
      const items = Array.isArray(r) ? r : (r.items ?? []);
      setSupResults(items);
      setShowSupDropdown(true);
    } catch { setSupResults([]); }
  };
  const selectSupplier = (s: any) => {
    setForm(f => ({ ...f, supplierId: s.id, supplierName: s.name }));
    setSupSearch(s.name);
    setShowSupDropdown(false);
  };
  const clearSupplier = () => {
    setForm(f => ({ ...f, supplierId: "", supplierName: "" }));
    setSupSearch("");
  };
  const [showPmDropdown, setShowPmDropdown] = useState(false);
  const pmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const PAGE_SIZE = 50;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await inventoryApi.list({ search, category: category || undefined, status: status || undefined, location: locationFilter || undefined, page, limit: PAGE_SIZE });
      setItems(res.items || []);
      setTotal(res.total || 0);
    } catch { setItems([]); }
    finally { setLoading(false); }
  }, [search, category, status, locationFilter, page]);

  // 필터 변경 시 첫 페이지로
  useEffect(() => { setPage(1); }, [search, category, status, locationFilter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { inventoryApi.getStats().then(setStats).catch(() => {}); }, []);
  useEffect(() => { inventoryApi.getFilterOptions().then(setFilterOptions).catch(() => {}); }, []);

  const searchProductMaster = (q: string) => {
    setPmSearch(q);
    if (pmTimer.current) clearTimeout(pmTimer.current);
    if (!q.trim()) { setPmResults([]); setShowPmDropdown(false); return; }
    pmTimer.current = setTimeout(async () => {
      try {
        const res = await procurementApi.getProducts({ search: q, limit: 10 });
        setPmResults(res.items || []);
        setShowPmDropdown(true);
      } catch { setPmResults([]); }
    }, 300);
  };

  const selectProductMaster = (pm: any) => {
    setForm(f => ({
      ...f,
      productMasterId: pm.id,
      itemName: pm.name,
      manufacturer: pm.manufacturer,
    }));
    setPmSearch(`${pm.name} (${pm.manufacturer})`);
    setShowPmDropdown(false);
  };

  const clearProductMaster = () => {
    setForm(f => ({ ...f, productMasterId: "", itemName: "", manufacturer: "" }));
    setPmSearch("");
    setPmResults([]);
  };

  const resetCreateForm = () => {
    setForm({
      productMasterId: "", itemName: "", manufacturer: "", serialNumber: "",
      trackingMode: "INDIVIDUAL", quantity: "1", category: "PRODUCT",
      currentLocation: "", unitPrice: "",
      supplierId: "", supplierName: "",
      projectName: "", assigneeName: "", notes: "",
    });
    setPmSearch("");
    setSupSearch("");
    setShowSupDropdown(false);
    setShowCreateModal(false);
  };

  const handleCreate = async () => {
    setSaving(true);
    try {
      const qty = form.trackingMode === "BULK" ? Number(form.quantity) || 1 : 1;
      const unitPrice = form.unitPrice ? Number(form.unitPrice) : undefined;
      const totalAmount = unitPrice ? unitPrice * qty : undefined;
      if (!form.productMasterId) { alert("장비마스터를 선택해주세요."); setSaving(false); return; }
      await inventoryApi.create({
        productMasterId: form.productMasterId,
        itemName: form.itemName || undefined,
        manufacturer: form.manufacturer || undefined,
        serialNumber: form.serialNumber || undefined,
        trackingMode: form.trackingMode,
        quantity: qty,
        category: form.category,
        currentLocation: form.currentLocation || undefined,
        unitPrice,
        supplyAmount: totalAmount,
        totalAmount,
        supplierId: form.supplierId || undefined,
        projectName: form.projectName || undefined,
        assigneeName: form.assigneeName || undefined,
        notes: form.notes || undefined,
      });
      resetCreateForm();
      load();
    } catch (e: any) { alert(e.message || "등록 실패"); }
    finally { setSaving(false); }
  };

  return (
    <div>
      {/* 통계 카드 */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg border p-4">
            <div className="text-xs text-gray-500">전체 재고</div>
            <div className="text-2xl font-bold">{stats.total}</div>
          </div>
          {(stats.byStatus || []).map((s: any) => (
            <div key={s.currentStatus} className="bg-white rounded-lg border p-4">
              <div className="text-xs text-gray-500">{STATUS_LABELS[s.currentStatus] || s.currentStatus}</div>
              <div className="text-2xl font-bold">{s._count}</div>
            </div>
          ))}
        </div>
      )}

      {/* 필터 */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="재고번호, 시리얼, 품명 검색..."
          className="border rounded-lg px-3 py-2 text-sm w-64"
        />
        <select value={category} onChange={(e) => setCategory(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm">
          <option value="">전체 분류</option>
          {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm">
          <option value="">전체 상태</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <SearchableSelect
          value={locationFilter} onChange={setLocationFilter} allowCustom
          placeholder="위치검색..."
          className="border rounded-lg px-3 py-2 text-sm w-40"
          loadOptions={async (q) => {
            const lq = q.toLowerCase();
            const all = [
              ...filterOptions.locations.map(v => ({ id: `loc:${v}`, name: v, sub: "창고" })),
              ...filterOptions.projects.map(v => ({ id: `prj:${v}`, name: v, sub: "고객사" })),
              ...filterOptions.assignees.map(v => ({ id: `asn:${v}`, name: v, sub: "사원" })),
            ];
            return lq ? all.filter(o => o.name.toLowerCase().includes(lq)) : all;
          }}
        />
        <div className="flex-1" />
        <button onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
          + 재고 등록
        </button>
      </div>

      {/* 테이블 */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">로딩 중...</div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-gray-400">재고가 없습니다.</div>
      ) : (
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left px-4 py-3 font-medium">재고번호</th>
                <th className="text-left px-4 py-3 font-medium">품명</th>
                <th className="text-left px-4 py-3 font-medium">시리얼</th>
                <th className="text-center px-4 py-3 font-medium">분류</th>
                <th className="text-center px-4 py-3 font-medium">상태</th>
                <th className="text-left px-4 py-3 font-medium">위치</th>
                <th className="text-right px-4 py-3 font-medium">TCO</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((item: any) => (
                <tr key={item.id} className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => router.push(`/procurement/inventory/${item.id}`)}>
                  <td className="px-4 py-3 font-mono text-xs">{item.inventoryNo}</td>
                  <td className="px-4 py-3 font-medium">{item.itemName || item.productMaster?.name || "-"}</td>
                  <td className="px-4 py-3 text-gray-500">{item.serialNumber || "-"}</td>
                  <td className="px-4 py-3 text-center">
                    <span className="text-xs px-2 py-0.5 rounded bg-gray-100">
                      {CATEGORY_LABELS[item.category] || item.category}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded ${STATUS_COLORS[item.currentStatus] || "bg-gray-100"}`}>
                      {STATUS_LABELS[item.currentStatus] || item.currentStatus}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{item.currentLocation || "-"}</td>
                  <td className="px-4 py-3 text-right">
                    {item.totalCostOfOwnership ? `₩${Number(item.totalCostOfOwnership).toLocaleString()}` : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={page} totalPages={Math.ceil(total / PAGE_SIZE)} onPageChange={setPage} total={total} />
        </div>
      )}

      {/* 등록 모달 */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={resetCreateForm}>
          <div className="bg-white rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">재고 수동 등록</h3>
            <div className="space-y-3">
              {/* 장비마스터 검색 (필수) */}
              <div className="relative">
                <label className="text-sm text-gray-600 mb-1 block">장비마스터 <span className="text-red-500">*</span></label>
                <div className="flex gap-2">
                  <input value={pmSearch} onChange={(e) => searchProductMaster(e.target.value)}
                    onFocus={() => pmResults.length > 0 && setShowPmDropdown(true)}
                    placeholder="품명 또는 제조사로 검색..."
                    className={`flex-1 border rounded px-3 py-2 text-sm ${form.productMasterId ? "bg-blue-50 border-blue-300" : ""}`}
                    readOnly={!!form.productMasterId} />
                  {form.productMasterId ? (
                    <button onClick={clearProductMaster} className="text-xs text-gray-400 hover:text-red-500 px-2 shrink-0">변경</button>
                  ) : null}
                </div>
                {showPmDropdown && pmResults.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {pmResults.map((pm: any) => (
                      <button key={pm.id} onClick={() => selectProductMaster(pm)}
                        className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm flex justify-between">
                        <span className="truncate">{pm.name}</span>
                        <span className="text-gray-400 text-xs ml-2 shrink-0">{pm.manufacturer}</span>
                      </button>
                    ))}
                  </div>
                )}
                {form.productMasterId && (
                  <div className="mt-1.5 flex gap-4 text-xs text-gray-500">
                    <span>품명: <span className="text-gray-700 font-medium">{form.itemName}</span></span>
                    <span>제조사: <span className="text-gray-700 font-medium">{form.manufacturer}</span></span>
                  </div>
                )}
              </div>

              {/* 시리얼 / 분류 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-gray-600 mb-1 block">시리얼번호</label>
                  <input value={form.serialNumber} onChange={(e) => setForm(f => ({ ...f, serialNumber: e.target.value }))}
                    className="w-full border rounded px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-sm text-gray-600 mb-1 block">분류</label>
                  <select value={form.category} onChange={(e) => setForm(f => ({ ...f, category: e.target.value }))}
                    className="w-full border rounded px-3 py-2 text-sm">
                    {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              </div>

              {/* 관리방식 / 수량 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-gray-600 mb-1 block">관리방식</label>
                  <select value={form.trackingMode} onChange={(e) => setForm(f => ({ ...f, trackingMode: e.target.value }))}
                    className="w-full border rounded px-3 py-2 text-sm">
                    <option value="INDIVIDUAL">개별</option>
                    <option value="BULK">벌크</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm text-gray-600 mb-1 block">수량</label>
                  <input type="number" min="1" value={form.quantity}
                    onChange={(e) => setForm(f => ({ ...f, quantity: e.target.value }))}
                    disabled={form.trackingMode === "INDIVIDUAL"}
                    className="w-full border rounded px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-400" />
                </div>
              </div>

              {/* 보관위치 */}
              <div>
                <label className="text-sm text-gray-600 mb-1 block">보관 위치</label>
                <LocationSelect
                  value={form.currentLocation}
                  onChange={(v) => setForm(f => ({ ...f, currentLocation: v }))}
                  className="py-2"
                />
              </div>

              {/* 단가 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-gray-600 mb-1 block">단가 (원)</label>
                  <input type="number" value={form.unitPrice} onChange={(e) => setForm(f => ({ ...f, unitPrice: e.target.value }))}
                    className="w-full border rounded px-3 py-2 text-sm" placeholder="0" />
                </div>
                <div className="flex items-end pb-2">
                  {form.unitPrice && Number(form.quantity) > 1 && (
                    <span className="text-xs text-gray-400">
                      총액: ₩{(Number(form.unitPrice) * (Number(form.quantity) || 1)).toLocaleString()}
                    </span>
                  )}
                </div>
              </div>

              {/* 공급사 — BULK 머지 조건 (마스터+단가+공급사 동일하면 수량 누적) */}
              <div className="relative">
                <label className="text-sm text-gray-600 mb-1 block">
                  공급사
                  {form.trackingMode === "BULK" && (
                    <span className="text-xs text-amber-600 ml-2">※ 같은 마스터+단가+공급사면 오늘 입고분에 수량 누적</span>
                  )}
                </label>
                <div className="flex gap-2">
                  <input value={supSearch} onChange={(e) => searchSuppliers(e.target.value)}
                    onFocus={() => supResults.length > 0 && setShowSupDropdown(true)}
                    placeholder="공급사명 검색..."
                    className={`flex-1 border rounded px-3 py-2 text-sm ${form.supplierId ? "bg-blue-50 border-blue-300" : ""}`}
                    readOnly={!!form.supplierId} />
                  {form.supplierId ? (
                    <button onClick={clearSupplier} className="text-xs text-gray-400 hover:text-red-500 px-2 shrink-0">변경</button>
                  ) : null}
                </div>
                {showSupDropdown && supResults.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {supResults.map((s: any) => (
                      <button key={s.id} onClick={() => selectSupplier(s)}
                        className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm flex justify-between">
                        <span className="truncate">{s.name}</span>
                        <span className="text-gray-400 text-xs ml-2 shrink-0">{s.country ?? ""}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* 프로젝트 / 담당자 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-gray-600 mb-1 block">프로젝트</label>
                  <input value={form.projectName} onChange={(e) => setForm(f => ({ ...f, projectName: e.target.value }))}
                    className="w-full border rounded px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-sm text-gray-600 mb-1 block">담당자</label>
                  <input value={form.assigneeName} onChange={(e) => setForm(f => ({ ...f, assigneeName: e.target.value }))}
                    className="w-full border rounded px-3 py-2 text-sm" />
                </div>
              </div>

              {/* 메모 */}
              <div>
                <label className="text-sm text-gray-600 mb-1 block">메모</label>
                <textarea value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full border rounded px-3 py-2 text-sm" rows={2} />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={resetCreateForm} className="px-4 py-2 border rounded-lg text-sm">취소</button>
              <button onClick={handleCreate} disabled={saving || !form.productMasterId}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50">등록</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
