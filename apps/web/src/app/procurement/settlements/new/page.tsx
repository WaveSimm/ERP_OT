"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { settlementApi, procurementApi } from "@/lib/api";
import { DateInput } from "@/components/ui/DateInput";
import SearchableSelect from "@/components/SearchableSelect";

const DUTY_TYPES: Record<string, string> = {
  TARIFF: "관세",
  OVERSEAS_FREIGHT: "국외운반비",
  DOMESTIC_FREIGHT: "국내운반비",
  CUSTOMS_FEE: "통관수수료",
  WAREHOUSE_FEE: "창고보관료",
  HANDLING_FEE: "취급수수료",
};

const CURRENCIES = ["USD", "EUR", "JPY", "GBP", "CHF", "CNY"];

export default function NewSettlementPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [selectedOrderLabel, setSelectedOrderLabel] = useState("");
  const [linkedContract, setLinkedContract] = useState<{ id: string; contractNumber: string; name?: string; client?: string } | null>(null);

  const [form, setForm] = useState({
    declarationNo: "",
    supplier: "",
    declarationDate: new Date().toISOString().slice(0, 10),
    orderId: "",
    contractId: "",
    currency: "USD",
    saleInfo: "",
    notes: "",
  });

  // 발주 선택 시 자동 채움 (송금 + 품목)
  const loadOrderAndPrefill = async (orderId: string) => {
    try {
      const order = await procurementApi.getOrder(orderId);
      setForm((p) => ({
        ...p,
        orderId: order.id,
        contractId: order.contractId || order.contract?.id || "",
        supplier: order.manufacturer || p.supplier,
        currency: order.currency || p.currency,
      }));
      setLinkedContract(order.contract || null);
      // 송금 내역 prefill (COMPLETED만)
      const payments = (order.payments || []).filter((p: any) => p.status === "COMPLETED");
      setRemittances(payments.map((p: any) => ({
        remittanceDate: p.paymentDate ? String(p.paymentDate).slice(0, 10) : new Date().toISOString().slice(0, 10),
        foreignAmount: p.amount?.toString() || "",
        exchangeRate: p.exchangeRate?.toString() || "",
        krwAmount: p.amountKRW?.toString() || "",
        invoiceNo: p.bankReference || "",
      })));
      // 품목 명세 prefill (재고번호별 1 row)
      const rows: any[] = [];
      for (const it of (order.items || [])) {
        const invs = it.inventoryItems || [];
        if (invs.length > 0) {
          for (const inv of invs) {
            rows.push({
              inventoryNo: inv.inventoryNo,
              name: it.name,
              quantity: "1",
              foreignUnitPrice: it.unitPrice?.toString() || "",
              foreignAmount: it.unitPrice?.toString() || "",
              unitPrice: "",
              amount: "",
            });
          }
        } else {
          rows.push({
            inventoryNo: "",
            name: it.name,
            quantity: it.quantity?.toString() || "1",
            foreignUnitPrice: it.unitPrice?.toString() || "",
            foreignAmount: it.amount?.toString() || "",
            unitPrice: "",
            amount: "",
          });
        }
      }
      setItems(rows);
    } catch (e: any) {
      alert(e.message || "발주 정보 로드 실패");
    }
  };

  const [remittances, setRemittances] = useState<Array<{
    remittanceDate: string; foreignAmount: string; exchangeRate: string; krwAmount: string; invoiceNo: string;
  }>>([]);

  const [duties, setDuties] = useState<Array<{
    type: string; amount: string; vat: string; awbNo: string;
  }>>([]);

  const [items, setItems] = useState<Array<{
    inventoryNo: string; name: string; quantity: string;
    foreignUnitPrice: string; foreignAmount: string; unitPrice: string; amount: string;
  }>>([]);

  const addRemittance = () => setRemittances(p => [...p, {
    remittanceDate: new Date().toISOString().slice(0, 10), foreignAmount: "", exchangeRate: "", krwAmount: "", invoiceNo: "",
  }]);

  const addDuty = () => setDuties(p => [...p, { type: "TARIFF", amount: "", vat: "", awbNo: "" }]);

  const addItem = () => setItems(p => [...p, {
    inventoryNo: "", name: "", quantity: "1",
    foreignUnitPrice: "", foreignAmount: "", unitPrice: "", amount: "",
  }]);

  const updateRemittance = (idx: number, key: string, value: string) => {
    setRemittances(p => {
      const next = [...p];
      (next[idx] as any)[key] = value;
      if (key === "foreignAmount" || key === "exchangeRate") {
        const fa = Number(next[idx].foreignAmount) || 0;
        const er = Number(next[idx].exchangeRate) || 0;
        next[idx].krwAmount = String(Math.round(fa * er));
      }
      return next;
    });
  };

  const updateItem = (idx: number, key: string, value: string) => {
    setItems(p => {
      const next = [...p];
      (next[idx] as any)[key] = value;
      const q = Number(next[idx].quantity) || 0;
      if (key === "quantity" || key === "foreignUnitPrice") {
        const fup = Number(next[idx].foreignUnitPrice) || 0;
        next[idx].foreignAmount = String(Math.round(q * fup * 100) / 100);
      }
      if (key === "quantity" || key === "unitPrice") {
        const up = Number(next[idx].unitPrice) || 0;
        next[idx].amount = String(Math.round(q * up * 10000) / 10000);
      }
      return next;
    });
  };

  // 평균 환율 (송금 기반)
  const avgRate = (() => {
    const totalForeign = remittances.reduce((s, r) => s + (Number(r.foreignAmount) || 0), 0);
    const totalKrw = remittances.reduce((s, r) => s + (Number(r.krwAmount) || 0), 0);
    return totalForeign > 0 ? totalKrw / totalForeign : 0;
  })();

  // 외화→원화 자동 계산
  const applyExchangeRate = () => {
    if (avgRate <= 0) return;
    setItems(prev => prev.map(item => {
      const fa = Number(item.foreignAmount) || 0;
      if (fa <= 0) return item;
      const krwAmount = fa * avgRate;
      const q = Number(item.quantity) || 1;
      return {
        ...item,
        unitPrice: String(Math.round(krwAmount / q * 10000) / 10000),
        amount: String(Math.round(krwAmount * 10000) / 10000),
      };
    }));
  };

  const totalRemittanceKrw = remittances.reduce((s, r) => s + (Number(r.krwAmount) || 0), 0);
  const totalDuty = duties.reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const totalImportCost = totalRemittanceKrw + totalDuty;

  const handleSave = async () => {
    if (!form.declarationNo || !form.supplier) { alert("신고번호와 공급업체를 입력하세요."); return; }
    setSaving(true);
    try {
      const supplyAmount = Math.round(totalImportCost / 1.1);
      const vat = totalImportCost - supplyAmount;

      const result = await settlementApi.create({
        declarationNo: form.declarationNo,
        supplier: form.supplier,
        declarationDate: form.declarationDate,
        orderId: form.orderId || undefined,
        contractId: form.contractId || undefined,
        currency: form.currency,
        saleInfo: form.saleInfo || undefined,
        totalImportCost,
        supplyAmount,
        vat,
        notes: form.notes || undefined,
        remittances: remittances.map(r => ({
          remittanceDate: r.remittanceDate,
          foreignAmount: Number(r.foreignAmount),
          exchangeRate: Number(r.exchangeRate),
          krwAmount: Number(r.krwAmount),
          invoiceNo: r.invoiceNo || undefined,
        })),
        duties: duties.map(d => ({
          type: d.type,
          amount: Number(d.amount),
          vat: Number(d.vat) || 0,
          awbNo: d.awbNo || undefined,
        })),
        items: items.map(i => ({
          inventoryNo: i.inventoryNo || undefined,
          name: i.name,
          quantity: Number(i.quantity),
          foreignUnitPrice: Number(i.foreignUnitPrice) || undefined,
          foreignAmount: Number(i.foreignAmount) || undefined,
          unitPrice: Number(i.unitPrice),
          amount: Number(i.amount),
        })),
      });
      router.push(`/procurement/settlements/${result.id}`);
    } catch (e: any) {
      alert(e.message || "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-5xl">
      <h2 className="text-lg font-semibold mb-4">수입원가정산서 작성</h2>

      {/* 연결 발주 검색 — 발주 선택 시 송금·품목 자동 채움 */}
      <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
        <label className="text-sm font-medium text-blue-900 block mb-1">연결 발주 (마감된 발주만 검색)</label>
        <SearchableSelect
          value={selectedOrderLabel}
          onChange={(v) => setSelectedOrderLabel(v)}
          onSelect={(opt) => {
            if (!opt) return;
            setSelectedOrderLabel(opt.name);
            loadOrderAndPrefill(opt.id);
          }}
          placeholder="발주번호·제조사 검색 (예: PO-2605-0008)"
          loadOptions={async (q) => {
            const res = await procurementApi.getOrders({ search: q, status: "CLOSED", limit: 20 });
            return (res.items || []).map((o: any) => ({
              id: o.id,
              name: o.orderNumber,
              sub: `${o.manufacturer || ""} · ${o.currency || ""}`,
            }));
          }}
        />
        <p className="text-xs text-blue-700 mt-1">발주 선택 시 계약·공급업체·통화·송금 내역·품목 명세가 자동 채워집니다.</p>
        {linkedContract && (
          <div className="mt-2 px-3 py-2 bg-white border border-blue-300 rounded">
            <div className="text-xs text-gray-500">연결 계약</div>
            <div className="text-sm font-medium">
              <span className="font-mono text-blue-700">{linkedContract.contractNumber}</span>
              {linkedContract.name && <span className="text-gray-700 ml-2">{linkedContract.name}</span>}
              {linkedContract.client && <span className="text-gray-400 text-xs ml-2">({linkedContract.client})</span>}
            </div>
          </div>
        )}
      </div>

      {/* 기본 정보 */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div>
          <label className="text-sm text-gray-600">신고번호 *</label>
          <input value={form.declarationNo} onChange={(e) => setForm(p => ({ ...p, declarationNo: e.target.value }))}
            className="w-full border rounded px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="text-sm text-gray-600">공급업체 *</label>
          <input value={form.supplier} onChange={(e) => setForm(p => ({ ...p, supplier: e.target.value }))}
            className="w-full border rounded px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="text-sm text-gray-600">신고일</label>
          <DateInput value={form.declarationDate} onChange={(e) => setForm(p => ({ ...p, declarationDate: e.target.value }))}
            className="w-full border rounded px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="text-sm text-gray-600">통화</label>
          <select value={form.currency} onChange={(e) => setForm(p => ({ ...p, currency: e.target.value }))}
            className="w-full border rounded px-3 py-2 text-sm">
            {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="text-sm text-gray-600">매출 연결 / 비고</label>
          <input value={form.saleInfo} onChange={(e) => setForm(p => ({ ...p, saleInfo: e.target.value }))}
            className="w-full border rounded px-3 py-2 text-sm" placeholder="예: #24-307 매출 ₩8,500만원/별도" />
        </div>
      </div>

      {/* 송금 내역 */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium">4-(1) 송금 내역</h3>
          <button onClick={addRemittance} className="text-xs text-blue-600 hover:underline">+ 추가</button>
        </div>
        {remittances.length === 0 ? (
          <p className="text-xs text-gray-400">송금 내역을 추가하세요.</p>
        ) : (
          <table className="w-full text-sm border">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-2 py-1.5 text-left">송금일</th>
                <th className="px-2 py-1.5 text-right">외화 금액 ({form.currency})</th>
                <th className="px-2 py-1.5 text-right">환율</th>
                <th className="px-2 py-1.5 text-right">원화 (₩)</th>
                <th className="px-2 py-1.5 text-left">Invoice</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {remittances.map((r, idx) => (
                <tr key={idx} className="border-t">
                  <td className="px-1 py-1"><DateInput value={r.remittanceDate} onChange={(e) => updateRemittance(idx, "remittanceDate", e.target.value)} className="w-full border rounded px-2 py-1 text-sm" /></td>
                  <td className="px-1 py-1"><input type="number" step="0.01" value={r.foreignAmount} onChange={(e) => updateRemittance(idx, "foreignAmount", e.target.value)} className="w-full border rounded px-2 py-1 text-sm text-right" /></td>
                  <td className="px-1 py-1"><input type="number" step="0.0001" value={r.exchangeRate} onChange={(e) => updateRemittance(idx, "exchangeRate", e.target.value)} className="w-full border rounded px-2 py-1 text-sm text-right" /></td>
                  <td className="px-1 py-1 text-right font-medium">₩{Number(r.krwAmount).toLocaleString()}</td>
                  <td className="px-1 py-1"><input value={r.invoiceNo} onChange={(e) => updateRemittance(idx, "invoiceNo", e.target.value)} className="w-full border rounded px-2 py-1 text-sm" /></td>
                  <td className="px-1 py-1"><button onClick={() => setRemittances(p => p.filter((_, i) => i !== idx))} className="text-red-400 text-xs">✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {remittances.length > 0 && (
          <div className="text-xs text-gray-500 mt-1 text-right">
            송금 합계: {form.currency} {remittances.reduce((s, r) => s + (Number(r.foreignAmount) || 0), 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
            {" / "}₩{totalRemittanceKrw.toLocaleString()}
            {avgRate > 0 && ` (평균환율: ${avgRate.toFixed(4)})`}
          </div>
        )}
      </div>

      {/* 관세/부대비용 */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium">4-(2) 관세 / 부대비용</h3>
          <button onClick={addDuty} className="text-xs text-blue-600 hover:underline">+ 추가</button>
        </div>
        {duties.length === 0 ? (
          <p className="text-xs text-gray-400">관세/부대비용을 추가하세요.</p>
        ) : (
          <table className="w-full text-sm border">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-2 py-1.5 text-left">유형</th>
                <th className="px-2 py-1.5 text-right">금액 (₩)</th>
                <th className="px-2 py-1.5 text-right">부가세</th>
                <th className="px-2 py-1.5 text-left">AWB</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {duties.map((d, idx) => (
                <tr key={idx} className="border-t">
                  <td className="px-1 py-1">
                    <select value={d.type} onChange={(e) => setDuties(p => { const n = [...p]; n[idx] = { ...n[idx], type: e.target.value }; return n; })} className="w-full border rounded px-2 py-1 text-sm">
                      {Object.entries(DUTY_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </td>
                  <td className="px-1 py-1"><input type="number" value={d.amount} onChange={(e) => setDuties(p => { const n = [...p]; n[idx] = { ...n[idx], amount: e.target.value }; return n; })} className="w-full border rounded px-2 py-1 text-sm text-right" /></td>
                  <td className="px-1 py-1"><input type="number" value={d.vat} onChange={(e) => setDuties(p => { const n = [...p]; n[idx] = { ...n[idx], vat: e.target.value }; return n; })} className="w-full border rounded px-2 py-1 text-sm text-right" /></td>
                  <td className="px-1 py-1"><input value={d.awbNo} onChange={(e) => setDuties(p => { const n = [...p]; n[idx] = { ...n[idx], awbNo: e.target.value }; return n; })} className="w-full border rounded px-2 py-1 text-sm" /></td>
                  <td className="px-1 py-1"><button onClick={() => setDuties(p => p.filter((_, i) => i !== idx))} className="text-red-400 text-xs">✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 품목 명세 */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium">6. 품목 명세 (모델/규격)</h3>
          <div className="flex gap-2">
            {avgRate > 0 && (
              <button onClick={applyExchangeRate} className="text-xs text-green-600 hover:underline">
                환율 적용 (×{avgRate.toFixed(2)})
              </button>
            )}
            <button onClick={addItem} className="text-xs text-blue-600 hover:underline">+ 추가</button>
          </div>
        </div>
        {items.length === 0 ? (
          <p className="text-xs text-gray-400">품목을 추가하세요.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border min-w-[800px]">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-2 py-1.5 text-left w-24">재고번호</th>
                  <th className="px-2 py-1.5 text-left">품명</th>
                  <th className="px-2 py-1.5 text-right w-16">수량</th>
                  <th className="px-2 py-1.5 text-right w-24">외화단가</th>
                  <th className="px-2 py-1.5 text-right w-24">외화금액</th>
                  <th className="px-2 py-1.5 text-right w-28">원화단가</th>
                  <th className="px-2 py-1.5 text-right w-28">원화총액</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr key={idx} className="border-t">
                    <td className="px-1 py-1"><input value={item.inventoryNo} onChange={(e) => updateItem(idx, "inventoryNo", e.target.value)} className="w-full border rounded px-2 py-1 text-sm font-mono" placeholder="E01234" /></td>
                    <td className="px-1 py-1"><input value={item.name} onChange={(e) => updateItem(idx, "name", e.target.value)} className="w-full border rounded px-2 py-1 text-sm" /></td>
                    <td className="px-1 py-1"><input type="number" value={item.quantity} onChange={(e) => updateItem(idx, "quantity", e.target.value)} className="w-full border rounded px-2 py-1 text-sm text-right" /></td>
                    <td className="px-1 py-1"><input type="number" step="0.01" value={item.foreignUnitPrice} onChange={(e) => updateItem(idx, "foreignUnitPrice", e.target.value)} className="w-full border rounded px-2 py-1 text-sm text-right" /></td>
                    <td className="px-1 py-1 text-right text-gray-500 text-xs">{Number(item.foreignAmount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    <td className="px-1 py-1"><input type="number" step="0.0001" value={item.unitPrice} onChange={(e) => updateItem(idx, "unitPrice", e.target.value)} className="w-full border rounded px-2 py-1 text-sm text-right" /></td>
                    <td className="px-1 py-1 text-right font-medium">₩{Number(item.amount).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    <td className="px-1 py-1"><button onClick={() => setItems(p => p.filter((_, i) => i !== idx))} className="text-red-400 text-xs">✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 합계 */}
      <div className="bg-gray-50 rounded-lg p-4 mb-6">
        <div className="text-xs text-gray-500 mb-2">5. 수입원가합계</div>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div><span className="text-gray-500">수입원가 합계</span><p className="text-lg font-bold">₩{totalImportCost.toLocaleString()}</p></div>
          <div><span className="text-gray-500">공급가액 (÷1.1)</span><p className="text-lg font-bold">₩{Math.round(totalImportCost / 1.1).toLocaleString()}</p></div>
          <div><span className="text-gray-500">부가세</span><p className="text-lg font-bold">₩{(totalImportCost - Math.round(totalImportCost / 1.1)).toLocaleString()}</p></div>
        </div>
        {form.saleInfo && (
          <div className="mt-2 text-xs text-gray-500">매출 연결: {form.saleInfo}</div>
        )}
      </div>

      {/* 메모 + 저장 */}
      <div className="mb-4">
        <label className="text-sm text-gray-600">메모</label>
        <textarea value={form.notes} onChange={(e) => setForm(p => ({ ...p, notes: e.target.value }))}
          className="w-full border rounded px-3 py-2 text-sm" rows={2} />
      </div>

      <div className="flex gap-2">
        <button onClick={() => router.back()} className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">취소</button>
        <button disabled={saving} onClick={handleSave}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
          저장
        </button>
      </div>
    </div>
  );
}
