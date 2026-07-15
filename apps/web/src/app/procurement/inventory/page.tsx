"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { inventoryApi, procurementApi, supplierApi } from "@/lib/api";
import LocationSelect from "@/components/LocationSelect";
import SearchableSelect from "@/components/SearchableSelect";
import SortableHeader from "@/components/SortableHeader";
import { useSortPreference } from "@/hooks/useSortPreference";
import Pagination from "@/components/Pagination";
import { useFillHeight } from "@/hooks/useFillHeight";
import { TableCard, Table, THead, Th, TBody, Tr, Td, TableEmpty, StatusBadge, type BadgeColor } from "@/components/ui/Table";

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
const STATUS_BADGE: Record<string, BadgeColor> = {
  IN_STOCK: "green",
  RELEASED: "blue",
  IN_REPAIR: "amber",
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
  // 표 박스가 화면 남은 높이를 채우게 실측 → 페이지 스크롤 없이 표 안에서만 스크롤
  const { ref: boxRef, maxHeight: boxMaxH } = useFillHeight();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const { sortBy, sortOrder, handleSort, resetSort } = useSortPreference("inventory", "", "desc");
  const [filterOptions, setFilterOptions] = useState<{ locations: string[]; projects: string[]; assignees: string[] }>({ locations: [], projects: [], assignees: [] });
  const [stats, setStats] = useState<any>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [form, setForm] = useState({
    productMasterId: "", itemName: "", manufacturer: "", serialNumber: "",
    trackingMode: "INDIVIDUAL", quantity: "1", category: "PRODUCT",
    currentLocation: "", unitPrice: "",
    supplierId: "", supplierName: "",  // 2026-05-13: BULK 머지 조건
    projectName: "", assigneeName: "", notes: "",
    itemType: "SIMPLE" as "SIMPLE" | "BUNDLE",  // v1.6 (2026-05-13): 선택된 마스터의 유형
  });
  // v1.6 (2026-05-13): 번들 조립용 구성품 상태 (마스터가 BUNDLE일 때만 사용)
  const [bundleComponents, setBundleComponents] = useState<any[]>([]);
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
      const res = await inventoryApi.list({ search, category: category || undefined, status: status || undefined, location: locationFilter || undefined, page, limit: PAGE_SIZE, ...(sortBy && { sortBy, sortOrder }) });
      setItems(res.items || []);
      setTotal(res.total || 0);
    } catch { setItems([]); }
    finally { setLoading(false); }
  }, [search, category, status, locationFilter, page, sortBy, sortOrder]);

  // 필터 변경 시 첫 페이지로
  useEffect(() => { setPage(1); }, [search, category, status, locationFilter]);

  // v1.6.1 (2026-05-15): URL ?create=1 시 자동 모달 오픈 (입고 큐 [+재고번호 생성] 진입)
  const searchParams = useSearchParams();
  useEffect(() => {
    if (searchParams.get("create") === "1") {
      setShowCreateModal(true);
      // URL 파라미터 정리 (재진입 시 다시 안 열리도록)
      router.replace("/procurement/inventory");
    }
  }, [searchParams, router]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { inventoryApi.getStats().then(setStats).catch(() => {}); }, []);
  useEffect(() => { inventoryApi.getFilterOptions().then(setFilterOptions).catch(() => {}); }, []);

  const searchProductMaster = (q: string) => {
    setPmSearch(q);
    if (pmTimer.current) clearTimeout(pmTimer.current);
    if (!q.trim()) { setPmResults([]); setShowPmDropdown(false); return; }
    pmTimer.current = setTimeout(async () => {
      try {
        // v1.6 B안: 번들도 함께 검색 가능하게 includeBundle=true
        const res = await procurementApi.getProducts({ search: q, includeBundle: true, limit: 10 });
        setPmResults(res.items || []);
        setShowPmDropdown(true);
      } catch { setPmResults([]); }
    }, 300);
  };

  const selectProductMaster = async (pm: any) => {
    setForm(f => ({
      ...f,
      productMasterId: pm.id,
      itemName: pm.name,
      manufacturer: pm.manufacturer,
      itemType: pm.itemType === "BUNDLE" ? "BUNDLE" : "SIMPLE",
    }));
    setPmSearch(`${pm.name} (${pm.manufacturer})`);
    setShowPmDropdown(false);

    // v1.6 B안: BUNDLE이면 구성품 자동 로드
    if (pm.itemType === "BUNDLE") {
      try {
        const items = await procurementApi.getBundleItems(pm.id);
        setBundleComponents((items || []).map((b: any) => ({
          bomItemId: b.id,
          productMasterId: b.productMasterId,
          productMasterName: b.productMaster?.name,
          slotType: b.slotType,
          requiredQty: b.quantity,
          inventoryItemId: "",
          inventoryNo: "",
          availableLocations: [] as any[],
          locationId: "",
          quantity: b.quantity,
        })));
      } catch (e: any) { alert(e.message || "구성품 조회 실패"); }
    } else {
      setBundleComponents([]);
    }
  };

  const clearProductMaster = () => {
    setForm(f => ({ ...f, productMasterId: "", itemName: "", manufacturer: "", itemType: "SIMPLE" }));
    setPmSearch("");
    setPmResults([]);
    setBundleComponents([]);
  };

  const updateBundleComponent = (idx: number, patch: any) => {
    setBundleComponents(rows => rows.map((r, i) => i === idx ? { ...r, ...patch } : r));
  };

  const resetCreateForm = () => {
    setForm({
      productMasterId: "", itemName: "", manufacturer: "", serialNumber: "",
      trackingMode: "INDIVIDUAL", quantity: "1", category: "PRODUCT",
      currentLocation: "", unitPrice: "",
      supplierId: "", supplierName: "",
      projectName: "", assigneeName: "", notes: "",
      itemType: "SIMPLE",
    });
    setBundleComponents([]);
    setPmSearch("");
    setSupSearch("");
    setShowSupDropdown(false);
    setShowCreateModal(false);
  };

  const handleCreate = async () => {
    setSaving(true);
    try {
      if (!form.productMasterId) { alert("품목을 선택해주세요."); setSaving(false); return; }

      // v1.6 B안 (2026-05-13): BUNDLE은 조립 API 호출 (구성품 차감 + 번들 InventoryItem 생성)
      if (form.itemType === "BUNDLE") {
        if (bundleComponents.length === 0) { alert("번들에 구성품이 정의되어 있지 않습니다."); setSaving(false); return; }
        if (bundleComponents.some((c: any) => !c.inventoryItemId)) {
          alert("모든 구성품의 재고를 지정해주세요."); setSaving(false); return;
        }
        const qty = form.trackingMode === "BULK" ? Number(form.quantity) || 1 : 1;
        const unitPrice = form.unitPrice ? Number(form.unitPrice) : undefined;
        // currentLocation 텍스트를 location 객체로 매핑 (선택사항)
        await procurementApi.assembleBundle(form.productMasterId, {
          components: bundleComponents.map((c: any) => ({
            inventoryItemId: c.inventoryItemId,
            ...(c.locationId && { locationId: c.locationId }),
            quantity: c.quantity,
          })),
          output: {
            quantity: qty,
            ...(unitPrice !== undefined && { unitPrice }),
            ...(form.serialNumber && { serialNumber: form.serialNumber }),
            ...(form.notes && { notes: form.notes }),
          },
        });
        resetCreateForm();
        load();
        return;
      }

      // SIMPLE 흐름 (기존)
      const qty = form.trackingMode === "BULK" ? Number(form.quantity) || 1 : 1;
      const unitPrice = form.unitPrice ? Number(form.unitPrice) : undefined;
      const totalAmount = unitPrice ? unitPrice * qty : undefined;
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

      {/* 필터 (제목 없는 표 — 컨트롤 스타일은 표준과 통일) */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select value={category} onChange={(e) => setCategory(e.target.value)}
          className="border border-gray-300 dark:border-gray-600 dark:bg-gray-800 rounded-lg px-3 py-1.5 text-sm">
          <option value="">전체 분류</option>
          {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}
          className="border border-gray-300 dark:border-gray-600 dark:bg-gray-800 rounded-lg px-3 py-1.5 text-sm">
          <option value="">전체 상태</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <SearchableSelect
          value={locationFilter} onChange={setLocationFilter} allowCustom
          placeholder="위치검색..."
          className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm w-40"
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
        <input
          value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="재고번호, 시리얼, 품명 검색..."
          className="border border-gray-300 dark:border-gray-600 dark:bg-gray-800 rounded-lg px-3 py-1.5 text-sm w-64"
        />
        {sortBy && (
          <button onClick={resetSort} title="정렬을 원래 순서로 되돌립니다"
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
            ↺ 정렬 초기화
          </button>
        )}
        <button onClick={() => setShowCreateModal(true)}
          className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
          + 재고번호 생성
        </button>
      </div>

      {/* 테이블 */}
      <TableCard
        scrollRef={boxRef}
        maxHeight={boxMaxH}
        footer={<Pagination page={page} totalPages={Math.ceil(total / PAGE_SIZE)} onPageChange={setPage} total={total} />}
      >
        <Table fixed columnDividers>
          <colgroup>
            <col className="w-[12%]" />
            <col className="w-[18%]" />
            <col className="w-[12%]" />
            <col className="w-[12%]" />
            <col className="w-[8%]" />
            <col className="w-[8%]" />
            <col className="w-[7%]" />
            <col className="w-[12%]" />
            <col className="w-[11%]" />
          </colgroup>
          <THead>
            <SortableHeader sortKey="inventoryNo" currentSort={sortBy} order={sortOrder} onSort={handleSort} align="center" className="px-4 py-3 font-medium">재고번호</SortableHeader>
            <SortableHeader sortKey="itemName" currentSort={sortBy} order={sortOrder} onSort={handleSort} align="center" className="px-4 py-3 font-medium">품명</SortableHeader>
            <SortableHeader sortKey="manufacturer" currentSort={sortBy} order={sortOrder} onSort={handleSort} align="center" className="px-4 py-3 font-medium">제조사</SortableHeader>
            <SortableHeader sortKey="serialNumber" currentSort={sortBy} order={sortOrder} onSort={handleSort} align="center" className="px-4 py-3 font-medium">시리얼</SortableHeader>
            <SortableHeader sortKey="category" currentSort={sortBy} order={sortOrder} onSort={handleSort} align="center" className="px-4 py-3 font-medium">분류</SortableHeader>
            <SortableHeader sortKey="currentStatus" currentSort={sortBy} order={sortOrder} onSort={handleSort} align="center" className="px-4 py-3 font-medium">상태</SortableHeader>
            <SortableHeader sortKey="quantity" currentSort={sortBy} order={sortOrder} onSort={handleSort} align="center" className="px-4 py-3 font-medium">수량</SortableHeader>
            <SortableHeader sortKey="currentLocation" currentSort={sortBy} order={sortOrder} onSort={handleSort} align="center" className="px-4 py-3 font-medium">위치</SortableHeader>
            <SortableHeader sortKey="totalCostOfOwnership" currentSort={sortBy} order={sortOrder} onSort={handleSort} align="center" className="px-4 py-3 font-medium">TCO</SortableHeader>
          </THead>
          <TBody>
            {loading ? (
              <TableEmpty colSpan={9}>로딩 중...</TableEmpty>
            ) : items.length === 0 ? (
              <TableEmpty colSpan={9}>재고가 없습니다.</TableEmpty>
            ) : items.map((item: any) => (
              <Tr key={item.id} onClick={() => router.push(`/procurement/inventory/${item.id}`)}>
                <Td mono align="left" truncate title={item.inventoryNo}>{item.inventoryNo}</Td>
                <Td strong truncate title={item.itemName || item.productMaster?.name || ""}>{item.itemName || item.productMaster?.name || "-"}</Td>
                <Td dash truncate title={item.manufacturer || item.productMaster?.manufacturer || undefined}>{item.manufacturer || item.productMaster?.manufacturer}</Td>
                <Td dash mono truncate title={item.serialNumber || undefined}>{item.serialNumber}</Td>
                <Td align="center"><StatusBadge color="gray">{CATEGORY_LABELS[item.category] || item.category}</StatusBadge></Td>
                <Td align="center"><StatusBadge color={STATUS_BADGE[item.currentStatus] || "gray"}>{STATUS_LABELS[item.currentStatus] || item.currentStatus}</StatusBadge></Td>
                <Td align="right" mono dash>{item.quantity}</Td>
                <Td dash truncate title={item.currentLocation || undefined}>{item.currentLocation}</Td>
                <Td align="right" mono dash>{item.totalCostOfOwnership ? `₩${Number(item.totalCostOfOwnership).toLocaleString()}` : undefined}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </TableCard>

      {/* 등록 모달 */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={resetCreateForm}>
          <div className="bg-white rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">재고번호 생성</h3>
            <div className="space-y-3">
              {/* 품목 검색 (필수) */}
              <div className="relative">
                <label className="text-sm text-gray-600 mb-1 block">품목 <span className="text-red-500 dark:text-red-400">*</span></label>
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
                  <div className="absolute z-[60] mt-1 w-full bg-white border rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {pmResults.map((pm: any) => (
                      <button key={pm.id} onClick={() => selectProductMaster(pm)}
                        className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm border-b last:border-b-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium truncate">{pm.name}</span>
                          {pm.itemType === "BUNDLE" && (
                            <span className="px-1.5 py-0.5 text-[10px] rounded bg-amber-100 text-amber-700 shrink-0">📦</span>
                          )}
                        </div>
                        <div className="text-[10px] text-gray-500 mt-0.5">
                          {pm.manufacturer || ""}
                          {pm.stockSummary && (
                            <span className={`ml-2 ${pm.stockSummary.items > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-gray-400"}`}>
                              {pm.stockSummary.items > 0
                                ? `재고 ${pm.stockSummary.items}건·${pm.stockSummary.quantity}개`
                                : "재고 없음"}
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {form.productMasterId && (
                  <div className="mt-1.5 flex gap-4 text-xs text-gray-500">
                    <span>품명: <span className="text-gray-700 font-medium">{form.itemName}</span></span>
                    <span>제조사: <span className="text-gray-700 font-medium">{form.manufacturer}</span></span>
                    {form.itemType === "BUNDLE" && (
                      <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">📦 번들 (조립 입고)</span>
                    )}
                  </div>
                )}
              </div>

              {/* v1.6 B안 (2026-05-13): BUNDLE이면 구성품 매칭 섹션 */}
              {form.itemType === "BUNDLE" && form.productMasterId && (
                <div className="border-2 border-amber-200 rounded-lg p-3 bg-amber-50/30 dark:bg-amber-500/10 dark:border-amber-900">
                  <div className="text-sm font-medium text-amber-800 mb-2">📦 번들 조립 — 구성품 재고 지정</div>
                  {bundleComponents.length === 0 ? (
                    <div className="text-xs text-gray-400 py-3 text-center">
                      구성품이 정의되지 않았습니다. <a href="/procurement/products?itemType=BUNDLE" className="text-amber-700 underline dark:text-amber-300">[품목 관리]</a>의 [구성품] 버튼으로 먼저 등록하십시오.
                    </div>
                  ) : (
                    <div className="border rounded bg-white overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 border-b">
                          <tr>
                            <th className="px-2 py-1.5 text-left">구성품</th>
                            <th className="px-2 py-1.5 text-center">필요</th>
                            <th className="px-2 py-1.5 text-left">모델명</th>
                            <th className="px-2 py-1.5 text-left">재고번호 (검색)</th>
                            <th className="px-2 py-1.5 text-center">차감</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {bundleComponents.map((c: any, idx: number) => (
                            <tr key={c.bomItemId}>
                              <td className="px-2 py-1.5">
                                <div>{c.productMasterName}</div>
                                <div className="text-[10px] text-gray-400">
                                  <span className={`px-1 py-0.5 rounded ${c.slotType === "MAIN" ? "bg-blue-50 text-blue-700 dark:text-blue-300" : "bg-gray-100 text-gray-600"}`}>
                                    {c.slotType}
                                  </span>
                                </div>
                              </td>
                              <td className="px-2 py-1.5 text-center text-gray-500">{c.requiredQty}</td>
                              <td className="px-2 py-1.5">
                                <SearchableSelect
                                  value={c.inventoryNo || ""}
                                  onChange={(v) => updateBundleComponent(idx, { inventoryNo: v })}
                                  onSelect={async (item) => {
                                    if (!item) {
                                      updateBundleComponent(idx, { inventoryItemId: "", inventoryNo: "", availableLocations: [], locationId: "", locationName: "" });
                                      return;
                                    }
                                    try {
                                      const detail = await inventoryApi.getById(item.id);
                                      const loc = detail.locations?.[0];
                                      updateBundleComponent(idx, {
                                        inventoryItemId: detail.id,
                                        inventoryNo: detail.inventoryNo,
                                        availableLocations: detail.locations || [],
                                        locationId: loc?.locationId || "",
                                        locationName: loc?.location?.name || "",
                                      });
                                    } catch (e: any) { alert(e.message || "재고 상세 조회 실패"); }
                                  }}
                                  placeholder="모델명·재고번호 검색..."
                                  loadOptions={async (q) => {
                                    const res = await inventoryApi.list({
                                      productMasterId: c.productMasterId,
                                      status: "IN_STOCK",
                                      ...(q && { search: q }),
                                      limit: 20,
                                    });
                                    return (res.items || []).map((inv: any) => ({
                                      id: inv.id,
                                      name: inv.inventoryNo,
                                      sub: `${inv.productMaster?.name || ""}${inv.serialNumber ? ` · SN:${inv.serialNumber}` : ""} · 수량 ${inv.quantity}`,
                                    }));
                                  }}
                                />
                                {c.inventoryItemId && (
                                  <div className="text-[10px] text-emerald-600 mt-0.5 dark:text-emerald-400">
                                    ✓ {c.inventoryNo}
                                    {c.locationName && <span className="text-gray-500 ml-1">@ {c.locationName}</span>}
                                  </div>
                                )}
                              </td>
                              <td className="px-2 py-1.5 text-center">
                                <input type="number" value={c.quantity}
                                  onChange={e => updateBundleComponent(idx, { quantity: Number(e.target.value) })}
                                  className="w-14 border rounded px-1 py-0.5 text-xs text-center" />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

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
                    <span className="text-xs text-amber-600 ml-2 dark:text-amber-400">※ 같은 마스터+단가+공급사면 오늘 입고분에 수량 누적</span>
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
