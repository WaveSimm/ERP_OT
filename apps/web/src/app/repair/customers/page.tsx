"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { repairApi } from "@/lib/api";

export default function CustomersPage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await repairApi.getCustomers({ search: search || undefined });
      setCustomers(res.items);
      setTotal(res.total);
    } catch {}
    setLoading(false);
  }, [search]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`"${name}" 고객을 삭제하시겠습니까?`)) return;
    try {
      await repairApi.deleteCustomer(id);
      load();
    } catch (e: any) {
      alert(e.message || "삭제 실패");
    }
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <input type="text" placeholder="회사명, 담당자, 전화번호..." value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm w-56 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <span className="text-xs text-gray-400">총 {total}건</span>
        <div className="ml-auto">
          <button onClick={() => { setEditTarget(null); setShowForm(true); }}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700">
            + 고객 추가
          </button>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500">회사명</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500">담당자</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500">연락처</th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500">보유자산</th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500">AS건수</th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500">작업</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="text-center py-8 text-gray-400">불러오는 중...</td></tr>}
            {!loading && customers.length === 0 && <tr><td colSpan={6} className="text-center py-8 text-gray-400">등록된 고객이 없습니다.</td></tr>}
            {!loading && customers.map((c) => (
              <tr key={c.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-2 font-medium text-gray-800 cursor-pointer hover:text-blue-600"
                  onClick={() => router.push(`/repair/customers/${c.id}`)}>
                  {c.name}
                </td>
                <td className="px-3 py-2 text-gray-600">{c.contactPerson || "-"}{c.department ? ` (${c.department})` : ""}</td>
                <td className="px-3 py-2 text-gray-500 text-xs">{c.phone || c.email || "-"}</td>
                <td className="px-3 py-2 text-center text-gray-600">{c._count?.assets ?? 0}</td>
                <td className="px-3 py-2 text-center text-gray-600">{c._count?.repairOrders ?? 0}</td>
                <td className="px-3 py-2 text-center">
                  <button onClick={() => { setEditTarget(c); setShowForm(true); }}
                    className="text-xs text-blue-600 hover:underline mr-2">수정</button>
                  <button onClick={() => handleDelete(c.id, c.name)}
                    className="text-xs text-red-500 hover:underline">삭제</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <CustomerForm
          initial={editTarget}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); load(); }}
        />
      )}
    </div>
  );
}

function CustomerForm({ initial, onClose, onSaved }: { initial: any; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: initial?.name || "",
    contactPerson: initial?.contactPerson || "",
    department: initial?.department || "",
    phone: initial?.phone || "",
    email: initial?.email || "",
    address: initial?.address || "",
    notes: initial?.notes || "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setError("회사명을 입력하세요."); return; }
    setSaving(true);
    setError("");
    try {
      if (initial) {
        await repairApi.updateCustomer(initial.id, form);
      } else {
        await repairApi.createCustomer(form);
      }
      onSaved();
    } catch (e: any) {
      setError(e.message || "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">{initial ? "고객 수정" : "고객 추가"}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">회사명 *</label>
            <input type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" required autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">담당자</label>
              <input type="text" value={form.contactPerson} onChange={(e) => setForm((f) => ({ ...f, contactPerson: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">부서</label>
              <input type="text" value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">전화번호</label>
              <input type="text" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">이메일</label>
              <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">주소</label>
            <input type="text" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">취소</button>
            <button type="submit" disabled={saving} className="flex-1 bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
              {saving ? "저장 중..." : "저장"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
