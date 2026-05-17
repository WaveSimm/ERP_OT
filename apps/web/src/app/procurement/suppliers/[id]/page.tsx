"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams, usePathname } from "next/navigation";
import { supplierApi } from "@/lib/api";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "초안", PENDING_APPROVAL: "승인대기", APPROVED: "승인",
  REJECTED: "반려", ORDERED: "승인완료", PURCHASING: "발주완료",
  SHIPPED: "선적 완료", CUSTOMS: "통관중", PARTIALLY_RECEIVED: "부분입고",
  ARRIVED: "입고완료", SETTLEMENT: "송금상태", CLOSED: "마감",
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  PENDING_APPROVAL: "bg-yellow-100 text-yellow-700",
  APPROVED: "bg-green-100 text-green-700",
  REJECTED: "bg-red-100 text-red-700",
  ORDERED: "bg-blue-100 text-blue-700",
  PURCHASING: "bg-sky-100 text-sky-700",
  SHIPPED: "bg-purple-100 text-purple-700",
  CUSTOMS: "bg-orange-100 text-orange-700",
  PARTIALLY_RECEIVED: "bg-amber-100 text-amber-700",
  ARRIVED: "bg-emerald-100 text-emerald-700",
  SETTLEMENT: "bg-cyan-100 text-cyan-700",
  CLOSED: "bg-gray-200 text-gray-600",
};

const CURRENCY_SYMBOLS: Record<string, string> = {
  EUR: "\u20AC", GBP: "\u00A3", USD: "$", KRW: "\u20A9",
};

