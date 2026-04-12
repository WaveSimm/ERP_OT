"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { procurementApi, supplierApi } from "@/lib/api";
import SearchableSelect from "@/components/SearchableSelect";
import FilterableSelect from "@/components/FilterableSelect";
import DateInput from "@/components/DateInput";

interface OrderItem {
  name: string;
  spec: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export default function NewOrderPage() {
  const router = useRouter();
  const [contracts, setContracts] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    contractId: "",
    manufacturer: "",
    currency: "EUR",
    orderDate: "",
    estimatedProductionEnd: "",
    estimatedShipDate: "",
    arrivalLocation: "",
    customsHandler: "",
    invoiceNo: "",
    dueDate: "",
    oaNumber: "",
    totalAmount: 0,
    totalAmountKRW: "",
    notes: "",
  });

  const [items, setItems] = useState<OrderItem[]>([
    { name: "", spec: "", quantity: 1, unitPrice: 0, amount: 0 },
  ]);

  useEffect(() => {
    procurementApi.getContracts({ limit: 100 }).then((res) => setContracts(res.items)).catch(() => {});
  }, []);

  const updateItem = (idx: number, field: keyof OrderItem, value: any) => {
    const newItems = [...items];
    (newItems[idx] as any)[field] = value;
    if (field === "quantity" || field === "unitPrice") {
      newItems[idx].amount = newItems[idx].quantity * newItems[idx].unitPrice;
    }
    setItems(newItems);
    setForm({ ...form, totalAmount: newItems.reduce((s, i) => s + i.amount, 0) });
  };

  const addItem = () => {
    setItems([...items, { name: "", spec: "", quantity: 1, unitPrice: 0, amount: 0 }]);
  };

  const removeItem = (idx: number) => {
    if (items.length <= 1) return;
    const newItems = items.filter((_, i) => i !== idx);
    setItems(newItems);
    setForm({ ...form, totalAmount: newItems.reduce((s, i) => s + i.amount, 0) });
  };

  const handleSubmit = async () => {
    if (!form.contractId || !form.manufacturer) {
      alert("계약, 제조사는 필수입니다.");
      return;
    }
    if (items.some((i) => !i.name || i.quantity <= 0)) {
      alert("모든 품목의 품명과 수량을 입력해주세요.");
      return;
    }

    setSaving(true);
    try {
      const data = {
        ...form,
        totalAmountKRW: form.totalAmountKRW ? Number(form.totalAmountKRW) : undefined,
        orderDate: form.orderDate || undefined,
        estimatedProductionEnd: form.estimatedProductionEnd || undefined,
        estimatedShipDate: form.estimatedShipDate || undefined,
        dueDate: form.dueDate || undefined,
        arrivalLocation: form.arrivalLocation || undefined,
        customsHandler: form.customsHandler || undefined,
        invoiceNo: form.invoiceNo || undefined,
        oaNumber: form.oaNumber || undefined,
        notes: form.notes || undefined,
        items: items.map((i) => ({
          name: i.name,
          spec: i.spec || undefined,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          amount: i.amount,
        })),
      };
      const result = await procurementApi.createOrder(data);
      router.push(`/procurement/orders/${result.id}`);
    } catch (e: any) {
      alert(e.message || "발주 생성 실패");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.push("/procurement")} className="text-gray-400 hover:text-gray-600">&larr;</button>
        <h1 className="text-xl font-bold">발주 등록</h1>
      </div>

      {/* Basic Info */}
      <div className="bg-white rounded-lg border p-6 mb-4">
        <h3 className="font-medium mb-4">기본 정보</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">계약 *</label>
            <FilterableSelect
              value={form.contractId}
              onChange={(v) => setForm({ ...form, contractId: v })}
              options={contracts.map((c) => ({ value: c.id, label: `${c.contractNumber} - ${c.name}`, sub: c.client?.name }))}
              placeholder="계약 선택..."
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">제조사 *</label>
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
          <div>
            <label className="block text-sm text-gray-600 mb-1">통화 *</label>
            <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
              <option value="USD">USD</option>
              <option value="KRW">KRW</option>
            </select>
          </div>
        </div>
      </div>

      {/* Dates & Logistics */}
      <div className="bg-white rounded-lg border p-6 mb-4">
        <h3 className="font-medium mb-4">일정/물류</h3>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">발주일</label>
            <DateInput value={form.orderDate}
              onChange={(v) => setForm({ ...form, orderDate: v })}
              className="w-full !py-2" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">예상 생산완료일</label>
            <DateInput value={form.estimatedProductionEnd}
              onChange={(v) => setForm({ ...form, estimatedProductionEnd: v })}
              className="w-full !py-2" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">예상 출하일</label>
            <DateInput value={form.estimatedShipDate}
              onChange={(v) => setForm({ ...form, estimatedShipDate: v })}
              className="w-full !py-2" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">입고장소</label>
            <input type="text" value={form.arrivalLocation}
              onChange={(e) => setForm({ ...form, arrivalLocation: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">통관담당</label>
            <input type="text" value={form.customsHandler}
              onChange={(e) => setForm({ ...form, customsHandler: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>
      </div>

      {/* Finance */}
      <div className="bg-white rounded-lg border p-6 mb-4">
        <h3 className="font-medium mb-4">회계</h3>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Invoice No</label>
            <input type="text" value={form.invoiceNo}
              onChange={(e) => setForm({ ...form, invoiceNo: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">결제기한</label>
            <DateInput value={form.dueDate}
              onChange={(v) => setForm({ ...form, dueDate: v })}
              className="w-full !py-2" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">OA번호</label>
            <input type="text" value={form.oaNumber}
              onChange={(e) => setForm({ ...form, oaNumber: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">원화 환산액</label>
            <input type="number" value={form.totalAmountKRW}
              onChange={(e) => setForm({ ...form, totalAmountKRW: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="0" />
          </div>
        </div>
      </div>

      {/* Items */}
      <div className="bg-white rounded-lg border p-6 mb-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium">품목</h3>
          <button onClick={addItem} className="text-sm text-blue-600 hover:underline">+ 품목 추가</button>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="pb-2 text-left font-medium text-gray-600">품목명 *</th>
              <th className="pb-2 text-left font-medium text-gray-600">사양</th>
              <th className="pb-2 text-center font-medium text-gray-600 w-20">수량</th>
              <th className="pb-2 text-right font-medium text-gray-600 w-28">단가</th>
              <th className="pb-2 text-right font-medium text-gray-600 w-28">금액</th>
              <th className="pb-2 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={idx} className="border-b last:border-0">
                <td className="py-2 pr-2">
                  <input type="text" value={item.name} onChange={(e) => updateItem(idx, "name", e.target.value)}
                    className="w-full border rounded px-2 py-1.5 text-sm" />
                </td>
                <td className="py-2 pr-2">
                  <input type="text" value={item.spec} onChange={(e) => updateItem(idx, "spec", e.target.value)}
                    className="w-full border rounded px-2 py-1.5 text-sm" />
                </td>
                <td className="py-2 pr-2">
                  <input type="number" min={1} value={item.quantity} onChange={(e) => updateItem(idx, "quantity", Number(e.target.value))}
                    className="w-full border rounded px-2 py-1.5 text-sm text-center" />
                </td>
                <td className="py-2 pr-2">
                  <input type="number" min={0} step={0.01} value={item.unitPrice} onChange={(e) => updateItem(idx, "unitPrice", Number(e.target.value))}
                    className="w-full border rounded px-2 py-1.5 text-sm text-right" />
                </td>
                <td className="py-2 pr-2 text-right font-mono">{item.amount.toLocaleString()}</td>
                <td className="py-2">
                  {items.length > 1 && (
                    <button onClick={() => removeItem(idx)} className="text-red-400 hover:text-red-600 text-xs">X</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t">
              <td colSpan={4} className="py-2 text-right font-medium">합계:</td>
              <td className="py-2 text-right font-mono font-bold">{form.totalAmount.toLocaleString()}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Notes */}
      <div className="bg-white rounded-lg border p-6 mb-6">
        <label className="block text-sm text-gray-600 mb-1">비고</label>
        <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
          className="w-full border rounded-lg px-3 py-2 text-sm" rows={3} />
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3">
        <button onClick={() => router.push("/procurement")} className="px-6 py-2 border rounded-lg hover:bg-gray-50">취소</button>
        <button onClick={handleSubmit} disabled={saving}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {saving ? "저장 중..." : "발주 등록"}
        </button>
      </div>
    </div>
  );
}
