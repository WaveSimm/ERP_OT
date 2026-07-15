"use client";

import { useState, useEffect, useCallback } from "react";
import { useFillHeight } from "@/hooks/useFillHeight";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { supplierApi } from "@/lib/api";
import Pagination from "@/components/Pagination";
import SortableHeader from "@/components/SortableHeader";
import { useSortPreference } from "@/hooks/useSortPreference";
import { TableCard, Table, THead, Th, TBody, Tr, Td, TableEmpty } from "@/components/ui/Table";

const PAGE_SIZE = 50;

export default function SuppliersPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const basePath = pathname.startsWith("/repair") ? "/repair/suppliers" : "/procurement/suppliers";
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const { ref: tableBoxRef, maxHeight: tableMaxH } = useFillHeight();
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const { sortBy, sortOrder, handleSort, resetSort } = useSortPreference("suppliers");
  const [page, setPage] = useState(1);
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: "", country: "", contactName: "", phone: "", email: "", website: "", address: "", businessNumber: "", notes: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await supplierApi.list({ search: search || undefined, page, limit: PAGE_SIZE, ...(sortBy && { sortBy, sortOrder }) });
      setSuppliers(res.items || []);
      setTotal(res.total || 0);
    } catch (e: any) { console.error(e); }
    finally { setLoading(false); }
  }, [search, page, sortBy, sortOrder]);

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
      <TableCard
        title="제조사/공급사 관리"
        count={total}
        scrollRef={tableBoxRef}
        maxHeight={tableMaxH}
        actions={
          <>
            <input type="text" placeholder="제조사명, 국가, 담당자 검색..." value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="border border-gray-300 dark:border-gray-600 dark:bg-gray-800 rounded-lg px-3 py-1.5 text-sm w-56" />
            {sortBy && (
              <button onClick={resetSort} title="정렬을 원래 순서로 되돌립니다"
                className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
                ↺ 정렬 초기화
              </button>
            )}
            <button onClick={() => { resetForm(); setShowForm(true); }}
              className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              + 제조사 등록
            </button>
          </>
        }
        footer={<Pagination page={page} totalPages={totalPages} onPageChange={setPage} total={total} />}
      >
        <Table fixed columnDividers>
          <colgroup>
            <col className="w-[24%]" />
            <col className="w-[8%]" />
            <col className="w-[12%]" />
            <col className="w-[14%]" />
            <col className="w-[20%]" />
            <col className="w-[22%]" />
          </colgroup>
          <THead>
            <SortableHeader sortKey="name" currentSort={sortBy} order={sortOrder} onSort={handleSort} align="center" className="px-4 py-3 font-medium">제조사/공급사명</SortableHeader>
            <SortableHeader sortKey="country" currentSort={sortBy} order={sortOrder} onSort={handleSort} align="center" className="px-4 py-3 font-medium">국가</SortableHeader>
            <SortableHeader sortKey="contactName" currentSort={sortBy} order={sortOrder} onSort={handleSort} align="center" className="px-4 py-3 font-medium">담당자</SortableHeader>
            <Th align="center">전화</Th>
            <Th align="center">이메일</Th>
            <Th align="center">웹사이트</Th>
          </THead>
          <TBody>
            {loading ? (
              <TableEmpty colSpan={6}>로딩 중...</TableEmpty>
            ) : suppliers.length === 0 ? (
              <TableEmpty colSpan={6}>등록된 제조사가 없습니다.</TableEmpty>
            ) : suppliers.map((s) => (
              <Tr key={s.id} onClick={() => router.push(`${basePath}/${s.id}`)}>
                <Td strong truncate title={s.name}>{s.name}</Td>
                <Td dash truncate title={s.country || undefined}>{s.country}</Td>
                <Td dash truncate title={s.contactName || undefined}>{s.contactName}</Td>
                <Td dash truncate title={s.phone || undefined}>{s.phone}</Td>
                <Td dash truncate title={s.email || undefined}>{s.email}</Td>
                <Td dash truncate title={s.website || undefined}>{s.website}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </TableCard>

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
