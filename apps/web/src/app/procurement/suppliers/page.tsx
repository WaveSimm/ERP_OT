"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supplierApi } from "@/lib/api";

const PAGE_SIZE = 50;

export default function SuppliersPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [page, setPage] = useState(1);
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: "", country: "", contactName: "", phone: "", email: "", website: "", address: "", businessNumber: "", notes: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await supplierApi.list({ search: search || undefined, page, limit: PAGE_SIZE });
      setSuppliers(res.items || []);
      setTotal(res.total || 0);
    } catch (e: any) { console.error(e); }
    finally { setLoading(false); }
  }, [search, page]);

  useEffect(() => { load(); }, [load]);

  const resetForm = () => {
    setForm({ name: "", country: "", contactName: "", phone: "", email: "", website: "", address: "", businessNumber: "", notes: "" });
    setShowForm(false);
  };

  const handleSubmit = async () => {
    try {
      const data: any = {};
      Object.entries(form).forEach(([k, v]) => { if (v) data[k] = v; });
      await supplierApi.create(data);
      resetForm();
      await load();
    } catch (e: any) { alert(e.message || "저장 실패"); }
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <h2 className="text-lg font-bold">제조사/공급사 관리</h2>
        <input type="text" placeholder="제조사명, 국가, 담당자 검색..." value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="border rounded-lg px-3 py-1.5 text-sm w-56" />
        <span className="text-sm text-gray-400">{total}건</span>
        <button onClick={() => { resetForm(); setShowForm(true); }}
          className="ml-auto px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          + 제조사 등록
        </button>
      </div>

      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full text-sm table-fixed">
          <colgroup>
            <col className="w-[24%]" />
            <col className="w-[8%]" />
            <col className="w-[12%]" />
            <col className="w-[14%]" />
            <col className="w-[20%]" />
            <col className="w-[22%]" />
          </colgroup>
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600">제조사/공급사명</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">국가</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">담당자</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">전화</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">이메일</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">웹사이트</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">로딩 중...</td></tr>
            ) : suppliers.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">등록된 제조사가 없습니다.</td></tr>
            ) : suppliers.map((s) => (
              <tr key={s.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => router.push(`/procurement/suppliers/${s.id}`)}>
                <td className="px-4 py-2.5 font-medium text-blue-600 truncate" title={s.name}>{s.name}</td>
                <td className="px-4 py-2.5 text-gray-500">{s.country || "-"}</td>
                <td className="px-4 py-2.5 text-gray-500 truncate">{s.contactName || "-"}</td>
                <td className="px-4 py-2.5 text-gray-500 text-xs">{s.phone || "-"}</td>
                <td className="px-4 py-2.5 text-gray-500 text-xs truncate" title={s.email}>{s.email || "-"}</td>
                <td className="px-4 py-2.5 text-gray-500 text-xs truncate" title={s.website}>{s.website || "-"}</td>
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
            <h2 className="text-lg font-bold mb-4">제조사 등록</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">제조사/공급사명 *</label>
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">국가</label>
                <input type="text" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="한국, UK, USA 등" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">담당자</label>
                  <input type="text" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">전화</label>
                  <input type="text" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">이메일</label>
                <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">웹사이트</label>
                <input type="text" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="https://" />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">주소</label>
                <input type="text" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">사업자등록번호</label>
                <input type="text" value={form.businessNumber} onChange={(e) => setForm({ ...form, businessNumber: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="000-00-00000" />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">비고</label>
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm" rows={2} />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={resetForm} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">취소</button>
              <button onClick={handleSubmit} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
등록
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
