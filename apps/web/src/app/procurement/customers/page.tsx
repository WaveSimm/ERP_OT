"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { repairApi } from "@/lib/api";
import Pagination from "@/components/Pagination";

export default function CustomersPage() {
  const router = useRouter();
  const pathname = usePathname();
  const basePath = pathname.startsWith("/repair") ? "/repair/customers" : "/procurement/customers";
  const [customers, setCustomers] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({
    name: "", businessNo: "", phone: "", email: "", address: "", notes: "",
  });
  // 담당자
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [contacts, setContacts] = useState<any[]>([]);
  const [contactForm, setContactForm] = useState({ name: "", department: "", position: "", phone: "", email: "", isPrimary: false });
  const [showContactForm, setShowContactForm] = useState(false);
  const [editingContact, setEditingContact] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await repairApi.getCustomers({ search: search || undefined, page, limit: 50 });
      setCustomers(res.items || res);
      setTotal(res.total || (res.items || res).length);
    } catch (e: any) { console.error(e); }
    finally { setLoading(false); }
  }, [search, page]);

  useEffect(() => { load(); }, [load]);

  const resetForm = () => {
    setForm({ name: "", businessNo: "", phone: "", email: "", address: "", notes: "" });
    setEditing(null);
    setShowForm(false);
  };

  const handleSubmit = async () => {
    try {
      const data: any = {};
      Object.entries(form).forEach(([k, v]) => { if (v) data[k] = v; });
      if (editing) {
        await repairApi.updateCustomer(editing.id, data);
      } else {
        await repairApi.createCustomer(data);
      }
      resetForm();
      await load();
    } catch (e: any) { alert(e.message || "저장 실패"); }
  };

  const handleEdit = (c: any) => {
    setForm({
      name: c.name || "",
      businessNo: c.businessNo || "",
      phone: c.phone || "",
      email: c.email || "",
      address: c.address || "",
      notes: c.notes || "",
    });
    setEditing(c);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("삭제하시겠습니까?")) return;
    try {
      await repairApi.deleteCustomer(id);
      if (expandedId === id) setExpandedId(null);
      await load();
    } catch (e: any) { alert(e.message || "삭제 실패"); }
  };

  // 담당자
  const toggleContacts = async (id: string) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    setShowContactForm(false);
    setEditingContact(null);
    try {
      const res = await repairApi.getContacts(id);
      setContacts(res);
    } catch { setContacts([]); }
  };

  const resetContactForm = () => {
    setContactForm({ name: "", department: "", position: "", phone: "", email: "", isPrimary: false });
    setEditingContact(null);
    setShowContactForm(false);
  };

  const handleContactSubmit = async () => {
    if (!expandedId) return;
    try {
      const data: any = {};
      Object.entries(contactForm).forEach(([k, v]) => { if (v !== "" && v !== false) data[k] = v; });
      if (editingContact) {
        await repairApi.updateContact(editingContact.id, data);
      } else {
        await repairApi.createContact(expandedId, data);
      }
      resetContactForm();
      const res = await repairApi.getContacts(expandedId);
      setContacts(res);
    } catch (e: any) { alert(e.message || "저장 실패"); }
  };

  const handleContactEdit = (ct: any) => {
    setContactForm({
      name: ct.name || "", department: ct.department || "", position: ct.position || "",
      phone: ct.phone || "", email: ct.email || "", isPrimary: ct.isPrimary || false,
    });
    setEditingContact(ct);
    setShowContactForm(true);
  };

  const handleContactDelete = async (contactId: string) => {
    if (!expandedId || !confirm("삭제하시겠습니까?")) return;
    try {
      await repairApi.deleteContact(contactId);
      const res = await repairApi.getContacts(expandedId);
      setContacts(res);
    } catch (e: any) { alert(e.message || "삭제 실패"); }
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <h2 className="text-lg font-bold">고객사 관리</h2>
        <input type="text" placeholder="고객사명 검색..." value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="border rounded-lg px-3 py-1.5 text-sm w-56" />
        <span className="text-sm text-gray-400">{total}건</span>
        <button onClick={() => { resetForm(); setShowForm(true); }}
          className="ml-auto px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          + 고객사 등록
        </button>
      </div>

      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600">고객사명</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">사업자번호</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">전화</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">이메일</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">주소</th>
              <th className="px-4 py-3 text-center font-medium text-gray-600">보유자산</th>
              <th className="px-4 py-3 text-center font-medium text-gray-600">AS건수</th>
              <th className="px-4 py-3 text-center font-medium text-gray-600 w-40">작업</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">로딩 중...</td></tr>
            ) : customers.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">고객사가 없습니다.</td></tr>
            ) : customers.map((c) => (
              <>
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium cursor-pointer hover:text-blue-600"
                    onClick={() => router.push(`${basePath}/${c.id}`)}>{c.name}</td>
                  <td className="px-4 py-2.5 text-gray-500 font-mono">{c.businessNo || "-"}</td>
                  <td className="px-4 py-2.5 text-gray-500">{c.phone || "-"}</td>
                  <td className="px-4 py-2.5 text-gray-500">{c.email || "-"}</td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs">{c.address || "-"}</td>
                  <td className="px-4 py-2.5 text-center text-gray-600">{c._count?.assets ?? 0}</td>
                  <td className="px-4 py-2.5 text-center text-gray-600">{c._count?.repairOrders ?? 0}</td>
                  <td className="px-4 py-2.5 text-center">
                    <button onClick={() => toggleContacts(c.id)} className="text-blue-600 hover:underline text-xs mr-2">
                      {expandedId === c.id ? "접기" : "담당자"}
                    </button>
                    <button onClick={() => handleEdit(c)} className="text-blue-600 hover:underline text-xs mr-2">수정</button>
                    <button onClick={() => handleDelete(c.id)} className="text-red-500 hover:underline text-xs">삭제</button>
                  </td>
                </tr>
                {expandedId === c.id && (
                  <tr key={`${c.id}-contacts`}>
                    <td colSpan={8} className="bg-gray-50 px-6 py-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-sm font-medium text-gray-700">담당자 목록</span>
                        <button onClick={() => { resetContactForm(); setShowContactForm(true); }}
                          className="text-xs text-blue-600 hover:underline">+ 추가</button>
                      </div>
                      {contacts.length === 0 ? (
                        <p className="text-xs text-gray-400">등록된 담당자가 없습니다.</p>
                      ) : (
                        <div className="space-y-1">
                          {contacts.map((ct) => (
                            <div key={ct.id} className="flex items-center gap-3 text-sm bg-white rounded px-3 py-2 border">
                              <span className="font-medium">{ct.name}</span>
                              {ct.isPrimary && <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">주담당</span>}
                              <span className="text-gray-400 text-xs">{ct.department || ""} {ct.position || ""}</span>
                              <span className="text-gray-500 text-xs">{ct.phone || ""}</span>
                              <span className="text-gray-500 text-xs">{ct.email || ""}</span>
                              <div className="ml-auto flex gap-2">
                                <button onClick={() => handleContactEdit(ct)} className="text-blue-600 hover:underline text-xs">수정</button>
                                <button onClick={() => handleContactDelete(ct.id)} className="text-red-500 hover:underline text-xs">삭제</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {showContactForm && (
                        <div className="mt-3 bg-white rounded-lg border p-4">
                          <h4 className="text-sm font-medium mb-2">{editingContact ? "담당자 수정" : "담당자 추가"}</h4>
                          <div className="grid grid-cols-3 gap-3 mb-3">
                            <input placeholder="이름 *" value={contactForm.name} onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                              className="border rounded px-2 py-1.5 text-sm" />
                            <input placeholder="부서" value={contactForm.department} onChange={(e) => setContactForm({ ...contactForm, department: e.target.value })}
                              className="border rounded px-2 py-1.5 text-sm" />
                            <input placeholder="직위" value={contactForm.position} onChange={(e) => setContactForm({ ...contactForm, position: e.target.value })}
                              className="border rounded px-2 py-1.5 text-sm" />
                            <input placeholder="전화" value={contactForm.phone} onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })}
                              className="border rounded px-2 py-1.5 text-sm" />
                            <input placeholder="이메일" value={contactForm.email} onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                              className="border rounded px-2 py-1.5 text-sm" />
                            <label className="flex items-center gap-1 text-sm">
                              <input type="checkbox" checked={contactForm.isPrimary} onChange={(e) => setContactForm({ ...contactForm, isPrimary: e.target.checked })} />
                              주담당자
                            </label>
                          </div>
                          <div className="flex gap-2">
                            <button onClick={handleContactSubmit} className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
                              {editingContact ? "수정" : "추가"}
                            </button>
                            <button onClick={resetContactForm} className="px-3 py-1 text-sm border rounded hover:bg-gray-50">취소</button>
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={Math.ceil(total / 50)} onPageChange={setPage} total={total} className="mt-4 border rounded-lg" />

      {/* 고객사 등록/수정 Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={resetForm}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">{editing ? "고객사 수정" : "고객사 등록"}</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">고객사명 *</label>
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">사업자번호</label>
                  <input type="text" value={form.businessNo} onChange={(e) => setForm({ ...form, businessNo: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">대표전화</label>
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
                <label className="block text-sm text-gray-600 mb-1">주소</label>
                <input type="text" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })}
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
