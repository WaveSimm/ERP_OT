"use client";

import { useState, useEffect, useCallback } from "react";
import { useFillHeight } from "@/hooks/useFillHeight";
import { inventoryApi } from "@/lib/api";
import Pagination from "@/components/Pagination";
import SortableHeader from "@/components/SortableHeader";
import { useSortPreference } from "@/hooks/useSortPreference";

const PAGE_SIZE = 50;

export default function LocationsPage() {
  const [locations, setLocations] = useState<any[]>([]);
  const { ref: tableBoxRef, maxHeight: tableMaxH } = useFillHeight();
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ name: "", description: "" });
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const { sortBy, sortOrder, handleSort } = useSortPreference("locations");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await inventoryApi.getLocations({
        search: search || undefined,
        includeInactive: true,
        page,
        limit: PAGE_SIZE,
        ...(sortBy && { sortBy, sortOrder }),
      });
      setLocations(res.items);
      setTotalPages(res.totalPages);
      setTotal(res.total);
    } catch { setLocations([]); }
    finally { setLoading(false); }
  }, [search, page, sortBy, sortOrder]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search]);

  const resetForm = () => {
    setForm({ name: "", description: "" });
    setEditing(null);
    setShowForm(false);
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) { alert("위치명을 입력하세요."); return; }
    try {
      if (editing) {
        await inventoryApi.updateLocation(editing.id, { ...form, type: "WAREHOUSE" });
      } else {
        await inventoryApi.createLocation({ ...form, type: "WAREHOUSE" });
      }
      resetForm();
      load();
    } catch (e: any) { alert(e.message || "저장 실패"); }
  };

  const handleEdit = (loc: any) => {
    setForm({ name: loc.name, description: loc.description || "" });
    setEditing(loc);
    setShowForm(true);
  };

  const handleToggleActive = async (loc: any) => {
    try {
      await inventoryApi.updateLocation(loc.id, { isActive: !loc.isActive });
      load();
    } catch (e: any) { alert(e.message || "변경 실패"); }
  };

  const handleDelete = async (loc: any) => {
    if (!confirm(`"${loc.name}" 위치를 삭제하시겠습니까?`)) return;
    try {
      await inventoryApi.deleteLocation(loc.id);
      load();
    } catch (e: any) { alert(e.message || "삭제 실패"); }
  };

  const renderPageButtons = () => {
    const pages: (number | string)[] = [];
    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || (i >= page - 2 && i <= page + 2)) {
        pages.push(i);
      } else if (pages[pages.length - 1] !== "...") {
        pages.push("...");
      }
    }
    return pages.map((p, idx) =>
      typeof p === "string" ? (
        <span key={`e${idx}`} className="px-2 py-1 text-gray-400">...</span>
      ) : (
        <button key={p} onClick={() => setPage(p as number)}
          className={`px-3 py-1 text-sm rounded ${p === page ? "bg-blue-600 text-white" : "bg-white border hover:bg-gray-50"}`}>
          {p}
        </button>
      )
    );
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-lg font-bold">창고관리</h2>
        <input
          type="text" placeholder="위치 검색..."
          value={search} onChange={(e) => setSearch(e.target.value)}
          className="border rounded-lg px-3 py-1.5 text-sm w-56"
        />
        <span className="text-sm text-gray-500">총 {total}건</span>
        <div className="flex-1" />
        <button onClick={() => { resetForm(); setShowForm(true); }}
          className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          + 위치 추가
        </button>
      </div>

      <p className="text-xs text-gray-400 mb-3">고객사 위치는 고객사 관리 탭에서 관리됩니다.</p>

      <div ref={tableBoxRef} className="bg-white rounded-lg border overflow-auto" style={{ maxHeight: tableMaxH }}>
        <table className="w-full text-sm table-fixed">
          <colgroup>
            <col className="w-[40%]" />
            <col className="w-[35%]" />
            <col className="w-[10%]" />
            <col className="w-[15%]" />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-gray-50 [&>tr>th]:border-b [&>tr>th]:border-gray-200">
            <tr>
              <SortableHeader sortKey="name" currentSort={sortBy} order={sortOrder} onSort={handleSort} className="px-4 py-3 text-left font-medium text-gray-600">위치명</SortableHeader>
              <th className="px-4 py-3 text-left font-medium text-gray-600">설명</th>
              <SortableHeader sortKey="isActive" currentSort={sortBy} order={sortOrder} onSort={handleSort} align="center" className="px-4 py-3 text-center font-medium text-gray-600">상태</SortableHeader>
              <th className="px-4 py-3 text-center font-medium text-gray-600">작업</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">로딩 중...</td></tr>
            ) : locations.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">등록된 위치가 없습니다.</td></tr>
            ) : locations.map((loc) => (
              <tr key={loc.id} className={`hover:bg-gray-50 ${!loc.isActive ? "opacity-50" : ""}`}>
                <td className="px-4 py-2.5 font-medium truncate" title={loc.name}>{loc.name}</td>
                <td className="px-4 py-2.5 text-gray-500 truncate" title={loc.description || ""}>{loc.description || "-"}</td>
                <td className="px-4 py-2.5 text-center">
                  <button onClick={() => handleToggleActive(loc)}
                    className={`text-xs px-2 py-0.5 rounded ${loc.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                    {loc.isActive ? "활성" : "비활성"}
                  </button>
                </td>
                <td className="px-4 py-2.5 text-center">
                  <button onClick={() => handleEdit(loc)} className="text-blue-600 hover:underline text-xs mr-2 dark:text-blue-400">수정</button>
                  <button onClick={() => handleDelete(loc)} className="text-red-500 hover:underline text-xs dark:text-red-400">삭제</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} total={total} className="mt-4 border rounded-lg" />

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={resetForm}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">{editing ? "위치 수정" : "위치 추가"}</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">위치명 *</label>
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="예: OT_A1_1" />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">설명</label>
                <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="위치에 대한 설명" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={resetForm} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">취소</button>
              <button onClick={handleSubmit} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                {editing ? "수정" : "추가"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
