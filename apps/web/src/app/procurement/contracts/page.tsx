"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { procurementApi, repairApi, supplierApi } from "@/lib/api";
import SearchableSelect from "@/components/SearchableSelect";
import { DateInput } from "@/components/ui/DateInput";

const STATUS_LABELS: Record<string, string> = { ACTIVE: "진행중", COMPLETED: "완료", CANCELLED: "취소" };
const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-700",
  COMPLETED: "bg-gray-100 text-gray-600",
  CANCELLED: "bg-red-100 text-red-700",
};

function fmtDate(d: string | null) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("ko-KR");
}

export default function ContractsPage() {
  const router = useRouter();
  const [contracts, setContracts] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({
    contractNumber: "", name: "", client: "", clientContact: "",
    manufacturer: "", category: "물품", contractType: "내자",
    contractDate: "", deadline: "", manager: "", notes: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await procurementApi.getContracts({
        search: search || undefined,
        status: statusFilter || undefined,
        page,
      });
      setContracts(res.items);
      setTotal(res.total);
    } catch (e: any) { console.error(e); }
    finally { setLoading(false); }
  }, [search, statusFilter, page]);

  useEffect(() => { load(); }, [load]);

  const resetForm = () => {
    setForm({
      contractNumber: "", name: "", client: "", clientContact: "",
      manufacturer: "", category: "물품", contractType: "내자",
      contractDate: "", deadline: "", manager: "", notes: "",
    });
    setEditing(null);
    setShowForm(false);
  };

  const handleSubmit = async () => {
    try {
      const data: any = { ...form };
      if (!data.contractDate) delete data.contractDate;
      if (!data.deadline) delete data.deadline;
      if (!data.clientContact) delete data.clientContact;
      if (!data.manufacturer) delete data.manufacturer;
      if (!data.manager) delete data.manager;
      if (!data.notes) delete data.notes;

      if (editing) {
        await procurementApi.updateContract(editing.id, data);
      } else {
        await procurementApi.createContract(data);
      }
      resetForm();
      await load();
    } catch (e: any) {
      alert(e.message || "저장 실패");
    }
  };

  const handleEdit = (c: any) => {
    setForm({
      contractNumber: c.contractNumber,
      name: c.name,
      client: c.client || "",
      clientContact: c.clientContact || "",
      manufacturer: c.manufacturer || "",
      category: c.category || "물품",
      contractType: c.contractType || "내자",
      contractDate: c.contractDate ? c.contractDate.split("T")[0] : "",
      deadline: c.deadline ? c.deadline.split("T")[0] : "",
      manager: c.manager || "",
      notes: c.notes || "",
    });
    setEditing(c);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("삭제하시겠습니까?")) return;
    try {
      await procurementApi.deleteContract(id);
      await load();
    } catch (e: any) { alert(e.message || "삭제 실패"); }
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <h2 className="text-lg font-bold">계약 관리</h2>
        <div className="flex bg-gray-100 rounded-lg p-0.5">
          {[{ key: "", label: "전체" }, ...Object.entries(STATUS_LABELS).map(([k, v]) => ({ key: k, label: v }))].map((f) => (
            <button key={f.key} onClick={() => { setStatusFilter(f.key); setPage(1); }}
              className={`px-3 py-1 text-sm rounded-md ${statusFilter === f.key ? "bg-white shadow font-medium" : "text-gray-500"}`}>
              {f.label}
            </button>
          ))}
        </div>
        <input type="text" placeholder="고객사, 계약건명, 제작사 검색..." value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="border rounded-lg px-3 py-1.5 text-sm w-56" />
        <span className="text-sm text-gray-400">{total}건</span>
        <button onClick={() => { resetForm(); setShowForm(true); }}
          className="ml-auto px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          + 계약 등록
        </button>
      </div>

      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-3 py-3 text-left font-medium text-gray-600 w-24">계약번호</th>
              <th className="px-3 py-3 text-left font-medium text-gray-600">고객사</th>
              <th className="px-3 py-3 text-left font-medium text-gray-600">담당</th>
              <th className="px-3 py-3 text-left font-medium text-gray-600">제작사</th>
              <th className="px-3 py-3 text-left font-medium text-gray-600">계약건명</th>
              <th className="px-3 py-3 text-center font-medium text-gray-600 w-16">구분</th>
              <th className="px-3 py-3 text-center font-medium text-gray-600 w-16">내/외자</th>
              <th className="px-3 py-3 text-center font-medium text-gray-600 w-24">계약일</th>
              <th className="px-3 py-3 text-center font-medium text-gray-600 w-24">납기</th>
              <th className="px-3 py-3 text-left font-medium text-gray-600 w-20">담당자</th>
              <th className="px-3 py-3 text-center font-medium text-gray-600 w-20">작업</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={11} className="px-4 py-8 text-center text-gray-400">로딩 중...</td></tr>
            ) : contracts.length === 0 ? (
              <tr><td colSpan={11} className="px-4 py-8 text-center text-gray-400">계약이 없습니다.</td></tr>
            ) : contracts.map((c) => (
              <tr key={c.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => router.push(`/procurement/contracts/${c.id}`)}>
                <td className="px-3 py-2.5 font-mono text-blue-600">{c.contractNumber}</td>
                <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                  {c.client ? (
                    <button onClick={async () => {
                      try {
                        const res = await repairApi.getCustomers({ search: c.client, limit: 1 });
                        const list = res.items || res;
                        const match = list.find((cu: any) => cu.name === c.client);
                        if (match) router.push(`/repair/customers/${match.id}`);
                        else router.push(`/repair/customers?search=${encodeURIComponent(c.client)}`);
                      } catch { router.push(`/repair/customers?search=${encodeURIComponent(c.client)}`); }
                    }} className="text-blue-600 hover:underline">{c.client}</button>
                  ) : "-"}
                </td>
                <td className="px-3 py-2.5 text-gray-500">{c.clientContact || "-"}</td>
                <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                  {c.manufacturer ? (
                    <button onClick={async () => {
                      try {
                        const s = await supplierApi.findByName(c.manufacturer);
                        if (s?.id) router.push(`/procurement/suppliers/${s.id}`);
                        else router.push(`/procurement/suppliers?search=${encodeURIComponent(c.manufacturer)}`);
                      } catch { router.push(`/procurement/suppliers?search=${encodeURIComponent(c.manufacturer)}`); }
                    }} className="text-gray-500 hover:text-blue-600 hover:underline">{c.manufacturer}</button>
                  ) : "-"}
                </td>
                <td className="px-3 py-2.5">{c.name}</td>
                <td className="px-3 py-2.5 text-center">
                  <span className={`text-xs ${c.category === "용역" ? "text-purple-600" : "text-gray-600"}`}>{c.category}</span>
                </td>
                <td className="px-3 py-2.5 text-center">
                  <span className={`text-xs ${c.contractType === "외자" ? "text-orange-600 font-medium" : "text-gray-500"}`}>{c.contractType}</span>
                </td>
                <td className="px-3 py-2.5 text-center text-gray-500 text-xs">{fmtDate(c.contractDate)}</td>
                <td className="px-3 py-2.5 text-center text-gray-500 text-xs">{fmtDate(c.deadline)}</td>
                <td className="px-3 py-2.5 text-gray-600">{c.manager || "-"}</td>
                <td className="px-3 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => handleEdit(c)} className="text-blue-600 hover:underline text-xs mr-2">수정</button>
                  <button onClick={() => handleDelete(c.id)} className="text-red-500 hover:underline text-xs">삭제</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={resetForm}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">{editing ? "계약 수정" : "계약 등록"}</h2>
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">계약번호</label>
                  <input type="text" value={form.contractNumber} onChange={(e) => setForm({ ...form, contractNumber: e.target.value })}
                    placeholder="#26-63"
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">구분</label>
                  <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm">
                    <option value="물품">물품</option>
                    <option value="용역">용역</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">내/외자</label>
                  <select value={form.contractType} onChange={(e) => setForm({ ...form, contractType: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm">
                    <option value="내자">내자</option>
                    <option value="외자">외자</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">고객사 *</label>
                <SearchableSelect
                  value={form.client}
                  onChange={(v) => setForm({ ...form, client: v })}
                  placeholder="고객사 검색..."
                  allowCustom
                  loadOptions={async (q) => {
                    const res = await repairApi.getCustomers({ search: q, limit: 20 });
                    return (res.items || res).map((c: any) => ({ id: c.id, name: c.name, sub: c.businessNo || undefined }));
                  }}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">담당자</label>
                  <input type="text" value={form.clientContact} onChange={(e) => setForm({ ...form, clientContact: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">제작사(공급사)</label>
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
                <label className="block text-sm text-gray-600 mb-1">계약건명(품명) *</label>
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">계약일자</label>
                  <DateInput value={form.contractDate} onChange={(e) => setForm({ ...form, contractDate: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">납기</label>
                  <DateInput value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">계약담당</label>
                <input type="text" value={form.manager} onChange={(e) => setForm({ ...form, manager: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm" />
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
                {editing ? "수정" : "등록"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
