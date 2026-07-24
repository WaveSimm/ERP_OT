"use client";

import { useState, useEffect, useCallback } from "react";
import { useFillHeight } from "@/hooks/useFillHeight";
import { inventoryApi } from "@/lib/api";
import Pagination from "@/components/Pagination";
import SortableHeader from "@/components/SortableHeader";
import { useSortPreference } from "@/hooks/useSortPreference";
import { TableCard, Table, THead, Th, TBody, Tr, Td, TableActions, RowButton, TableEmpty } from "@/components/ui/Table";

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
  const { sortBy, sortOrder, handleSort, resetSort } = useSortPreference("locations");

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
      <p className="text-xs text-gray-400 mb-3">고객사 위치는 고객사 관리 탭에서 관리됩니다.</p>

      <TableCard
        title="창고관리"
        count={total}
        scrollRef={tableBoxRef}
        maxHeight={tableMaxH}
        actions={
          <>
            <input type="text" placeholder="위치 검색..." value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border border-gray-300 dark:border-gray-600 dark:bg-gray-800 rounded-lg px-3 py-1.5 text-sm w-56" />
            {sortBy && (
              <button onClick={resetSort} title="정렬을 원래 순서로 되돌립니다"
                className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
                ↺ 정렬 초기화
              </button>
            )}
            <button onClick={() => { resetForm(); setShowForm(true); }}
              className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              + 위치 추가
            </button>
          </>
        }
        footer={<Pagination page={page} totalPages={totalPages} onPageChange={setPage} total={total} />}
      >
        <Table fixed columnDividers>
          <colgroup>
            <col className="w-[24%]" />
            <col className="w-[51%]" />
            <col className="w-[10%]" />
            <col className="w-[15%]" />
          </colgroup>
          <THead>
            <SortableHeader sortKey="name" currentSort={sortBy} order={sortOrder} onSort={handleSort} align="center" className="px-4 py-3 font-medium">위치명</SortableHeader>
            <Th align="center">설명</Th>
            <SortableHeader sortKey="isActive" currentSort={sortBy} order={sortOrder} onSort={handleSort} align="center" className="px-4 py-3 font-medium">상태</SortableHeader>
            <Th align="center">작업</Th>
          </THead>
          <TBody>
            {loading ? (
              <TableEmpty colSpan={4}>로딩 중...</TableEmpty>
            ) : locations.length === 0 ? (
              <TableEmpty colSpan={4}>등록된 위치가 없습니다.</TableEmpty>
            ) : locations.map((loc) => (
              <Tr key={loc.id} className={`hover:bg-gray-50 dark:hover:bg-gray-800/60 ${!loc.isActive ? "opacity-50" : ""}`}>
                <Td strong truncate title={loc.name}>{loc.name}</Td>
                <Td dash truncate title={loc.description || undefined}>{loc.description}</Td>
                <Td align="center">
                  <button onClick={() => handleToggleActive(loc)}
                    className={`text-xs px-2 py-0.5 rounded ${loc.isActive ? "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300" : "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300"}`}>
                    {loc.isActive ? "활성" : "비활성"}
                  </button>
                </Td>
                <Td align="center">
                  <TableActions>
                    <RowButton onClick={() => handleEdit(loc)}>수정</RowButton>
                    <RowButton danger onClick={() => handleDelete(loc)}>삭제</RowButton>
                  </TableActions>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </TableCard>

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
