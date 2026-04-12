"use client";

import { useState, useEffect, useCallback } from "react";
import { procurementApi, supplierApi } from "@/lib/api";
import SearchableSelect from "@/components/SearchableSelect";

const CURRENCY_LABELS: Record<string, string> = { EUR: "EUR", GBP: "GBP", USD: "USD", KRW: "KRW" };
const PAGE_SIZE = 50;

export default function ProductMasterPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [nameFilter, setNameFilter] = useState("");
  const [modelFilter, setModelFilter] = useState("");
  const [mfrFilter, setMfrFilter] = useState("");
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ name: "", modelName: "", manufacturer: "", defaultCurrency: "", referencePrice: "" });

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await procurementApi.getProducts({
        search: search || undefined,
        name: nameFilter || undefined,
        modelName: modelFilter || undefined,
        manufacturer: mfrFilter || undefined,
        page,
        limit: PAGE_SIZE,
      });
      setProducts(res.items);
      setTotal(res.total);
    } catch (e: any) { console.error(e); }
    finally { setLoading(false); }
  }, [search, nameFilter, modelFilter, mfrFilter, page]);

  useEffect(() => { load(); }, [load]);

  const resetForm = () => {
    setForm({ name: "", modelName: "", manufacturer: "", defaultCurrency: "", referencePrice: "" });
    setEditing(null);
    setShowForm(false);
  };

  const handleSubmit = async () => {
    try {
      const data = {
        ...form,
        referencePrice: form.referencePrice ? Number(form.referencePrice) : undefined,
        defaultCurrency: form.defaultCurrency || undefined,
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
      defaultCurrency: p.defaultCurrency || "",
      referencePrice: p.referencePrice || "",
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
        {(nameFilter || modelFilter || mfrFilter) && (
          <button
            onClick={() => { setNameFilter(""); setModelFilter(""); setMfrFilter(""); setPage(1); }}
            className="px-3 py-1.5 text-xs border rounded-lg hover:bg-gray-50 text-gray-500"
          >
            필터 초기화
          </button>
        )}
        <button onClick={() => { resetForm(); setShowForm(true); }}
          className="ml-auto px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          + 등록
        </button>
      </div>

      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full text-sm table-fixed">
          <colgroup>
            <col className="w-[30%]" />
            <col className="w-[22%]" />
            <col className="w-[18%]" />
            <col className="w-[7%]" />
            <col className="w-[10%]" />
            <col className="w-[5%]" />
            <col className="w-[8%]" />
          </colgroup>
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-600">
                <div className="text-xs mb-1">품명</div>
                <input
                  type="text" placeholder="품명 검색..."
                  value={nameFilter} onChange={(e) => { setNameFilter(e.target.value); setPage(1); }}
                  className="w-full border rounded px-2 py-1 text-xs font-normal focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              </th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">
                <div className="text-xs mb-1">모델명</div>
                <input
                  type="text" placeholder="모델명 검색..."
                  value={modelFilter} onChange={(e) => { setModelFilter(e.target.value); setPage(1); }}
                  className="w-full border rounded px-2 py-1 text-xs font-normal focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              </th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">
                <div className="text-xs mb-1">제조사</div>
                <input
                  type="text" placeholder="제조사 검색..."
                  value={mfrFilter} onChange={(e) => { setMfrFilter(e.target.value); setPage(1); }}
                  className="w-full border rounded px-2 py-1 text-xs font-normal focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              </th>
              <th className="px-4 py-2 text-center font-medium text-gray-600 text-xs">통화</th>
              <th className="px-4 py-2 text-right font-medium text-gray-600 text-xs">참고가</th>
              <th className="px-4 py-2 text-center font-medium text-gray-600 text-xs">발주</th>
              <th className="px-4 py-2 text-center font-medium text-gray-600 text-xs">작업</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">로딩 중...</td></tr>
            ) : products.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">등록된 장비 마스터가 없습니다.</td></tr>
            ) : products.map((p) => (
              <tr key={p.id} className="hover:bg-gray-50">
                <td className="px-4 py-2.5 truncate" title={p.name}>{p.name}</td>
                <td className="px-4 py-2.5 font-mono text-xs truncate" title={p.modelName}>{p.modelName}</td>
                <td className="px-4 py-2.5 truncate" title={p.manufacturer}>{p.manufacturer}</td>
                <td className="px-4 py-2.5 text-center text-gray-500">{p.defaultCurrency || "-"}</td>
                <td className="px-4 py-2.5 text-right font-mono text-xs">{p.referencePrice ? Number(p.referencePrice).toLocaleString() : "-"}</td>
                <td className="px-4 py-2.5 text-center text-gray-500">{p._count?.orderItems ?? 0}</td>
                <td className="px-4 py-2.5 text-center">
                  <button onClick={() => handleEdit(p)} className="text-blue-600 hover:underline text-xs mr-2">수정</button>
                  <button onClick={() => handleDelete(p.id)} className="text-red-500 hover:underline text-xs">삭제</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Pagination */}
        <div className="px-4 py-2 border-t flex items-center justify-between">
          <span className="text-xs text-gray-400">
            {total > 0 ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} / 총 ${total}건` : "0건"}
          </span>
          {totalPages > 1 && (
            <div className="flex gap-1">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
                className="px-2 py-1 border rounded text-xs disabled:opacity-30 hover:bg-gray-50">이전</button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
                .reduce<(number | string)[]>((acc, p, i, arr) => {
                  if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push("...");
                  acc.push(p);
                  return acc;
                }, [])
                .map((p, i) =>
                  typeof p === "string" ? (
                    <span key={`e${i}`} className="px-1 py-1 text-xs text-gray-400">…</span>
                  ) : (
                    <button key={p} onClick={() => setPage(p)}
                      className={`px-2 py-1 border rounded text-xs ${page === p ? "bg-blue-600 text-white border-blue-600" : "hover:bg-gray-50"}`}>{p}</button>
                  )
                )}
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                className="px-2 py-1 border rounded text-xs disabled:opacity-30 hover:bg-gray-50">다음</button>
            </div>
          )}
        </div>
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={resetForm}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">{editing ? "장비 마스터 수정" : "장비 마스터 등록"}</h2>
            <div className="space-y-3">
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
                  <label className="block text-sm text-gray-600 mb-1">참고가</label>
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