function fmtAmount(val: string | number, currency?: string) {
  const n = Number(val);
  const sym = currency ? (CURRENCY_SYMBOLS[currency] || currency) : "";
  return `${sym}${n.toLocaleString("ko-KR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function fmtDate(d: string | null) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("ko-KR");
}

export default function SupplierDetailPage() {
  const router = useRouter();
  const params = useParams();
  const pathname = usePathname();
  const basePath = pathname.startsWith("/repair") ? "/repair/suppliers" : "/procurement/suppliers";
  const id = params.id as string;

  const [supplier, setSupplier] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: "", country: "", contactName: "", phone: "", email: "", website: "", address: "", businessNumber: "", notes: "",
  });
  const [showContactForm, setShowContactForm] = useState(false);
  const [editingContact, setEditingContact] = useState<any>(null);
  const [contactForm, setContactForm] = useState({ name: "", position: "", phone: "", email: "", notes: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await supplierApi.get(id);
      setSupplier(data);
      setForm({
        name: data.name || "", country: data.country || "",
        contactName: data.contactName || "", phone: data.phone || "",
        email: data.email || "", website: data.website || "",
        address: data.address || "", businessNumber: data.businessNumber || "", notes: data.notes || "",
      });
    } catch {
      router.push(basePath);
    } finally {
      setLoading(false);
    }
  }, [id, router, basePath]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    try {
      const data: any = {};
      Object.entries(form).forEach(([k, v]) => { if (v) data[k] = v; else data[k] = null; });
      data.name = form.name; // name은 필수
      await supplierApi.update(id, data);
      setEditing(false);
      await load();
    } catch (e: any) {
      alert(e.message || "저장 실패");
    }
  };

  const handleDelete = async () => {
    if (!confirm(`"${supplier.name}"을(를) 삭제하시겠습니까?`)) return;
    try {
      await supplierApi.delete(id);
      router.push(basePath);
    } catch (e: any) {
      alert(e.message || "삭제 실패");
    }
  };

  const resetContactForm = () => {
    setContactForm({ name: "", position: "", phone: "", email: "", notes: "" });
    setEditingContact(null);
    setShowContactForm(false);
  };

  const handleContactSubmit = async () => {
    if (!contactForm.name) return alert("이름은 필수입니다.");
    try {
      const data: any = {};
      Object.entries(contactForm).forEach(([k, v]) => { if (v) data[k] = v; });
      if (editingContact) {
        await supplierApi.updateContact(editingContact.id, data);
      } else {
        await supplierApi.addContact(id, data);
      }
      resetContactForm();
      await load();
    } catch (e: any) { alert(e.message || "저장 실패"); }
  };

  const handleContactEdit = (c: any) => {
    setContactForm({
      name: c.name || "", position: c.position || "",
      phone: c.phone || "", email: c.email || "", notes: c.notes || "",
    });
    setEditingContact(c);
    setShowContactForm(true);
  };

  const handleContactDelete = async (contactId: string) => {
    if (!confirm("담당자를 삭제하시겠습니까?")) return;
    try {
      await supplierApi.deleteContact(contactId);
      await load();
    } catch (e: any) { alert(e.message || "삭제 실패"); }
  };

  if (loading || !supplier) {
    return <div className="flex items-center justify-center h-64 text-gray-400">로딩 중...</div>;
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.push(basePath)} className="text-gray-400 hover:text-gray-600">&larr;</button>
        <div>
          <h1 className="text-xl font-bold">{supplier.name}</h1>
          {supplier.country && <p className="text-sm text-gray-500">{supplier.country}</p>}
        </div>
        <div className="ml-auto flex gap-2">
          {editing ? (
            <>
              <button onClick={() => setEditing(false)} className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50">취소</button>
              <button onClick={handleSave} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">저장</button>
            </>
          ) : (
            <>
              <button onClick={() => setEditing(true)} className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50">수정</button>
              <button onClick={handleDelete} className="px-3 py-1.5 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50">삭제</button>
            </>
          )}
        </div>
      </div>

      {/* 기본 정보 */}
      <div className="bg-white rounded-lg border p-6 mb-4">
        <h3 className="font-medium mb-4">기본 정보</h3>
        {editing ? (
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <label className="block text-gray-500 mb-1">제조사/공급사명 *</label>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-gray-500 mb-1">국가</label>
              <input type="text" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-gray-500 mb-1">담당자</label>
              <input type="text" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-gray-500 mb-1">전화</label>
              <input type="text" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-gray-500 mb-1">이메일</label>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-gray-500 mb-1">웹사이트</label>
              <input type="text" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="col-span-2">
              <label className="block text-gray-500 mb-1">주소</label>
              <input type="text" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-gray-500 mb-1">사업자등록번호</label>
              <input type="text" value={form.businessNumber} onChange={(e) => setForm({ ...form, businessNumber: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="000-00-00000" />
            </div>
            <div className="col-span-2">
              <label className="block text-gray-500 mb-1">비고</label>
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm" rows={2} />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-12 gap-y-4 text-sm">
            <div><span className="text-gray-500">제조사/공급사명:</span> <span className="ml-2 font-medium">{supplier.name}</span></div>
            <div><span className="text-gray-500">국가:</span> <span className="ml-2">{supplier.country || "-"}</span></div>
            <div><span className="text-gray-500">담당자:</span> <span className="ml-2">{supplier.contactName || "-"}</span></div>
            <div><span className="text-gray-500">전화:</span> <span className="ml-2">{supplier.phone || "-"}</span></div>
            <div><span className="text-gray-500">이메일:</span> <span className="ml-2">{supplier.email || "-"}</span></div>
            <div><span className="text-gray-500">웹사이트:</span> {supplier.website ? <a href={supplier.website} target="_blank" rel="noopener noreferrer" className="ml-2 text-blue-600 hover:underline">{supplier.website}</a> : <span className="ml-2">-</span>}</div>
            <div className="col-span-full"><span className="text-gray-500">주소:</span> <span className="ml-2">{supplier.address || "-"}</span></div>
            <div><span className="text-gray-500">사업자등록번호:</span> <span className="ml-2">{supplier.businessNumber || "-"}</span></div>
            {supplier.notes && (
              <div className="col-span-full"><span className="text-gray-500">비고:</span> <span className="ml-2">{supplier.notes}</span></div>
            )}
          </div>
        )}
      </div>

      {/* 담당자 */}
      <div className="bg-white rounded-lg border overflow-hidden mb-4">
        <div className="px-4 py-3 border-b bg-gray-50 flex items-center">
          <h3 className="font-medium">담당자 ({supplier.contacts?.length || 0})</h3>
          <button onClick={() => { resetContactForm(); setShowContactForm(true); }}
            className="ml-auto text-sm text-blue-600 hover:underline">+ 추가</button>
        </div>
        {supplier.contacts?.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium text-gray-600">이름</th>
                <th className="px-4 py-2.5 text-left font-medium text-gray-600">직급</th>
                <th className="px-4 py-2.5 text-left font-medium text-gray-600">전화번호</th>
                <th className="px-4 py-2.5 text-left font-medium text-gray-600">이메일</th>
                <th className="px-4 py-2.5 text-left font-medium text-gray-600">비고</th>
                <th className="px-4 py-2.5 text-center font-medium text-gray-600 w-24">작업</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {supplier.contacts.map((c: any) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium">{c.name}</td>
                  <td className="px-4 py-2.5 text-gray-500">{c.position || "-"}</td>
                  <td className="px-4 py-2.5 text-gray-500">{c.phone || "-"}</td>
                  <td className="px-4 py-2.5 text-gray-500">{c.email || "-"}</td>
                  <td className="px-4 py-2.5 text-gray-400 text-xs">{c.notes || "-"}</td>
                  <td className="px-4 py-2.5 text-center">
                    <button onClick={() => handleContactEdit(c)} className="text-blue-600 hover:underline text-xs mr-2">수정</button>
                    <button onClick={() => handleContactDelete(c.id)} className="text-red-500 hover:underline text-xs">삭제</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="px-4 py-6 text-center text-gray-400 text-sm">등록된 담당자가 없습니다.</div>
        )}
      </div>

      {/* 담당자 추가/수정 모달 */}
      {showContactForm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={resetContactForm}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">{editingContact ? "담당자 수정" : "담당자 추가"}</h2>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">이름 *</label>
                  <input type="text" value={contactForm.name} onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">직급</label>
                  <input type="text" value={contactForm.position} onChange={(e) => setContactForm({ ...contactForm, position: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Manager, Director 등" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">전화번호</label>
                  <input type="text" value={contactForm.phone} onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">이메일</label>
                  <input type="email" value={contactForm.email} onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">비고</label>
                <input type="text" value={contactForm.notes} onChange={(e) => setContactForm({ ...contactForm, notes: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={resetContactForm} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">취소</button>
              <button onClick={handleContactSubmit} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                {editingContact ? "수정" : "추가"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 관련 계약 */}
      {supplier.contracts?.length > 0 && (
        <div className="bg-white rounded-lg border overflow-hidden mb-4">
          <div className="px-4 py-3 border-b bg-gray-50">
            <h3 className="font-medium">관련 계약 ({supplier.contracts.length})</h3>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium text-gray-600">계약번호</th>
                <th className="px-4 py-2.5 text-left font-medium text-gray-600">계약명</th>
                <th className="px-4 py-2.5 text-left font-medium text-gray-600">고객</th>
                <th className="px-4 py-2.5 text-center font-medium text-gray-600">상태</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {supplier.contracts.map((c: any) => (
                <tr key={c.id} onClick={() => router.push(`/procurement/contracts/${c.id}`)} className="hover:bg-gray-50 cursor-pointer">
                  <td className="px-4 py-2.5 font-mono text-blue-600">{c.contractNumber}</td>
                  <td className="px-4 py-2.5">{c.name || "-"}</td>
                  <td className="px-4 py-2.5 text-gray-500">{c.client || "-"}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">{c.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 관련 발주 */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <div className="px-4 py-3 border-b bg-gray-50">
          <h3 className="font-medium">관련 발주 ({supplier.orders?.length || 0})</h3>
        </div>
        {supplier.orders?.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium text-gray-600">발주번호</th>
                <th className="px-4 py-2.5 text-center font-medium text-gray-600">유형</th>
                <th className="px-4 py-2.5 text-left font-medium text-gray-600">계약</th>
                <th className="px-4 py-2.5 text-center font-medium text-gray-600">통화</th>
                <th className="px-4 py-2.5 text-right font-medium text-gray-600">금액</th>
                <th className="px-4 py-2.5 text-center font-medium text-gray-600">상태</th>
                <th className="px-4 py-2.5 text-left font-medium text-gray-600">발주일</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {supplier.orders.map((o: any) => (
                <tr key={o.id} onClick={() => router.push(`/procurement/orders/${o.id}`)} className="hover:bg-gray-50 cursor-pointer">
                  <td className="px-4 py-2.5 font-mono text-blue-600">{o.orderNumber}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      o.orderType === "DUTY_FREE" ? "bg-teal-100 text-teal-700" : "bg-blue-50 text-blue-600"
                    }`}>
                      {o.orderType === "DUTY_FREE" ? "무환" : "유환"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-500">{o.contract?.contractNumber || "-"}</td>
                  <td className="px-4 py-2.5 text-center">{o.currency}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{fmtAmount(o.totalAmount, o.currency)}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[o.status] || ""}`}>
                      {STATUS_LABELS[o.status] || o.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-500">{fmtDate(o.orderDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="px-4 py-8 text-center text-gray-400">관련 발주가 없습니다.</div>
        )}
      </div>
    </div>
  );
}
