"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { procurementApi, supplierApi, approvalLineApi, userManagementApi } from "@/lib/api";
import SearchableSelect from "@/components/SearchableSelect";
import FilterableSelect from "@/components/FilterableSelect";
import { DateInput } from "@/components/ui/DateInput";

interface OrderItem {
  productMasterId?: string;   // v1.6 (2026-05-14): 장비 마스터 참조
  name: string;
  spec: string;               // v1.6: SKU 코드 표시용 (master.masterCode 또는 자유 텍스트)
  quantity: number;
  unitPrice: number;
  amount: number;
  notes: string;              // v1.6 (2026-05-14): 비고
}

export default function NewOrderPage() {
  const router = useRouter();
  const [contracts, setContracts] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    contractId: "",
    manufacturer: "",
    customer: "",
    currency: "EUR",
    orderDate: "",
    estimatedProductionEnd: "",
    estimatedShipDate: "",
    arrivalLocation: "",
    customsHandler: "",
    invoiceNo: "",        // 견적번호 (Quote No)
    paymentTerms: "",     // 결제수단
    totalAmount: 0,
    totalAmountKRW: "",
    notes: "",
    // v1.6 (2026-05-14): 결재라인
    approverId: "",
    approverName: "",
    secondApproverId: "",
    secondApproverName: "",
    thirdApproverId: "",
    thirdApproverName: "",
  });
  // 사용자 목록 (결재자 검색용)
  const [users, setUsers] = useState<any[]>([]);

  const [items, setItems] = useState<OrderItem[]>([
    { name: "", spec: "", quantity: 1, unitPrice: 0, amount: 0, notes: "" },
  ]);
  // v1.6 (2026-05-14): 신규 마스터 등록 모달
  const [creatingMasterIdx, setCreatingMasterIdx] = useState<number | null>(null);

  useEffect(() => {
    procurementApi.getContracts({ limit: 100 }).then((res) => setContracts(res.items)).catch(() => {});
    // v1.6 (2026-05-14): 사용자 목록 + 본인 결재라인 prefill
    userManagementApi.members(true).then((u) => setUsers(u as any[])).catch(() => {});
    approvalLineApi.getMe().then((line) => {
      if (!line) return;
      setForm(f => ({
        ...f,
        approverId: line.approverId || "",
        approverName: line.approverName || "",
        secondApproverId: line.secondApproverId || "",
        secondApproverName: line.secondApproverName || "",
        thirdApproverId: line.thirdApproverId || "",
        thirdApproverName: line.thirdApproverName || "",
      }));
    }).catch(() => {});
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
    setItems([...items, { name: "", spec: "", quantity: 1, unitPrice: 0, amount: 0, notes: "" }]);
  };

  // v1.6 (2026-05-14): 장비 마스터 선택 시 행에 자동 채움
  //   onChange가 먼저 호출되어 stale state 경합 방지 — setState callback 패턴
  const onSelectMaster = (idx: number, master: any | null) => {
    if (!master) {
      setItems(prev => prev.map((it, i) => i === idx ? { ...it, productMasterId: undefined } : it));
      return;
    }
    setItems(prev => {
      const newItems = [...prev];
      const cur = newItems[idx]!;
      // v1.6 (2026-05-14): 마스터 선택 시 SKU 코드는 항상 새 마스터 기준으로 갱신
      // 우선순위: 첫 활성 variant skuCode > masterCode > name (v1.6.1: modelName 폐기)
      const firstVariantSku = (master.variants && master.variants.length > 0)
        ? (master.variants.find((v: any) => v.skuCode)?.skuCode || "")
        : "";
      const spec = firstVariantSku || master.masterCode || "";
      // 단가는 사용자 입력 보존 (변경 안 함)
      const unitPrice = cur.unitPrice || (master.referencePrice ? Number(master.referencePrice) : 0);
      newItems[idx] = {
        ...cur,
        productMasterId: master.id,
        name: master.name,
        spec,
        unitPrice,
        amount: cur.quantity * unitPrice,
      };
      // total 갱신은 다음 microtask에 (setItems return 후)
      setForm(f => ({ ...f, totalAmount: newItems.reduce((s, i) => s + i.amount, 0) }));
      return newItems;
    });
  };

  // 신규 마스터 모달 → 등록 후 해당 행에 자동 매칭
  const onMasterCreated = (master: any) => {
    if (creatingMasterIdx == null) return;
    onSelectMaster(creatingMasterIdx, master);
    setCreatingMasterIdx(null);
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
    if (!form.estimatedShipDate) {
      alert("예상 선적일은 필수입니다.");
      return;
    }
    if (items.some((i) => !i.name || i.quantity <= 0)) {
      alert("모든 품목의 품명과 수량을 입력해주세요.");
      return;
    }

    setSaving(true);
    try {
      // v1.6 (2026-05-14): 결재라인 ID 검증 — 이름만 있고 ID 없으면 거부
      if (form.approverName && !form.approverId) {
        alert("1차 결재자를 목록에서 선택해주세요.");
        setSaving(false);
        return;
      }
      if (form.secondApproverName && !form.secondApproverId) {
        alert("2차 결재자를 목록에서 선택해주세요.");
        setSaving(false);
        return;
      }
      if (form.thirdApproverName && !form.thirdApproverId) {
        alert("3차 결재자를 목록에서 선택해주세요.");
        setSaving(false);
        return;
      }

      const data: any = {
        contractId: form.contractId,
        manufacturer: form.manufacturer,
        currency: form.currency,
        totalAmount: form.totalAmount,
        totalAmountKRW: form.totalAmountKRW ? Number(form.totalAmountKRW) : undefined,
        orderDate: form.orderDate || undefined,
        estimatedProductionEnd: form.estimatedProductionEnd || undefined,
        estimatedShipDate: form.estimatedShipDate || undefined,
        arrivalLocation: form.arrivalLocation || undefined,
        customsHandler: form.customsHandler || undefined,
        invoiceNo: form.invoiceNo || undefined,
        paymentTerms: form.paymentTerms || undefined,
        customer: form.customer || undefined,
        notes: form.notes || undefined,
        // v1.6 (2026-05-14): 발주별 결재라인 (이 발주에만 적용 — approval_lines 영향 없음)
        // approverName: 사용자 삭제 후에도 결재 히스토리 보존 (2026-05-15)
        ...(form.approverId && { approverId: form.approverId, approverName: form.approverName || undefined }),
        ...(form.secondApproverId && { secondApproverId: form.secondApproverId, secondApproverName: form.secondApproverName || undefined }),
        ...(form.thirdApproverId && { thirdApproverId: form.thirdApproverId, thirdApproverName: form.thirdApproverName || undefined }),
        items: items.map((i) => ({
          ...(i.productMasterId && { productMasterId: i.productMasterId }),
          name: i.name,
          spec: i.spec || undefined,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          amount: i.amount,
          ...(i.notes && { notes: i.notes }),
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

      {/* 결재라인 (v1.6 2026-05-14) — 최상단 배치 */}
      <div className="bg-white rounded-lg border p-6 mb-4">
        <h3 className="font-medium mb-4">결재라인</h3>
        <div className="grid grid-cols-3 gap-4">
          {/* 1차 결재 */}
          <div>
            <label className="block text-sm text-gray-600 mb-1">1차 결재 *</label>
            <SearchableSelect
              value={form.approverName}
              onChange={(v) => setForm(f => ({ ...f, approverName: v, approverId: "" }))}
              onSelect={(m) => setForm(f => ({
                ...f,
                approverId: m?.id || "",
                approverName: m?.name || "",
              }))}
              placeholder="결재자 검색..."
              allowCustom
              className={`w-full border rounded-lg px-3 py-2 text-sm ${
                form.approverId ? "border-emerald-400 bg-emerald-50/30"
                : form.approverName ? "border-amber-400 bg-amber-50/30" : ""
              }`}
              loadOptions={async (q) => {
                const filtered = users.filter((u: any) =>
                  !q || (u.name || "").toLowerCase().includes(q.toLowerCase())
                );
                return filtered.slice(0, 20).map((u: any) => ({ id: u.id, name: u.name, sub: u.email || u.department }));
              }}
            />
          </div>
          {/* 2차 결재 */}
          <div>
            <label className="block text-sm text-gray-600 mb-1">2차 결재 <span className="text-gray-400">(선택)</span></label>
            <SearchableSelect
              value={form.secondApproverName}
              onChange={(v) => setForm(f => ({ ...f, secondApproverName: v, secondApproverId: "" }))}
              onSelect={(m) => setForm(f => ({
                ...f,
                secondApproverId: m?.id || "",
                secondApproverName: m?.name || "",
              }))}
              placeholder="결재자 검색..."
              allowCustom
              className={`w-full border rounded-lg px-3 py-2 text-sm ${
                form.secondApproverId ? "border-emerald-400 bg-emerald-50/30"
                : form.secondApproverName ? "border-amber-400 bg-amber-50/30" : ""
              }`}
              loadOptions={async (q) => {
                const filtered = users.filter((u: any) =>
                  !q || (u.name || "").toLowerCase().includes(q.toLowerCase())
                );
                return filtered.slice(0, 20).map((u: any) => ({ id: u.id, name: u.name, sub: u.email || u.department }));
              }}
            />
          </div>
          {/* 3차 결재 */}
          <div>
            <label className="block text-sm text-gray-600 mb-1">3차 결재 <span className="text-gray-400">(선택)</span></label>
            <SearchableSelect
              value={form.thirdApproverName}
              onChange={(v) => setForm(f => ({ ...f, thirdApproverName: v, thirdApproverId: "" }))}
              onSelect={(m) => setForm(f => ({
                ...f,
                thirdApproverId: m?.id || "",
                thirdApproverName: m?.name || "",
              }))}
              placeholder="결재자 검색..."
              allowCustom
              className={`w-full border rounded-lg px-3 py-2 text-sm ${
                form.thirdApproverId ? "border-emerald-400 bg-emerald-50/30"
                : form.thirdApproverName ? "border-amber-400 bg-amber-50/30" : ""
              }`}
              loadOptions={async (q) => {
                const filtered = users.filter((u: any) =>
                  !q || (u.name || "").toLowerCase().includes(q.toLowerCase())
                );
                return filtered.slice(0, 20).map((u: any) => ({ id: u.id, name: u.name, sub: u.email || u.department }));
              }}
            />
          </div>
        </div>
      </div>

      {/* Basic Info */}
      <div className="bg-white rounded-lg border p-6 mb-4">
        <h3 className="font-medium mb-4">기본 정보</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">계약 *</label>
            <FilterableSelect
              value={form.contractId}
              onChange={(v) => {
                // v1.6 (2026-05-14): 계약 선택 시 고객사 자동 prefill (사용자 입력 비어있을 때만)
                const c = contracts.find((c: any) => c.id === v);
                setForm(f => ({
                  ...f,
                  contractId: v,
                  customer: f.customer || (typeof c?.client === "string" ? c.client : c?.client?.name) || "",
                }));
              }}
              options={contracts.map((c) => ({ value: c.id, label: `${c.contractNumber} - ${c.name}`, sub: c.client?.name || c.client }))}
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
            <label className="block text-sm text-gray-600 mb-1">고객사 <span className="text-gray-400">(선택)</span></label>
            <input type="text" value={form.customer}
              onChange={(e) => setForm({ ...form, customer: e.target.value })}
              placeholder="계약 선택 시 자동 채움"
              className="w-full border rounded-lg px-3 py-2 text-sm" />
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
            <label className="block text-sm text-gray-600 mb-1">예상 선적일 *</label>
            <DateInput value={form.estimatedShipDate}
              onChange={(e) => setForm({ ...form, estimatedShipDate: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm" />
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

      {/* 견적 정보 (v1.6 2026-05-14, v1.6.1 2026-05-15 정리: 결제기한·OA번호 제거) */}
      <div className="bg-white rounded-lg border p-6 mb-4">
        <h3 className="font-medium mb-4">견적 정보</h3>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Quote No</label>
            <input type="text" value={form.invoiceNo}
              onChange={(e) => setForm({ ...form, invoiceNo: e.target.value })}
              placeholder="견적번호"
              className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">금액</label>
            <input type="text" readOnly
              value={`${({ EUR: "€", GBP: "£", USD: "$", KRW: "₩" } as Record<string, string>)[form.currency] || form.currency} ${Number(form.totalAmount || 0).toLocaleString()}`}
              className="w-full border rounded-lg px-3 py-2 text-sm text-right font-mono bg-gray-50" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">결제수단</label>
            <input type="text" value={form.paymentTerms}
              onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })}
              placeholder="L/C, T/T, 무역금융 등"
              className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>
      </div>

      {/* Items */}
      <div className="bg-white rounded-lg border p-6 mb-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium">품목</h3>
          <button onClick={addItem} className="text-sm text-blue-600 hover:underline">+ 품목 추가</button>
        </div>
        <table className="w-full text-sm table-fixed">
          <colgroup>
            <col className="w-[26%]" />
            <col className="w-[20%]" />
            <col className="w-[7%]" />
            <col className="w-[11%]" />
            <col className="w-[11%]" />
            <col className="w-[21%]" />
            <col className="w-[4%]" />
          </colgroup>
          <thead>
            <tr className="border-b">
              <th className="pb-2 text-left font-medium text-gray-600">품목명 *</th>
              <th className="pb-2 text-left font-medium text-gray-600">SKU 코드</th>
              <th className="pb-2 text-center font-medium text-gray-600">수량</th>
              <th className="pb-2 text-center font-medium text-gray-600">단가 ({form.currency})</th>
              <th className="pb-2 text-right font-medium text-gray-600">금액 ({form.currency})</th>
              <th className="pb-2 text-center font-medium text-gray-600">비고</th>
              <th className="pb-2"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={idx} className="border-b last:border-0">
                <td className="py-2 pr-2">
                  <div className="flex items-center gap-1">
                    <div className="flex-1">
                      <SearchableSelect
                        value={item.name}
                        onChange={(v) => updateItem(idx, "name", v)}
                        onSelect={async (m) => {
                          if (!m) { onSelectMaster(idx, null); return; }
                          // SearchableSelect 옵션은 {id,name,sub}만 포함하므로 상세 재조회
                          try {
                            const full = await procurementApi.getProduct(m.id);
                            onSelectMaster(idx, full);
                          } catch {
                            onSelectMaster(idx, { id: m.id, name: m.name });
                          }
                        }}
                        placeholder="품목 검색..."
                        allowCustom
                        // 매칭되면 border 색으로 표시 (행 높이 변화 없음)
                        className={`w-full border rounded px-2 py-1.5 text-sm ${item.productMasterId ? "border-emerald-400 bg-emerald-50/30" : ""}`}
                        loadOptions={async (q) => {
                          const res = await procurementApi.getProducts({ search: q, itemType: "SIMPLE", limit: 20 });
                          return (res.items || []).map((p: any) => {
                            const variants = Array.isArray(p.variants) ? p.variants : [];
                            const firstSku = variants[0]?.skuCode || p.masterCode || "";
                            const extra = variants.length > 1 ? ` (외 ${variants.length - 1}개)` : "";
                            const qty = Number(p.stockSummary?.quantity ?? 0);
                            const stockText = qty > 0 ? `재고 ${qty.toLocaleString()}개` : "재고 없음";
                            const parts = [p.manufacturer, firstSku ? `${firstSku}${extra}` : null, stockText].filter(Boolean);
                            return { id: p.id, name: p.name, sub: parts.join(" · ") };
                          });
                        }}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setCreatingMasterIdx(idx)}
                      title="신규 품목 등록"
                      className="px-2 py-1 text-xs border border-blue-300 text-blue-600 rounded hover:bg-blue-50 whitespace-nowrap"
                    >+ 신규</button>
                  </div>
                </td>
                <td className="py-2 pr-2">
                  <input type="text" value={item.spec} onChange={(e) => updateItem(idx, "spec", e.target.value)}
                    placeholder="SKU"
                    className="w-full border rounded px-2 py-1.5 text-sm font-mono" />
                </td>
                <td className="py-2 pr-2">
                  <input type="number" min={1} value={item.quantity} onChange={(e) => updateItem(idx, "quantity", Number(e.target.value))}
                    className="w-full border rounded px-2 py-1.5 text-sm text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                </td>
                <td className="py-2 pr-2">
                  <input type="number" min={0} step={0.01} value={item.unitPrice} onChange={(e) => updateItem(idx, "unitPrice", Number(e.target.value))}
                    className="w-full border rounded px-2 py-1.5 text-sm text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                </td>
                <td className="py-2 pr-2 text-right font-mono">{({ EUR: "€", GBP: "£", USD: "$", KRW: "₩" } as Record<string, string>)[form.currency] || form.currency} {item.amount.toLocaleString()}</td>
                <td className="py-2 pr-2">
                  <input type="text" value={item.notes} onChange={(e) => updateItem(idx, "notes", e.target.value)}
                    className="w-full border rounded px-2 py-1.5 text-sm" />
                </td>
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
              <td className="py-2 text-right font-mono font-bold">{({ EUR: "€", GBP: "£", USD: "$", KRW: "₩" } as Record<string, string>)[form.currency] || form.currency} {form.totalAmount.toLocaleString()}</td>
              <td colSpan={2}></td>
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

      {creatingMasterIdx != null && (
        <QuickMasterCreateModal
          defaultManufacturer={form.manufacturer}
          onClose={() => setCreatingMasterIdx(null)}
          onCreated={onMasterCreated}
        />
      )}
    </div>
  );
}

// ─── 신규 장비 마스터 빠른 등록 모달 (v1.6, 2026-05-14) ───────────────
function QuickMasterCreateModal({
  defaultManufacturer,
  onClose,
  onCreated,
}: {
  defaultManufacturer?: string;
  onClose: () => void;
  onCreated: (master: any) => void;
}) {
  const [form, setForm] = useState({
    name: "",
    manufacturer: defaultManufacturer || "",
    masterCode: "",
    referencePrice: "",
  });
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!form.name || !form.manufacturer) {
      alert("품명, 제조사는 필수입니다.");
      return;
    }
    setSaving(true);
    try {
      const data: any = {
        name: form.name,
        manufacturer: form.manufacturer,
        itemType: "SIMPLE",
        ...(form.masterCode && { masterCode: form.masterCode }),
        ...(form.referencePrice && { referencePrice: Number(form.referencePrice) }),
      };
      const created = await procurementApi.createProduct(data);
      onCreated(created);
    } catch (e: any) {
      alert(e.message || "마스터 등록 실패");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold mb-4">신규 품목 등록</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-600 mb-1">품명 *</label>
            <input type="text" value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">제조사 *</label>
            <input type="text" value={form.manufacturer}
              onChange={e => setForm({ ...form, manufacturer: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">SKU prefix</label>
              <input type="text" value={form.masterCode}
                onChange={e => setForm({ ...form, masterCode: e.target.value })}
                placeholder="예: STR"
                className="w-full border rounded-lg px-3 py-2 text-sm font-mono uppercase"
                maxLength={10} />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">참고 원가</label>
              <input type="number" value={form.referencePrice}
                onChange={e => setForm({ ...form, referencePrice: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="0" />
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">취소</button>
          <button onClick={handleCreate} disabled={saving}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {saving ? "등록 중..." : "등록 후 매칭"}
          </button>
        </div>
      </div>
    </div>
  );
}
