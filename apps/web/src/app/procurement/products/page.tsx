"use client";

import { useState, useEffect, useCallback } from "react";
import { procurementApi, supplierApi, productVariantApi, inventoryApi } from "@/lib/api";
import SearchableSelect from "@/components/SearchableSelect";
import Pagination from "@/components/Pagination";
import SortableHeader, { SortOrder } from "@/components/SortableHeader";

const CURRENCY_LABELS: Record<string, string> = { EUR: "EUR", GBP: "GBP", USD: "USD", KRW: "KRW" };
const PAGE_SIZE = 50;

export default function ProductMasterPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [itemTypeFilter, setItemTypeFilter] = useState<"" | "SIMPLE" | "BUNDLE">("");
  const [sortBy, setSortBy] = useState<string>("");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");
  const handleSort = (k: string, o: SortOrder) => { setSortBy(k); setSortOrder(o); };
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ name: "", modelName: "", manufacturer: "", masterCode: "", defaultCurrency: "", referencePrice: "", itemType: "SIMPLE" as "SIMPLE" | "BUNDLE" });
  const [variantOf, setVariantOf] = useState<any | null>(null);
  const [bundleOf, setBundleOf] = useState<any | null>(null);
  // v1.6 (2026-05-13): 조립은 /procurement/inventory의 수동 등록 모달에서 처리. 마스터는 정의까지만.
  // 번들 행 인라인 펼치기 (v1.6 B안)
  const [expandedBundle, setExpandedBundle] = useState<string | null>(null);
  const [bundleItemsCache, setBundleItemsCache] = useState<Record<string, any[]>>({});

  const toggleBundle = async (p: any) => {
    if (expandedBundle === p.id) {
      setExpandedBundle(null);
      return;
    }
    setExpandedBundle(p.id);
    if (!bundleItemsCache[p.id]) {
      try {
        const items = await procurementApi.getBundleItems(p.id);
        setBundleItemsCache(c => ({ ...c, [p.id]: items }));
      } catch (e: any) { console.error(e); }
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await procurementApi.getProducts({
        search: search || undefined,
        // v1.6 B안: 필터 미지정 시 includeBundle=true로 전체 표시 (관리 페이지)
        ...(itemTypeFilter ? { itemType: itemTypeFilter } : { includeBundle: true }),
        ...(sortBy && { sortBy, sortOrder }),
        page,
        limit: PAGE_SIZE,
      });
      setProducts(res.items);
      setTotal(res.total);
    } catch (e: any) { console.error(e); }
    finally { setLoading(false); }
  }, [search, itemTypeFilter, sortBy, sortOrder, page]);

  // 필터 변경 시 첫 페이지로
  useEffect(() => { setPage(1); }, [search, itemTypeFilter]);

  useEffect(() => { load(); }, [load]);

  const resetForm = () => {
    setForm({ name: "", modelName: "", manufacturer: "", masterCode: "", defaultCurrency: "", referencePrice: "", itemType: "SIMPLE" });
    setEditing(null);
    setShowForm(false);
  };

  const handleSubmit = async () => {
    try {
      const data: any = {
        name: form.name,
        modelName: form.modelName,
        manufacturer: form.manufacturer,
        itemType: form.itemType,
        ...(form.masterCode && { masterCode: form.masterCode }),
        ...(form.referencePrice && { referencePrice: Number(form.referencePrice) }),
        ...(form.defaultCurrency && { defaultCurrency: form.defaultCurrency }),
      };
      if (editing) {
        await procurementApi.updateProduct(editing.id, data);
      } else {
        await procurementApi.createProduct(data);
      }
      resetForm();
      await load();
    } catch (e: any) {
      alert(e.message || "저장 실패");
    }
  };

  const handleEdit = (p: any) => {
    setForm({
      name: p.name,
      modelName: p.modelName,
      manufacturer: p.manufacturer,
      masterCode: p.masterCode || "",
      defaultCurrency: p.defaultCurrency || "",
      referencePrice: p.referencePrice || "",
      itemType: (p.itemType === "BUNDLE" ? "BUNDLE" : "SIMPLE"),
    });
    setEditing(p);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("삭제하시겠습니까?")) return;
    try {
      await procurementApi.deleteProduct(id);
      await load();
    } catch (e: any) { alert(e.message || "삭제 실패"); }
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-lg font-bold">장비 마스터</h2>
        <span className="text-sm text-gray-400">{total}건</span>
        <button onClick={() => { resetForm(); setShowForm(true); }}
          className="ml-auto px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          + 등록
        </button>
      </div>

      {/* 필터 — 재고 관리 스타일과 동일 (2026-05-14) */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="품명, 모델명, 제조사 검색..."
          className="border rounded-lg px-3 py-2 text-sm w-72"
        />
        <select value={itemTypeFilter} onChange={(e) => setItemTypeFilter(e.target.value as any)}
          className="border rounded-lg px-3 py-2 text-sm">
          <option value="">전체 유형</option>
          <option value="SIMPLE">단일 품목</option>
          <option value="BUNDLE">📦 번들</option>
        </select>
        {(search || itemTypeFilter) && (
          <button
            onClick={() => { setSearch(""); setItemTypeFilter(""); }}
            className="px-3 py-1.5 text-xs border rounded-lg hover:bg-gray-50 text-gray-500"
          >
            필터 초기화
          </button>
        )}
      </div>

      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full text-sm table-fixed">
          <colgroup>
            <col className="w-[20%]" />
            <col className="w-[14%]" />
            <col className="w-[12%]" />
            <col className="w-[12%]" />
            <col className="w-[8%]" />
            <col className="w-[8%]" />
            <col className="w-[8%]" />
            <col className="w-[4%]" />
            <col className="w-[14%]" />
          </colgroup>
          <thead className="bg-gray-50 border-b">
            <tr>
              <SortableHeader sortKey="name" currentSort={sortBy} order={sortOrder} onSort={handleSort} className="px-4 py-3 text-left font-medium text-gray-600">품명</SortableHeader>
              <SortableHeader sortKey="modelName" currentSort={sortBy} order={sortOrder} onSort={handleSort} className="px-4 py-3 text-left font-medium text-gray-600">모델명</SortableHeader>
              <SortableHeader sortKey="masterCode" currentSort={sortBy} order={sortOrder} onSort={handleSort} className="px-4 py-3 text-left font-medium text-gray-600">SKU 코드</SortableHeader>
              <SortableHeader sortKey="manufacturer" currentSort={sortBy} order={sortOrder} onSort={handleSort} className="px-4 py-3 text-left font-medium text-gray-600">제조사</SortableHeader>
              <SortableHeader sortKey="itemType" currentSort={sortBy} order={sortOrder} onSort={handleSort} align="center" className="px-4 py-3 text-center font-medium text-gray-600">유형</SortableHeader>
              <SortableHeader sortKey="defaultCurrency" currentSort={sortBy} order={sortOrder} onSort={handleSort} align="center" className="px-4 py-3 text-center font-medium text-gray-600">통화</SortableHeader>
              <SortableHeader sortKey="referencePrice" currentSort={sortBy} order={sortOrder} onSort={handleSort} align="right" className="px-4 py-3 text-right font-medium text-gray-600">원가</SortableHeader>
              <th className="px-4 py-3 text-center font-medium text-gray-600">발주</th>
              <th className="px-4 py-3 text-center font-medium text-gray-600">작업</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">로딩 중...</td></tr>
            ) : products.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">등록된 장비 마스터가 없습니다.</td></tr>
            ) : products.flatMap((p) => {
              const isBundle = p.itemType === "BUNDLE";
              const isExpanded = isBundle && expandedBundle === p.id;
              const cachedItems = bundleItemsCache[p.id];
              const rows: JSX.Element[] = [
                <ProductRow
                  key={p.id}
                  product={p}
                  isExpanded={isExpanded}
                  onToggle={() => toggleBundle(p)}
                  onOpenBundle={() => setBundleOf(p)}
                  onOpenVariant={() => setVariantOf(p)}
                  onDelete={() => handleDelete(p.id)}
                  onSaved={load}
                />
              ];
              if (isExpanded) {
                rows.push(
                  <tr key={p.id + "-expand"} className="bg-amber-50/50">
                    <td colSpan={9} className="px-6 py-3">
                      {!cachedItems ? (
                        <div className="text-xs text-gray-400">구성품 로딩중...</div>
                      ) : cachedItems.length === 0 ? (
                        <div className="text-xs text-gray-400">
                          정의된 구성품이 없습니다. <button onClick={() => setBundleOf(p)} className="text-amber-700 underline">구성품 등록</button>
                        </div>
                      ) : (
                        <div>
                          <div className="text-xs font-medium text-amber-800 mb-2">📦 번들 구성품 ({cachedItems.length}건)</div>
                          <table className="w-full text-xs bg-white rounded border">
                            <thead className="bg-gray-50 border-b">
                              <tr>
                                <th className="px-2 py-1.5 text-left">구성품</th>
                                <th className="px-2 py-1.5 text-left">모델명</th>
                                <th className="px-2 py-1.5 text-center">수량</th>
                                <th className="px-2 py-1.5 text-center">슬롯</th>
                                <th className="px-2 py-1.5 text-left">메모</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y">
                              {cachedItems.map((it: any) => (
                                <tr key={it.id}>
                                  <td className="px-2 py-1.5">{it.productMaster?.name || "-"}</td>
                                  <td className="px-2 py-1.5 font-mono text-[10px] text-gray-500">{it.productMaster?.modelName || "-"}</td>
                                  <td className="px-2 py-1.5 text-center">{it.quantity}</td>
                                  <td className="px-2 py-1.5 text-center">
                                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${it.slotType === "MAIN" ? "bg-blue-50 text-blue-700" : "bg-gray-100 text-gray-600"}`}>
                                      {it.slotType}
                                    </span>
                                  </td>
                                  <td className="px-2 py-1.5 text-gray-500">{it.notes || "-"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              }
              return rows;
            })}
          </tbody>
        </table>

        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} total={total} />
      </div>

      {variantOf && <VariantModal master={variantOf} onClose={() => setVariantOf(null)} onSaved={load} />}
      {bundleOf && <BundleItemsModal master={bundleOf} onClose={() => {
        // 저장 후 캐시 무효화 → 펼침 시 최신 데이터 fetch
        setBundleItemsCache(c => {
          const { [bundleOf.id]: _, ...rest } = c;
          return rest;
        });
        setBundleOf(null);
      }} />}

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={resetForm}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">{editing ? "장비 마스터 수정" : "장비 마스터 등록"}</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">유형 *</label>
                <div className="flex gap-2">
                  <label className="flex items-center gap-1 text-sm">
                    <input type="radio" name="itemType" value="SIMPLE"
                      checked={form.itemType === "SIMPLE"}
                      onChange={() => setForm({ ...form, itemType: "SIMPLE" })} />
                    단일 품목
                  </label>
                  <label className="flex items-center gap-1 text-sm">
                    <input type="radio" name="itemType" value="BUNDLE"
                      checked={form.itemType === "BUNDLE"}
                      onChange={() => setForm({ ...form, itemType: "BUNDLE" })} />
                    📦 번들
                  </label>
                </div>
                {form.itemType === "BUNDLE" && (
                  <p className="text-[10px] text-amber-700 mt-1">번들은 발주 line item에서 차단되며, 등록 후 [구성품] 버튼으로 구성을 정의하십시오.</p>
                )}
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">품명 *</label>
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">모델명 *</label>
                  <input type="text" value={form.modelName} onChange={(e) => setForm({ ...form, modelName: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">제조사 *</label>
                  <SearchableSelect
                    value={form.manufacturer}
                    onChange={(v) => setForm({ ...form, manufacturer: v })}
                    placeholder="제조사 검색..."
                    allowCustom
                    loadOptions={async (q) => {
                      const res = await supplierApi.list({ search: q, limit: 20 });
                      return (res.items || []).map((s: any) => ({ id: s.id, name: s.name, sub: s.country || undefined }));
                    }}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">SKU 코드 (선택)</label>
                <input type="text" value={form.masterCode}
                  onChange={(e) => setForm({ ...form, masterCode: e.target.value })}
                  placeholder="예: STR (3~6자, Variant SKU 생성 prefix)"
                  className="w-full border rounded-lg px-3 py-2 text-sm font-mono uppercase"
                  maxLength={10} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">기본 통화</label>
                  <select value={form.defaultCurrency} onChange={(e) => setForm({ ...form, defaultCurrency: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm">
                    <option value="">선택</option>
                    {Object.entries(CURRENCY_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">원가</label>
                  <input type="number" value={form.referencePrice} onChange={(e) => setForm({ ...form, referencePrice: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="0" />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={resetForm} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">취소</button>
              <button onClick={handleSubmit} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                {editing ? "수정" : "등록"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Variant 관리 모달 (v1.6) ───────────────────────────────────────
function VariantModal({ master, onClose, onSaved }: { master: any; onClose: () => void; onSaved?: () => void }) {
  const [variants, setVariants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<{ skuCode: string; specsText: string }>({ skuCode: "", specsText: "" });
  const [saving, setSaving] = useState(false);
  // v1.6 (2026-05-14): 마스터 prefix 편집
  const [prefix, setPrefix] = useState<string>(master.masterCode || "");
  const [savingPrefix, setSavingPrefix] = useState(false);
  const [prefixDirty, setPrefixDirty] = useState(false);

  const savePrefix = async () => {
    setSavingPrefix(true);
    try {
      await procurementApi.updateProduct(master.id, { masterCode: prefix.trim() || null });
      setPrefixDirty(false);
      onSaved?.();  // 부모 마스터 목록 갱신 트리거
    } catch (e: any) { alert(e.message || "prefix 저장 실패"); }
    finally { setSavingPrefix(false); }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await productVariantApi.listByMaster(master.id, true);
      setVariants(Array.isArray(data) ? data : []);
    } catch (e: any) { alert(e.message || "조회 실패"); }
    finally { setLoading(false); }
  }, [master.id]);

  useEffect(() => { load(); }, [load]);

  const resetForm = () => {
    setForm({ skuCode: "", specsText: "" });
    setEditing(null);
    setShowForm(false);
  };

  const openEdit = (v: any) => {
    setEditing(v);
    setForm({
      skuCode: v.skuCode || "",
      specsText: v.variantSpecs ? JSON.stringify(v.variantSpecs, null, 2) : "",
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    let specs: any = undefined;
    if (form.specsText.trim()) {
      try { specs = JSON.parse(form.specsText); }
      catch { alert("variantSpecs JSON 파싱 실패"); return; }
    }
    setSaving(true);
    try {
      if (editing) {
        const updated = await productVariantApi.update(editing.id, {
          skuCode: form.skuCode || undefined,
          variantSpecs: specs,
        });
        // 응답을 즉시 state에 반영 + load fallback
        setVariants(prev => prev.map(v => v.id === editing.id ? updated : v));
      } else {
        const created = await productVariantApi.create({
          productMasterId: master.id,
          skuCode: form.skuCode || undefined,
          variantSpecs: specs,
        });
        // v1.6 (2026-05-14): 등록 즉시 list에 반영 (load timing 이슈 회피)
        setVariants(prev => [...prev, { ...created, _count: { inventoryItems: 0 } }]);
      }
      resetForm();
      await load();
    } catch (e: any) { alert(e.message || "저장 실패"); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("이 variant를 삭제하시겠습니까? (참조 재고가 있으면 실패)")) return;
    try {
      await productVariantApi.remove(id);
      await load();
    } catch (e: any) { alert(e.message || "삭제 실패"); }
  };

  const handleToggleActive = async (v: any) => {
    try {
      await productVariantApi.update(v.id, { isActive: !v.isActive });
      await load();
    } catch (e: any) { alert(e.message || "변경 실패"); }
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-lg font-bold">{master.name} — SKU 옵션</h3>
            <div className="text-xs text-gray-500 mt-1">{master.modelName} · {master.manufacturer}</div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
        </div>

        {/* Master SKU Prefix 편집 — v1.6 (2026-05-14) */}
        <div className="mb-4 p-3 bg-purple-50/40 border border-purple-100 rounded-lg">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-purple-800 whitespace-nowrap">SKU Prefix</label>
            <input
              type="text"
              value={prefix}
              onChange={(e) => { setPrefix(e.target.value); setPrefixDirty(true); }}
              placeholder="3~6자 (예: STR). 비워두면 모델명 fallback"
              maxLength={10}
              className="flex-1 border rounded px-2 py-1 text-sm font-mono uppercase"
            />
            <button
              onClick={savePrefix}
              disabled={savingPrefix || !prefixDirty}
              className="px-3 py-1 text-xs bg-purple-600 text-white rounded disabled:bg-gray-300"
            >
              {savingPrefix ? "저장..." : "저장"}
            </button>
          </div>
          <div className="text-[10px] text-purple-700 mt-1">
            모든 Variant SKU 자동 생성 시 이 prefix가 앞에 붙습니다 (예: <span className="font-mono">{prefix.trim() || master.modelName || "VAR"}-10M-FE</span>)
          </div>
        </div>

        <div className="flex justify-end mb-3">
          <button onClick={() => { resetForm(); setShowForm(true); }}
            className="px-4 py-1.5 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700">
            + Variant 등록
          </button>
        </div>

        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-2 py-2 text-left">SKU 코드</th>
                <th className="px-2 py-2 text-left">사양 (key_attributes)</th>
                <th className="px-2 py-2 text-center">활성</th>
                <th className="px-2 py-2 text-center">재고수</th>
                <th className="px-2 py-2 text-center">작업</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">로딩중...</td></tr>
              ) : variants.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Variant가 없습니다.</td></tr>
              ) : variants.map((v: any) => (
                <tr key={v.id} className={!v.isActive ? "opacity-50" : ""}>
                  <td className="px-2 py-1.5 font-mono">{v.skuCode || "-"}</td>
                  <td className="px-2 py-1.5 text-[10px] text-gray-600">
                    {v.variantSpecs ? Object.entries(v.variantSpecs).map(([k, val]: any) => `${k}=${val}`).join(", ") : "-"}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <button onClick={() => handleToggleActive(v)} className="text-blue-600 hover:underline">
                      {v.isActive ? "✓" : "—"}
                    </button>
                  </td>
                  <td className="px-2 py-1.5 text-center">{v._count?.inventoryItems ?? 0}</td>
                  <td className="px-2 py-1.5 text-center">
                    <button onClick={() => openEdit(v)} className="text-blue-600 hover:underline mr-2">수정</button>
                    <button onClick={() => handleDelete(v.id)} className="text-red-500 hover:underline">삭제</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {showForm && (
          <div className="mt-4 p-3 border-t pt-4">
            <div className="text-sm font-medium mb-2">{editing ? "Variant 수정" : "Variant 등록"}</div>
            <div className="space-y-2">
              <div>
                <label className="block text-xs text-gray-500 mb-1">SKU 코드 (비워두면 자동 생성)</label>
                <input type="text" value={form.skuCode} onChange={e => setForm({ ...form, skuCode: e.target.value })}
                  className="w-full border rounded px-2 py-1.5 text-xs font-mono"
                  placeholder={master.masterCode ? `${master.masterCode}-...` : "자동 생성"} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">variantSpecs (JSON)</label>
                <textarea value={form.specsText} onChange={e => setForm({ ...form, specsText: e.target.value })}
                  className="w-full border rounded px-2 py-1.5 text-xs font-mono" rows={3}
                  placeholder='예: { "length": "10m", "end_type": "FE" }' />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={resetForm} className="px-3 py-1.5 text-xs border rounded hover:bg-gray-50">취소</button>
              <button onClick={handleSave} disabled={saving}
                className="px-3 py-1.5 text-xs bg-purple-600 text-white rounded hover:bg-purple-700 disabled:bg-gray-300">
                {saving ? "저장 중..." : (editing ? "수정" : "등록")}
              </button>
            </div>
          </div>
        )}

        <div className="flex justify-end mt-4">
          <button onClick={onClose} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">닫기</button>
        </div>
      </div>
    </div>
  );
}

// ─── 구성품 (BomItem) 모달 (v1.6 B안, 2026-05-13) ───────────────
// 번들 마스터(itemType=BUNDLE)의 구성품 정의. BomItem 행 일괄 교체.
function BundleItemsModal({ master, onClose }: { master: any; onClose: () => void }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await procurementApi.getBundleItems(master.id);
      setItems((data || []).map((it: any) => ({
        productMasterId: it.productMasterId,
        productMasterName: it.productMaster?.name,
        productMasterModel: it.productMaster?.modelName,
        variantId: it.variantId,
        variantSku: it.variant?.skuCode,
        quantity: it.quantity,
        slotType: it.slotType,
        notes: it.notes || "",
      })));
    } catch (e: any) { alert(e.message || "조회 실패"); }
    finally { setLoading(false); }
  }, [master.id]);

  useEffect(() => { load(); }, [load]);

  const addItem = (pm: any) => {
    setItems([...items, {
      productMasterId: pm.id,
      productMasterName: pm.name,
      productMasterModel: pm.sub,
      variantId: null,
      quantity: 1,
      slotType: "MAIN",
      notes: "",
    }]);
  };

  const updateItem = (idx: number, patch: any) => {
    setItems(items.map((it, i) => i === idx ? { ...it, ...patch } : it));
  };

  const removeItem = (idx: number) => {
    setItems(items.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    if (items.length === 0) { alert("최소 1개 구성품 필요"); return; }
    setSaving(true);
    try {
      await procurementApi.replaceBundleItems(master.id, items.map(it => ({
        productMasterId: it.productMasterId,
        variantId: it.variantId || undefined,
        quantity: it.quantity,
        slotType: it.slotType,
        notes: it.notes || undefined,
      })));
      onClose();
    } catch (e: any) { alert(e.message || "저장 실패"); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-lg font-bold">📦 {master.name} — 번들 구성품</h3>
            <div className="text-xs text-gray-500 mt-1">{master.modelName} · {master.manufacturer}</div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
        </div>

        <div className="mb-3">
          <SearchableSelect
            value=""
            onChange={() => {}}
            onSelect={(item) => item && addItem(item)}
            placeholder="구성품 마스터 검색하여 추가 (단일 품목만)..."
            loadOptions={async (q) => {
              // SIMPLE만 검색 (번들의 번들 방지)
              const res = await procurementApi.getProducts({ search: q, itemType: "SIMPLE", limit: 20 });
              return (res.items || []).map((p: any) => ({
                id: p.id,
                name: p.name,
                sub: [
                  p.modelName,
                  p.manufacturer,
                  p.stockSummary?.items > 0
                    ? `재고 ${p.stockSummary.items}건·${p.stockSummary.quantity}개`
                    : "재고 없음",
                ].filter(Boolean).join(" · "),
              }));
            }}
          />
        </div>

        {loading ? (
          <div className="text-center text-gray-400 py-8">로딩중...</div>
        ) : items.length === 0 ? (
          <div className="text-center text-gray-400 py-8 border rounded-lg">
            구성품이 없습니다. 위 검색창에서 추가하십시오.
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-2 py-2 text-left">구성품</th>
                  <th className="px-2 py-2 text-center">수량</th>
                  <th className="px-2 py-2 text-center">슬롯</th>
                  <th className="px-2 py-2 text-left">메모</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((it, idx) => (
                  <tr key={idx}>
                    <td className="px-2 py-1.5">
                      <div>{it.productMasterName}</div>
                      <div className="text-[10px] text-gray-400">{it.productMasterModel}</div>
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <input type="number" value={it.quantity}
                        onChange={e => updateItem(idx, { quantity: Number(e.target.value) })}
                        className="w-16 border rounded px-1 py-0.5 text-xs" />
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <select value={it.slotType}
                        onChange={e => updateItem(idx, { slotType: e.target.value })}
                        className="border rounded px-1 py-0.5 text-xs">
                        <option value="MAIN">MAIN</option>
                        <option value="OPTIONAL">OPTIONAL</option>
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <input type="text" value={it.notes || ""}
                        onChange={e => updateItem(idx, { notes: e.target.value })}
                        className="w-full border rounded px-1 py-0.5 text-xs" />
                    </td>
                    <td className="px-2 py-1.5">
                      <button onClick={() => removeItem(idx)} className="text-red-500 text-xs">×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">취소</button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:bg-gray-300">
            {saving ? "저장 중..." : "구성품 저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── 인라인 편집 행 (v1.6 B안, 2026-05-13) ───────────────
// 별도 [수정] 버튼 없이 셀 자체가 입력 필드. blur 시 자동 저장.
function ProductRow({
  product,
  isExpanded,
  onToggle,
  onOpenBundle,
  onOpenVariant,
  onDelete,
  onSaved,
}: {
  product: any;
  isExpanded: boolean;
  onToggle: () => void;
  onOpenBundle: () => void;
  onOpenVariant: () => void;
  onDelete: () => void;
  onSaved: () => void;
}) {
  const isBundle = product.itemType === "BUNDLE";
  const [name, setName] = useState(product.name);
  const [modelName, setModelName] = useState(product.modelName);
  const [manufacturer, setManufacturer] = useState(product.manufacturer);
  const [masterCode, setMasterCode] = useState(product.masterCode || "");
  const [defaultCurrency, setDefaultCurrency] = useState(product.defaultCurrency || "");
  const [referencePrice, setReferencePrice] = useState(product.referencePrice ? String(product.referencePrice) : "");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // product prop이 외부에서 갱신되면 (load 후) 동기화
  useEffect(() => {
    setName(product.name);
    setModelName(product.modelName);
    setManufacturer(product.manufacturer);
    setMasterCode(product.masterCode || "");
    setDefaultCurrency(product.defaultCurrency || "");
    setReferencePrice(product.referencePrice ? String(product.referencePrice) : "");
    setDirty(false);
  }, [product.id, product.name, product.modelName, product.manufacturer, product.masterCode, product.defaultCurrency, product.referencePrice]);

  // 변경된 필드만 PATCH
  const saveField = async (field: string, value: any, originalValue: any) => {
    // 필수 필드 빈 값 차단
    if (["name", "modelName", "manufacturer"].includes(field) && !String(value).trim()) {
      alert(`${field === "name" ? "품명" : field === "modelName" ? "모델명" : "제조사"}은(는) 필수입니다.`);
      if (field === "name") setName(originalValue);
      else if (field === "modelName") setModelName(originalValue);
      else setManufacturer(originalValue);
      return;
    }
    if (value === originalValue || (value === "" && originalValue == null)) return;

    setSaving(true);
    try {
      const patch: any = {};
      patch[field] = field === "referencePrice"
        ? (value === "" ? null : Number(value))
        : (value === "" ? null : value);
      await procurementApi.updateProduct(product.id, patch);
      setDirty(false);
      onSaved();
    } catch (e: any) {
      alert(e.message || "저장 실패");
      // 원래 값 복원
      if (field === "name") setName(originalValue);
      else if (field === "modelName") setModelName(originalValue);
      else if (field === "manufacturer") setManufacturer(originalValue);
      else if (field === "masterCode") setMasterCode(originalValue || "");
      else if (field === "defaultCurrency") setDefaultCurrency(originalValue || "");
      else if (field === "referencePrice") setReferencePrice(originalValue ? String(originalValue) : "");
    } finally {
      setSaving(false);
    }
  };

  const cellClass = `px-2 py-1.5 ${dirty ? "bg-yellow-50" : ""}`;
  const inputBase = "w-full border border-transparent hover:border-gray-300 focus:border-blue-400 focus:bg-white rounded px-2 py-1 text-sm focus:outline-none";

  return (
    <tr className={`hover:bg-gray-50 ${saving ? "opacity-60" : ""}`}>
      {/* 품명 + 번들 토글 */}
      <td className={cellClass}>
        <div className="flex items-center gap-1">
          {isBundle ? (
            <button onClick={onToggle} className="w-4 text-amber-600 text-xs flex-shrink-0">
              {isExpanded ? "▼" : "▶"}
            </button>
          ) : (
            <span className="w-4 flex-shrink-0" />
          )}
          <input
            type="text"
            value={name}
            onChange={e => { setName(e.target.value); setDirty(true); }}
            onBlur={() => saveField("name", name, product.name)}
            className={inputBase + " flex-1"}
          />
        </div>
      </td>
      {/* 모델명 */}
      <td className={cellClass}>
        <input
          type="text"
          value={modelName}
          onChange={e => { setModelName(e.target.value); setDirty(true); }}
          onBlur={() => saveField("modelName", modelName, product.modelName)}
          className={inputBase + " font-mono text-xs"}
        />
      </td>
      {/* SKU 코드 — v1.6 (2026-05-14): variant SKU 목록만 표시. prefix·variant 관리는 [SKU] 모달에서 */}
      <td className={cellClass}>
        {product.masterCode && (
          <div className="text-[10px] text-gray-400 mb-0.5">
            prefix: <span className="font-mono text-gray-600">{product.masterCode}</span>
          </div>
        )}
        {product.variants && product.variants.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {product.variants.slice(0, 3).map((v: any) => v.skuCode ? (
              <span key={v.id} className="px-1.5 py-0.5 text-[10px] rounded bg-purple-50 text-purple-700 font-mono">
                {v.skuCode}
              </span>
            ) : null)}
            {product._count?.variants > 3 && (
              <span className="text-[10px] text-gray-400">+{product._count.variants - 3}</span>
            )}
          </div>
        ) : (
          <span className="text-[10px] text-gray-300">—</span>
        )}
      </td>
      {/* 제조사 */}
      <td className={cellClass}>
        <input
          type="text"
          value={manufacturer}
          onChange={e => { setManufacturer(e.target.value); setDirty(true); }}
          onBlur={() => saveField("manufacturer", manufacturer, product.manufacturer)}
          className={inputBase}
        />
      </td>
      {/* 유형 (v1.6 2026-05-14): SIMPLE/BUNDLE 뱃지. 변경은 등록 모달에서만 (FK 보호) */}
      <td className="px-2 py-1.5 text-center">
        {isBundle ? (
          <span className="inline-block px-2 py-0.5 text-[10px] rounded bg-amber-100 text-amber-700 font-medium whitespace-nowrap">📦 번들</span>
        ) : (
          <span className="inline-block px-2 py-0.5 text-[10px] rounded bg-gray-100 text-gray-600 whitespace-nowrap">단일</span>
        )}
      </td>
      {/* 통화 */}
      <td className={cellClass}>
        <select
          value={defaultCurrency}
          onChange={e => {
            setDefaultCurrency(e.target.value);
            setDirty(true);
            saveField("defaultCurrency", e.target.value, product.defaultCurrency);
          }}
          className={inputBase + " text-center"}
        >
          <option value="">-</option>
          <option value="EUR">EUR</option>
          <option value="GBP">GBP</option>
          <option value="USD">USD</option>
          <option value="KRW">KRW</option>
        </select>
      </td>
      {/* 원가 */}
      <td className={cellClass}>
        <input
          type="number"
          value={referencePrice}
          onChange={e => { setReferencePrice(e.target.value); setDirty(true); }}
          onBlur={() => saveField("referencePrice", referencePrice, product.referencePrice)}
          className={inputBase + " font-mono text-xs text-right"}
        />
      </td>
      {/* 발주 (read-only) */}
      <td className="px-4 py-2.5 text-center text-gray-500">{product._count?.orderItems ?? 0}</td>
      {/* 작업 */}
      <td className="px-4 py-2.5 text-center whitespace-nowrap">
        {isBundle ? (
          <button onClick={onOpenBundle} className="text-amber-600 hover:underline text-xs mr-2">구성품</button>
        ) : (
          <button onClick={onOpenVariant} className="text-purple-600 hover:underline text-xs mr-2">SKU</button>
        )}
        <button onClick={onDelete} className="text-red-500 hover:underline text-xs">삭제</button>
      </td>
    </tr>
  );
}

