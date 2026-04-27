"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter, usePathname } from "next/navigation";
import { repairApi, supplierApi } from "@/lib/api";
import SearchableSelect from "@/components/SearchableSelect";

const STATUS_LABELS: Record<string, string> = {
  RECEIVED: "접수", INSPECTING_1ST: "1차점검", QUOTED: "견적발행", APPROVED: "승인",
  REPAIRING: "수리중", SHIPPED_TO_MFG: "제조사로 발송", RECEIVED_FROM_MFG: "본사 입고",
  NO_FAULT: "정상", NO_REPAIR: "수리안함",
  INSPECTING_2ND: "2차점검", COMPLETED: "완료", CLOSED: "종료", CANCELLED: "취소",
};

export default function CustomerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const pathname = usePathname();
  const basePath = pathname.startsWith("/repair") ? "/repair/customers" : "/procurement/customers";
  const id = params.id as string;

  const [customer, setCustomer] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showAssetForm, setShowAssetForm] = useState(false);
  const [editingAsset, setEditingAsset] = useState<any>(null);
  const [showContactForm, setShowContactForm] = useState(false);
  const [editingContact, setEditingContact] = useState<any>(null);

  const load = useCallback(async () => {
    try {
      setCustomer(await repairApi.getCustomer(id));
    } catch {}
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="py-12 text-center text-gray-400">불러오는 중...</div>;
  if (!customer) return <div className="py-12 text-center text-gray-400">고객사를 찾을 수 없습니다.</div>;

  return (
    <div className="space-y-6">
      <button onClick={() => router.push(basePath)} className="text-sm text-gray-500 hover:text-gray-700">&larr; 고객사 목록</button>

      {/* 회사 대표정보 */}
      <CompanyInfoSection customer={customer} onReload={load} />

      {/* 담당자 */}
      <ContactsSection
        contacts={customer.contacts || []}
        onAdd={() => { setEditingContact(null); setShowContactForm(true); }}
        onEdit={(c: any) => { setEditingContact(c); setShowContactForm(true); }}
        onDelete={async (contactId: string) => {
          if (!confirm("담당자를 삭제하시겠습니까?")) return;
          try { await repairApi.deleteContact(contactId); load(); } catch {}
        }}
      />

      {/* 보유 자산 */}
      <AssetsSection
        customer={customer}
        onAdd={() => { setEditingAsset(null); setShowAssetForm(true); }}
        onEdit={(a: any) => { setEditingAsset(a); setShowAssetForm(true); }}
        onDelete={async (assetId: string) => {
          if (!confirm("자산을 삭제하시겠습니까?")) return;
          try { await repairApi.deleteCustomerAsset(assetId); load(); } catch (e: any) { alert(e.message || "삭제 실패"); }
        }}
      />

      {/* AS 이력 */}
      <RepairHistorySection customer={customer} />

      {/* 자산 추가/수정 모달 */}
      {showAssetForm && (
        <AssetForm
          customerId={id}
          asset={editingAsset}
          onClose={() => { setShowAssetForm(false); setEditingAsset(null); }}
          onSaved={() => { setShowAssetForm(false); setEditingAsset(null); load(); }}
        />
      )}

      {/* 담당자 추가/수정 모달 */}
      {showContactForm && (
        <ContactForm
          customerId={id}
          contact={editingContact}
          onClose={() => setShowContactForm(false)}
          onSaved={() => { setShowContactForm(false); load(); }}
        />
      )}
    </div>
  );
}

// ─── 회사 대표정보 ──────────────────────────────────────────────────────

function CompanyInfoSection({ customer, onReload }: { customer: any; onReload: () => void }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: customer.name || "",
    businessNo: customer.businessNo || "",
    phone: customer.phone || "",
    address: customer.address || "",
    address2: customer.address2 || "",
    notes: customer.notes || "",
  });
  const [saving, setSaving] = useState(false);

  const set = (f: string, v: string) => setForm((prev) => ({ ...prev, [f]: v }));

  const save = async () => {
    setSaving(true);
    try {
      await repairApi.updateCustomer(customer.id, {
        name: form.name,
        businessNo: form.businessNo || null,
        phone: form.phone || null,
        address: form.address || null,
        address2: form.address2 || null,
        notes: form.notes || null,
      });
      setEditing(false);
      onReload();
    } catch (e: any) {
      alert(e.message || "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setForm({
      name: customer.name || "",
      businessNo: customer.businessNo || "",
      phone: customer.phone || "",
      address: customer.address || "",
      address2: customer.address2 || "",
      notes: customer.notes || "",
    });
    setEditing(false);
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-800">회사 대표정보</h3>
        {!editing ? (
          <button onClick={() => setEditing(true)} className="text-xs text-blue-600 hover:text-blue-800 font-medium">수정</button>
        ) : (
          <div className="flex gap-2">
            <button onClick={cancel} className="text-xs text-gray-500 hover:text-gray-700">취소</button>
            <button onClick={save} disabled={saving} className="text-xs text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50">
              {saving ? "저장 중..." : "저장"}
            </button>
          </div>
        )}
      </div>

      {!editing ? (
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><span className="text-gray-500">회사명: </span><span className="font-medium">{customer.name}</span></div>
          <div><span className="text-gray-500">사업자등록번호: </span>{customer.businessNo || "-"}</div>
          <div><span className="text-gray-500">대표전화: </span>{customer.phone || "-"}</div>
          <div className="col-span-2"><span className="text-gray-500">대표주소: </span>{customer.address || "-"}</div>
          <div className="col-span-2"><span className="text-gray-500">2차 주소: </span>{customer.address2 || "-"}</div>
          {customer.notes && <div className="col-span-2"><span className="text-gray-500">비고: </span>{customer.notes}</div>}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">회사명 *</label>
            <input type="text" value={form.name} onChange={(e) => set("name", e.target.value)}
              className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm" required />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">사업자등록번호</label>
            <input type="text" value={form.businessNo} onChange={(e) => set("businessNo", e.target.value)}
              className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm" placeholder="000-00-00000" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">대표전화번호</label>
            <input type="text" value={form.phone} onChange={(e) => set("phone", e.target.value)}
              className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div />
          <div className="col-span-2">
            <label className="block text-xs text-gray-500 mb-1">대표주소</label>
            <input type="text" value={form.address} onChange={(e) => set("address", e.target.value)}
              className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-gray-500 mb-1">2차 주소</label>
            <input type="text" value={form.address2} onChange={(e) => set("address2", e.target.value)}
              className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-gray-500 mb-1">비고</label>
            <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2}
              className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm resize-none" />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 담당자 영역 ────────────────────────────────────────────────────────

function ContactsSection({ contacts, onAdd, onEdit, onDelete }: {
  contacts: any[];
  onAdd: () => void;
  onEdit: (c: any) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-800">담당자 ({contacts.length})</h3>
        <button onClick={onAdd}
          className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          + 담당자 추가
        </button>
      </div>
      {contacts.length > 0 ? (
        <table className="w-full text-sm">
          <colgroup>
            <col style={{ width: "10%" }} />
            <col style={{ width: "16%" }} />
            <col />
            <col style={{ width: "11%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "6%" }} />
            <col style={{ width: "8%" }} />
          </colgroup>
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 text-xs text-gray-500">이름</th>
              <th className="text-left py-2 text-xs text-gray-500">부서</th>
              <th className="text-left py-2 text-xs text-gray-500">직위</th>
              <th className="text-left py-2 text-xs text-gray-500 whitespace-nowrap">전화</th>
              <th className="text-left py-2 text-xs text-gray-500">이메일</th>
              <th className="text-center py-2 text-xs text-gray-500 whitespace-nowrap">주담당</th>
              <th className="text-right py-2 text-xs text-gray-500"></th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((c: any) => (
              <tr key={c.id} className="border-t border-gray-100">
                <td className="py-2 font-medium break-keep">{c.name}</td>
                <td className="py-2 text-gray-600 break-keep">{c.department || "-"}</td>
                <td className="py-2 text-gray-600">{c.position || "-"}</td>
                <td className="py-2 text-gray-600 whitespace-nowrap">{c.phone || "-"}</td>
                <td className="py-2 text-gray-600 break-all">{c.email || "-"}</td>
                <td className="py-2 text-center">
                  {c.isPrimary && <span className="inline-block px-1.5 py-0.5 bg-blue-100 text-blue-700 text-[10px] rounded font-medium whitespace-nowrap">주담당</span>}
                </td>
                <td className="py-2 text-right whitespace-nowrap">
                  <button onClick={() => onEdit(c)} className="text-xs text-gray-400 hover:text-blue-600 mr-2">수정</button>
                  <button onClick={() => onDelete(c.id)} className="text-xs text-gray-400 hover:text-red-600">삭제</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-sm text-gray-400">등록된 담당자가 없습니다.</p>
      )}
    </div>
  );
}

// ─── 담당자 추가/수정 모달 ──────────────────────────────────────────────

function ContactForm({ customerId, contact, onClose, onSaved }: {
  customerId: string;
  contact: any | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!contact;
  const [form, setForm] = useState({
    name: contact?.name || "",
    department: contact?.department || "",
    position: contact?.position || "",
    phone: contact?.phone || "",
    email: contact?.email || "",
    isPrimary: contact?.isPrimary || false,
    notes: contact?.notes || "",
  });
  const [saving, setSaving] = useState(false);

  const set = (f: string, v: any) => setForm((prev) => ({ ...prev, [f]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (isEdit) {
        await repairApi.updateContact(contact.id, form);
      } else {
        await repairApi.createContact(customerId, form);
      }
      onSaved();
    } catch (e: any) {
      alert(e.message || "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">{isEdit ? "담당자 수정" : "담당자 추가"}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">이름 *</label>
            <input type="text" value={form.name} onChange={(e) => set("name", e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">부서</label>
              <input type="text" value={form.department} onChange={(e) => set("department", e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">직위</label>
              <input type="text" value={form.position} onChange={(e) => set("position", e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">전화</label>
              <input type="text" value={form.phone} onChange={(e) => set("phone", e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">이메일</label>
              <input type="email" value={form.email} onChange={(e) => set("email", e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" checked={form.isPrimary} onChange={(e) => set("isPrimary", e.target.checked)}
              className="rounded border-gray-300" id="isPrimary" />
            <label htmlFor="isPrimary" className="text-sm text-gray-700">주담당자</label>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">비고</label>
            <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none" />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">취소</button>
            <button type="submit" disabled={saving} className="flex-1 bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
              {saving ? "저장 중..." : isEdit ? "수정" : "추가"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── 보유 자산 ──────────────────────────────────────────────────────────

function AssetsSection({ customer, onAdd, onEdit, onDelete }: {
  customer: any;
  onAdd: () => void;
  onEdit: (a: any) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-800">보유 자산 ({customer.assets?.length || 0})</h3>
        <button onClick={onAdd}
          className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          + 자산 추가
        </button>
      </div>
      {customer.assets?.length > 0 ? (
        <table className="w-full text-sm">
          <colgroup>
            <col style={{ width: "8%" }} />
            <col />
            <col style={{ width: "18%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "14%" }} />
            <col style={{ width: "8%" }} />
          </colgroup>
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 text-xs text-gray-500 whitespace-nowrap">유형</th>
              <th className="text-left py-2 text-xs text-gray-500">이름</th>
              <th className="text-left py-2 text-xs text-gray-500">제작사</th>
              <th className="text-left py-2 text-xs text-gray-500 whitespace-nowrap">S.N</th>
              <th className="text-left py-2 text-xs text-gray-500 whitespace-nowrap">OT재고NO</th>
              <th className="text-right py-2 text-xs text-gray-500"></th>
            </tr>
          </thead>
          <tbody>
            {customer.assets.map((a: any) => (
              <tr key={a.id} className="border-t border-gray-100">
                <td className="py-2 whitespace-nowrap">{a.assetType === "EQUIPMENT" ? "장비" : "센서"}</td>
                <td className="py-2 font-medium break-keep">{a.name}</td>
                <td className="py-2 text-gray-600 break-keep">{a.manufacturer || "-"}</td>
                <td className="py-2 text-gray-500 break-all">{a.serialNumber || "-"}</td>
                <td className="py-2 text-gray-500 break-all">{a.otInventoryNo || "-"}</td>
                <td className="py-2 text-right whitespace-nowrap">
                  <button onClick={() => onEdit(a)} className="text-xs text-gray-400 hover:text-blue-600 mr-2">수정</button>
                  <button onClick={() => onDelete(a.id)} className="text-xs text-gray-400 hover:text-red-600">삭제</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-sm text-gray-400">등록된 자산이 없습니다.</p>
      )}
    </div>
  );
}

// ─── AS 이력 ────────────────────────────────────────────────────────────

function RepairHistorySection({ customer }: { customer: any }) {
  const router = useRouter();

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5">
      <h3 className="font-semibold text-gray-800 mb-3">AS 이력 ({customer.repairOrders?.length || 0})</h3>
      {customer.repairOrders?.length > 0 ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 text-xs text-gray-500">접수번호</th>
              <th className="text-left py-2 text-xs text-gray-500">장비</th>
              <th className="text-left py-2 text-xs text-gray-500">증상</th>
              <th className="text-center py-2 text-xs text-gray-500">상태</th>
              <th className="text-center py-2 text-xs text-gray-500">접수일</th>
            </tr>
          </thead>
          <tbody>
            {customer.repairOrders.map((o: any) => (
              <tr key={o.id} className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer"
                onClick={() => router.push(`/repair/${o.id}`)}>
                <td className="py-2 text-blue-600 font-medium">{o.orderNumber}</td>
                <td className="py-2">{o.customerAsset?.name || "-"}</td>
                <td className="py-2 text-gray-600 truncate max-w-[200px]">{o.symptom || "-"}</td>
                <td className="py-2 text-center text-xs">{STATUS_LABELS[o.status] || o.status}</td>
                <td className="py-2 text-center text-xs text-gray-500">{new Date(o.receivedAt).toLocaleDateString("ko-KR")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-sm text-gray-400">AS 이력이 없습니다.</p>
      )}
    </div>
  );
}

// ─── 자산 추가 모달 ─────────────────────────────────────────────────────

function AssetForm({ customerId, asset, onClose, onSaved }: {
  customerId: string;
  asset?: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!asset?.id;
  const [form, setForm] = useState({
    assetType: asset?.assetType || "EQUIPMENT",
    name: asset?.name || "",
    serialNumber: asset?.serialNumber || "",
    manufacturer: asset?.manufacturer || "",
    model: asset?.model || "",
    otInventoryNo: asset?.otInventoryNo || "",
  });
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (isEdit) {
        await repairApi.updateCustomerAsset(asset.id, form);
      } else {
        await repairApi.createCustomerAsset({ customerId, ...form });
      }
      onSaved();
    } catch (e: any) {
      alert(e.message || (isEdit ? "수정 실패" : "추가 실패"));
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">{isEdit ? "자산 수정" : "자산 추가"}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">유형</label>
            <select value={form.assetType} onChange={(e) => setForm((f) => ({ ...f, assetType: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="EQUIPMENT">장비</option>
              <option value="SENSOR">센서</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">이름 (제품명) *</label>
            <input type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">제작사</label>
              <SearchableSelect
                value={form.manufacturer}
                onChange={(v) => setForm((f) => ({ ...f, manufacturer: v }))}
                placeholder="제조사 검색..."
                allowCustom
                loadOptions={async (q) => {
                  const res = await supplierApi.list({ search: q, limit: 20 });
                  return (res.items || []).map((s: any) => ({ id: s.id, name: s.name, sub: s.country || undefined }));
                }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">모델</label>
              <input type="text" value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">시리얼 번호</label>
              <input type="text" value={form.serialNumber} onChange={(e) => setForm((f) => ({ ...f, serialNumber: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">OT재고NO</label>
              <input type="text" value={form.otInventoryNo} onChange={(e) => setForm((f) => ({ ...f, otInventoryNo: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">취소</button>
            <button type="submit" disabled={saving} className="flex-1 bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
              {saving ? (isEdit ? "수정 중..." : "추가 중...") : (isEdit ? "수정" : "추가")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
