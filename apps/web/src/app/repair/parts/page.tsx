"use client";

import { useState, useEffect, useCallback } from "react";
import { repairApi, supplierApi } from "@/lib/api";
import SearchableSelect from "@/components/SearchableSelect";

export default function PartsPage() {
  const [parts, setParts] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [lowStock, setLowStock] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [showTxForm, setShowTxForm] = useState(false);
  const [txForm, setTxForm] = useState({ partId: "", type: "IN", quantity: "", reason: "", performedBy: "" });
  const [form, setForm] = useState({
    partNumber: "", name: "", manufacturer: "", category: "",
    unitPrice: "", stockQuantity: "0", minStockLevel: "0",
    leadTimeDays: "", location: "", notes: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await repairApi.getParts({ search: search || undefined, lowStock });
      setParts(res.items || []);
    } catch {}
    setLoading(false);
  }, [search, lowStock]);

  useEffect(() => { load(); }, [load]);

  const savePart = async () => {
    if (!form.partNumber || !form.name) return alert("부품번호와 이름은 필수입니다.");
    try {
      if (selected) {
        await repairApi.updatePart(selected.id, {
          ...form,
          unitPrice: form.unitPrice ? parseFloat(form.unitPrice) : undefined,
          stockQuantity: parseInt(form.stockQuantity) || 0,
          minStockLevel: parseInt(form.minStockLevel) || 0,
          leadTimeDays: form.leadTimeDays ? parseInt(form.leadTimeDays) : undefined,
        });
      } else {
        await repairApi.createPart({
          ...form,
          unitPrice: form.unitPrice ? parseFloat(form.unitPrice) : undefined,
          stockQuantity: parseInt(form.stockQuantity) || 0,
          minStockLevel: parseInt(form.minStockLevel) || 0,
          leadTimeDays: form.leadTimeDays ? parseInt(form.leadTimeDays) : undefined,
        });
      }
      await load();
      resetForm();
    } catch (e: any) { alert(e.message || "저장 실패"); }
  };

  const deletePart = async (id: string) => {
    if (!confirm("부품을 삭제하시겠습니까?")) return;
    try { await repairApi.deletePart(id); await load(); } catch (e: any) { alert(e.message || "삭제 실패"); }
  };

  const editPart = (p: any) => {
    setSelected(p);
    setForm({
      partNumber: p.partNumber, name: p.name, manufacturer: p.manufacturer || "",
      category: p.category || "", unitPrice: p.unitPrice ? String(p.unitPrice) : "",
      stockQuantity: String(p.stockQuantity), minStockLevel: String(p.minStockLevel),
      leadTimeDays: p.leadTimeDays ? String(p.leadTimeDays) : "", location: p.location || "", notes: p.notes || "",
    });
    setShowForm(true);
  };

  const resetForm = () => {
    setShowForm(false);
    setSelected(null);
    setForm({ partNumber: "", name: "", manufacturer: "", category: "", unitPrice: "", stockQuantity: "0", minStockLevel: "0", leadTimeDays: "", location: "", notes: "" });
  };

  const saveTx = async () => {
    if (!txForm.partId || !txForm.quantity) return alert("부품과 수량을 입력해주세요.");
    try {
      await repairApi.createPartTransaction({
        partId: txForm.partId,
        type: txForm.type,
        quantity: parseInt(txForm.quantity),
        reason: txForm.reason || undefined,
        performedBy: txForm.performedBy || undefined,
      });
      await load();
      setShowTxForm(false);
      setTxForm({ partId: "", type: "IN", quantity: "", reason: "", performedBy: "" });
    } catch (e: any) { alert(e.message || "저장 실패"); }
  };

  return (
    <div className="space-y-4">
      {/* 검색/필터 */}
      <div className="flex items-center gap-3">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="부품번호, 이름, 제조사 검색"
          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        <label className="flex items-center gap-1 text-sm text-gray-600">
          <input type="checkbox" checked={lowStock} onChange={(e) => setLowStock(e.target.checked)}
            className="rounded border-gray-300" />
          재고 부족
        </label>
        <button onClick={() => { resetForm(); setShowForm(true); }}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700">+ 부품 등록</button>
        <button onClick={() => setShowTxForm(!showTxForm)}
          className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">입출고</button>
      </div>

      {/* 입출고 폼 */}
      {showTxForm && (
        <div className="bg-white border border-blue-200 rounded-lg p-4 space-y-2">
          <h3 className="text-sm font-semibold text-gray-800">부품 입출고</h3>
          <div className="grid grid-cols-5 gap-2">
            <select value={txForm.partId} onChange={(e) => setTxForm({ ...txForm, partId: e.target.value })}
              className="px-2 py-1.5 border border-gray-300 rounded text-sm">
              <option value="">부품 선택</option>
              {parts.map((p) => <option key={p.id} value={p.id}>{p.partNumber} - {p.name}</option>)}
            </select>
            <select value={txForm.type} onChange={(e) => setTxForm({ ...txForm, type: e.target.value })}
              className="px-2 py-1.5 border border-gray-300 rounded text-sm">
              <option value="IN">입고</option>
              <option value="OUT">출고</option>
              <option value="ADJUST">조정</option>
            </select>
            <input type="number" value={txForm.quantity} onChange={(e) => setTxForm({ ...txForm, quantity: e.target.value })}
              placeholder="수량" className="px-2 py-1.5 border border-gray-300 rounded text-sm" />
            <input value={txForm.reason} onChange={(e) => setTxForm({ ...txForm, reason: e.target.value })}
              placeholder="사유" className="px-2 py-1.5 border border-gray-300 rounded text-sm" />
            <button onClick={saveTx} className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-semibold">저장</button>
          </div>
        </div>
      )}

      {/* 부품 등록/수정 폼 */}
      {showForm && (
        <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-800">{selected ? "부품 수정" : "부품 등록"}</h3>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">부품번호 *</label>
              <input value={form.partNumber} onChange={(e) => setForm({ ...form, partNumber: e.target.value })}
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">이름 *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">제조사</label>
              <SearchableSelect
                value={form.manufacturer}
                onChange={(v) => setForm({ ...form, manufacturer: v })}
                placeholder="제조사 검색..."
                allowCustom
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                loadOptions={async (q) => {
                  const res = await supplierApi.list({ search: q, limit: 20 });
                  return (res.items || []).map((s: any) => ({ id: s.id, name: s.name, sub: s.country || undefined }));
                }}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">카테고리</label>
              <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">단가</label>
              <input type="number" value={form.unitPrice} onChange={(e) => setForm({ ...form, unitPrice: e.target.value })}
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">재고</label>
              <input type="number" value={form.stockQuantity} onChange={(e) => setForm({ ...form, stockQuantity: e.target.value })}
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">최소 재고</label>
              <input type="number" value={form.minStockLevel} onChange={(e) => setForm({ ...form, minStockLevel: e.target.value })}
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">조달 소요일</label>
              <input type="number" value={form.leadTimeDays} onChange={(e) => setForm({ ...form, leadTimeDays: e.target.value })}
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">보관 위치</label>
              <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })}
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={savePart} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700">저장</button>
            <button onClick={resetForm} className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">취소</button>
          </div>
        </div>
      )}

      {/* 부품 목록 */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {loading ? (
          <div className="py-8 text-center text-gray-400">불러오는 중...</div>
        ) : parts.length === 0 ? (
          <div className="py-8 text-center text-gray-400">등록된 부품이 없습니다.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="py-2 px-3 text-left text-xs text-gray-500">부품번호</th>
                <th className="py-2 px-3 text-left text-xs text-gray-500">이름</th>
                <th className="py-2 px-3 text-left text-xs text-gray-500">제조사</th>
                <th className="py-2 px-3 text-right text-xs text-gray-500">단가</th>
                <th className="py-2 px-3 text-right text-xs text-gray-500">재고</th>
                <th className="py-2 px-3 text-right text-xs text-gray-500">최소</th>
                <th className="py-2 px-3 text-left text-xs text-gray-500">위치</th>
                <th className="py-2 px-3 text-right text-xs text-gray-500"></th>
              </tr>
            </thead>
            <tbody>
              {parts.map((p) => {
                const isLow = p.stockQuantity <= p.minStockLevel;
                return (
                  <tr key={p.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="py-2 px-3 font-medium text-gray-800">{p.partNumber}</td>
                    <td className="py-2 px-3">{p.name}</td>
                    <td className="py-2 px-3 text-gray-600">{p.manufacturer || "-"}</td>
                    <td className="py-2 px-3 text-right">{p.unitPrice ? Number(p.unitPrice).toLocaleString() : "-"}</td>
                    <td className={`py-2 px-3 text-right font-semibold ${isLow ? "text-red-600" : "text-gray-800"}`}>
                      {p.stockQuantity}
                    </td>
                    <td className="py-2 px-3 text-right text-gray-500">{p.minStockLevel}</td>
                    <td className="py-2 px-3 text-gray-500">{p.location || "-"}</td>
                    <td className="py-2 px-3 text-right">
                      <button onClick={() => editPart(p)} className="text-xs text-blue-600 hover:underline mr-2">수정</button>
                      <button onClick={() => deletePart(p.id)} className="text-xs text-red-400 hover:underline">삭제</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
