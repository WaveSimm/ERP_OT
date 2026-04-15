"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { settlementApi, inventoryApi, procurementApi } from "@/lib/api";
import FileAttachment from "@/components/FileAttachment";
import SearchableSelect from "@/components/SearchableSelect";

const DUTY_LABELS: Record<string, string> = {
  TARIFF: "관세", OVERSEAS_FREIGHT: "국외운반비", DOMESTIC_FREIGHT: "국내운반비",
  CUSTOMS_FEE: "통관수수료", WAREHOUSE_FEE: "창고보관료", HANDLING_FEE: "취급수수료",
};

export default function SettlementDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showExtraModal, setShowExtraModal] = useState(false);
  const [extraForm, setExtraForm] = useState({ name: "", amount: "", notes: "" });
  const [showRemitModal, setShowRemitModal] = useState(false);
  const [remitForm, setRemitForm] = useState({ remittanceDate: "", foreignAmount: "", exchangeRate: "", krwAmount: "", invoiceNo: "", notes: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { setData(await settlementApi.getById(id)); }
    catch { }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const handleAddExtra = async () => {
    if (!extraForm.name || !extraForm.amount) return;
    setSaving(true);
    try {
      await settlementApi.addExtra(id, {
        name: extraForm.name,
        amount: Number(extraForm.amount),
        notes: extraForm.notes || undefined,
      });
      setShowExtraModal(false);
      setExtraForm({ name: "", amount: "", notes: "" });
      load();
    } catch (e: any) { alert(e.message); }
    finally { setSaving(false); }
  };

  const handleAddRemittance = async () => {
    if (!remitForm.remittanceDate || !remitForm.foreignAmount || !remitForm.exchangeRate) return;
    setSaving(true);
    try {
      const foreignAmount = Number(remitForm.foreignAmount);
      const exchangeRate = Number(remitForm.exchangeRate);
      const krwAmount = remitForm.krwAmount ? Number(remitForm.krwAmount) : Math.round(foreignAmount * exchangeRate);
      await settlementApi.addRemittance(id, {
        remittanceDate: remitForm.remittanceDate,
        foreignAmount,
        exchangeRate,
        krwAmount,
        invoiceNo: remitForm.invoiceNo || undefined,
        notes: remitForm.notes || undefined,
      });
      setShowRemitModal(false);
      setRemitForm({ remittanceDate: "", foreignAmount: "", exchangeRate: "", krwAmount: "", invoiceNo: "", notes: "" });
      load();
    } catch (e: any) { alert(e.message); }
    finally { setSaving(false); }
  };

  const handleDeleteRemittance = async (remittanceId: string) => {
    if (!confirm("이 송금 내역을 삭제하시겠습니까?")) return;
    try {
      await settlementApi.removeRemittance(remittanceId);
      load();
    } catch (e: any) { alert(e.message); }
  };

  if (loading) return <div className="text-center py-12 text-gray-400">로딩 중...</div>;
  if (!data) return <div className="text-center py-12 text-red-500">원가정산을 찾을 수 없습니다.</div>;

  const currency = data.currency || "USD";
  const hasForeignPrices = data.items?.some((i: any) => i.foreignUnitPrice || i.foreignAmount);
  const hasInventoryNo = data.items?.some((i: any) => i.inventoryNo);

  return (
    <div className="max-w-5xl">
      <h2 className="text-xl font-bold mb-1">{data.declarationNo}</h2>
      <div className="text-sm text-gray-500 mb-2">
        {data.supplier} · {currency} · 신고일: {new Date(data.declarationDate).toLocaleDateString("ko-KR")}
        {data.order && ` · 발주: ${data.order.orderNumber}`}
      </div>
      <div className="flex items-center gap-2 mb-6">
        <span className="text-xs text-gray-400">계약번호:</span>
        {data.contract ? (
          <div className="flex items-center gap-2">
            <button onClick={() => router.push(`/procurement/contracts/${data.contract.id}`)}
              className="text-sm text-blue-600 hover:underline font-medium">
              {data.contract.contractNumber}
            </button>
            <span className="text-xs text-gray-400">{data.contract.name} · {data.contract.client}</span>
            <button onClick={async () => { await settlementApi.updateContract(id, null); load(); }}
              className="text-xs text-red-400 hover:text-red-600">해제</button>
          </div>
        ) : (
          <SearchableSelect
            value="" onChange={() => {}}
            onSelect={async (opt) => {
              if (opt) { await settlementApi.updateContract(id, opt.id); load(); }
            }}
            placeholder="계약번호 검색..."
            className="border rounded px-2 py-1 text-sm w-56"
            loadOptions={async (q) => {
              const res = await procurementApi.getContracts({ search: q, limit: 10 });
              return (res.items || res || []).map((c: any) => ({ id: c.id, name: c.contractNumber, sub: `${c.name} · ${c.client}` }));
            }}
          />
        )}
      </div>

      {/* 5. 수입원가합계 */}
      <div className="bg-gray-50 rounded-lg p-4 mb-6">
        <div className="text-xs text-gray-400 mb-2">5. 수입원가합계</div>
        <div className="grid grid-cols-4 gap-4">
          <div><span className="text-xs text-gray-500">수입원가</span><p className="text-lg font-bold">₩{Number(data.totalImportCost).toLocaleString()}</p></div>
          <div><span className="text-xs text-gray-500">부대비용</span><p className="text-lg font-bold text-orange-600">₩{Number(data.totalExtraCost).toLocaleString()}</p></div>
          <div><span className="text-xs text-gray-500">공급가액</span><p className="text-lg font-bold">₩{Number(data.supplyAmount).toLocaleString()}</p></div>
          <div><span className="text-xs text-gray-500">부가세</span><p className="text-lg font-bold">₩{Number(data.vat).toLocaleString()}</p></div>
        </div>
        {data.saleInfo && (
          <div className="mt-2 text-xs text-gray-600 bg-white rounded px-3 py-1.5 border">
            매출 연결: {data.saleInfo}
          </div>
        )}
      </div>

      {/* 4-(1) 송금 내역 */}
      {(() => {
        const remittances = data.remittances || [];
        const totalRemitKrw = remittances.reduce((s: number, r: any) => s + Number(r.krwAmount), 0);
        const totalRemitForeign = remittances.reduce((s: number, r: any) => s + Number(r.foreignAmount), 0);
        const remaining = Number(data.totalImportCost) - totalRemitKrw;
        return (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium">4-(1) 송금 내역</h3>
              <button onClick={() => setShowRemitModal(true)} className="text-xs text-blue-600 hover:underline">+ 송금 추가</button>
            </div>
            {remittances.length > 0 ? (
              <table className="w-full text-sm border rounded">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-3 py-2">송금일</th>
                    <th className="text-right px-3 py-2">외화 ({currency})</th>
                    <th className="text-right px-3 py-2">환율</th>
                    <th className="text-right px-3 py-2">원화 (₩)</th>
                    <th className="text-left px-3 py-2">Invoice</th>
                    <th className="text-center px-3 py-2 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {remittances.map((r: any) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2">{new Date(r.remittanceDate).toLocaleDateString("ko-KR")}</td>
                      <td className="px-3 py-2 text-right">{Number(r.foreignAmount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                      <td className="px-3 py-2 text-right">{Number(r.exchangeRate).toFixed(4)}</td>
                      <td className="px-3 py-2 text-right font-medium">₩{Number(r.krwAmount).toLocaleString()}</td>
                      <td className="px-3 py-2 text-gray-500">{r.invoiceNo || "-"}</td>
                      <td className="px-3 py-2 text-center">
                        <button onClick={() => handleDeleteRemittance(r.id)} className="text-xs text-red-400 hover:text-red-600">삭제</button>
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-gray-50 font-medium">
                    <td className="px-3 py-2">합계</td>
                    <td className="px-3 py-2 text-right">{totalRemitForeign.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    <td className="px-3 py-2"></td>
                    <td className="px-3 py-2 text-right">₩{totalRemitKrw.toLocaleString()}</td>
                    <td colSpan={2}></td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <p className="text-xs text-gray-400">송금 내역이 없습니다.</p>
            )}
            {remaining > 0 && (
              <div className="mt-2 text-xs px-3 py-1.5 bg-amber-50 border border-amber-200 rounded text-amber-700">
                미송금 잔액: ₩{remaining.toLocaleString()} (수입원가 ₩{Number(data.totalImportCost).toLocaleString()} - 송금합계 ₩{totalRemitKrw.toLocaleString()})
              </div>
            )}
            {remaining <= 0 && remittances.length > 0 && (
              <div className="mt-2 text-xs px-3 py-1.5 bg-green-50 border border-green-200 rounded text-green-700">
                송금 완료
              </div>
            )}
          </div>
        );
      })()}

      {/* 4-(2) 관세/부대비용 */}
      {data.duties?.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-medium mb-2">4-(2) 관세 / 부대비용</h3>
          <div className="space-y-2">
            {data.duties.map((d: any) => (
              <div key={d.id} className="flex items-center justify-between bg-white border rounded-lg px-4 py-2">
                <span className="text-sm">{DUTY_LABELS[d.type] || d.type}</span>
                <span className="font-medium">₩{Number(d.amount).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 추가비용 (extras) */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium">추가 부대비용</h3>
          <button onClick={() => setShowExtraModal(true)} className="text-xs text-blue-600 hover:underline">+ 추가</button>
        </div>
        {data.extras?.length > 0 ? (
          <div className="space-y-2">
            {data.extras.map((e: any) => (
              <div key={e.id} className="flex items-center justify-between bg-white border rounded-lg px-4 py-2">
                <div>
                  <span className="text-sm font-medium">{e.name}</span>
                  {e.targetItem && <span className="text-xs text-gray-400 ml-2">{e.targetItem.name}</span>}
                </div>
                <span className="font-medium">₩{Number(e.amount).toLocaleString()}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-400">추가 부대비용이 없습니다.</p>
        )}
      </div>

      {/* 6. 품목 명세 */}
      {data.items?.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-medium mb-2">6. 품목 명세 (모델/규격)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border rounded">
              <thead className="bg-gray-50">
                <tr>
                  {hasInventoryNo && <th className="text-left px-3 py-2">재고번호</th>}
                  <th className="text-left px-3 py-2">품명</th>
                  <th className="text-right px-3 py-2">수량</th>
                  {hasForeignPrices && (
                    <>
                      <th className="text-right px-3 py-2">외화단가 ({currency})</th>
                      <th className="text-right px-3 py-2">외화금액</th>
                    </>
                  )}
                  <th className="text-right px-3 py-2">원화단가</th>
                  <th className="text-right px-3 py-2">원화총액</th>
                  {data.items.some((i: any) => i.adjustedUnitPrice) && (
                    <th className="text-right px-3 py-2">조정단가</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.items.map((item: any) => (
                  <tr key={item.id}>
                    {hasInventoryNo && (
                      <td className="px-3 py-2 font-mono text-xs">
                        {item.inventoryNo ? (
                          <button
                            onClick={async () => {
                              try {
                                const inv = await inventoryApi.getByNo(item.inventoryNo);
                                router.push(`/procurement/inventory/${inv.id}`);
                              } catch {
                                alert("해당 재고를 찾을 수 없습니다.");
                              }
                            }}
                            className="text-blue-600 hover:underline"
                          >
                            {item.inventoryNo}
                          </button>
                        ) : "-"}
                      </td>
                    )}
                    <td className="px-3 py-2">{item.name}</td>
                    <td className="px-3 py-2 text-right">{item.quantity}</td>
                    {hasForeignPrices && (
                      <>
                        <td className="px-3 py-2 text-right text-gray-500">
                          {item.foreignUnitPrice ? Number(item.foreignUnitPrice).toLocaleString(undefined, { minimumFractionDigits: 2 }) : "-"}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-500">
                          {item.foreignAmount ? Number(item.foreignAmount).toLocaleString(undefined, { minimumFractionDigits: 2 }) : "-"}
                        </td>
                      </>
                    )}
                    <td className="px-3 py-2 text-right">{Number(item.unitPrice).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                    <td className="px-3 py-2 text-right font-medium">₩{Number(item.amount).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    {data.items.some((i: any) => i.adjustedUnitPrice) && (
                      <td className="px-3 py-2 text-right text-blue-600">
                        {item.adjustedUnitPrice ? Number(item.adjustedUnitPrice).toLocaleString() : "-"}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 첨부파일 (수입신고서, 송장, 배송비 등) */}
      <div className="mb-6">
        <h3 className="text-sm font-medium mb-2">첨부파일 (증빙자료)</h3>
        <FileAttachment referenceType="SETTLEMENT" referenceId={id} />
      </div>

      {/* 추가 부대비용 모달 */}
      {showExtraModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowExtraModal(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">추가 부대비용</h3>
            <div className="space-y-3">
              <div>
                <label className="text-sm text-gray-600">비용명 *</label>
                <input value={extraForm.name} onChange={(e) => setExtraForm(p => ({ ...p, name: e.target.value }))}
                  className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-sm text-gray-600">금액 (원) *</label>
                <input type="number" value={extraForm.amount} onChange={(e) => setExtraForm(p => ({ ...p, amount: e.target.value }))}
                  className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-sm text-gray-600">메모</label>
                <textarea value={extraForm.notes} onChange={(e) => setExtraForm(p => ({ ...p, notes: e.target.value }))}
                  className="w-full border rounded px-3 py-2 text-sm" rows={2} />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowExtraModal(false)} className="px-4 py-2 border rounded-lg text-sm">취소</button>
              <button onClick={handleAddExtra} disabled={saving}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50">등록</button>
            </div>
          </div>
        </div>
      )}
      {/* 송금 추가 모달 */}
      {showRemitModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowRemitModal(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">송금 추가</h3>
            <div className="space-y-3">
              <div>
                <label className="text-sm text-gray-600">송금일 *</label>
                <input type="date" value={remitForm.remittanceDate} onChange={(e) => setRemitForm(p => ({ ...p, remittanceDate: e.target.value }))}
                  className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-gray-600">외화금액 ({data.currency || "USD"}) *</label>
                  <input type="number" step="0.01" value={remitForm.foreignAmount}
                    onChange={(e) => {
                      const fa = e.target.value;
                      setRemitForm(p => ({ ...p, foreignAmount: fa, krwAmount: fa && p.exchangeRate ? String(Math.round(Number(fa) * Number(p.exchangeRate))) : p.krwAmount }));
                    }}
                    className="w-full border rounded px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-sm text-gray-600">환율 *</label>
                  <input type="number" step="0.0001" value={remitForm.exchangeRate}
                    onChange={(e) => {
                      const er = e.target.value;
                      setRemitForm(p => ({ ...p, exchangeRate: er, krwAmount: p.foreignAmount && er ? String(Math.round(Number(p.foreignAmount) * Number(er))) : p.krwAmount }));
                    }}
                    className="w-full border rounded px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="text-sm text-gray-600">원화금액 (₩)</label>
                <input type="number" value={remitForm.krwAmount} onChange={(e) => setRemitForm(p => ({ ...p, krwAmount: e.target.value }))}
                  className="w-full border rounded px-3 py-2 text-sm bg-gray-50" placeholder="자동 계산" />
              </div>
              <div>
                <label className="text-sm text-gray-600">Invoice No.</label>
                <input value={remitForm.invoiceNo} onChange={(e) => setRemitForm(p => ({ ...p, invoiceNo: e.target.value }))}
                  className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-sm text-gray-600">메모</label>
                <textarea value={remitForm.notes} onChange={(e) => setRemitForm(p => ({ ...p, notes: e.target.value }))}
                  className="w-full border rounded px-3 py-2 text-sm" rows={2} />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowRemitModal(false)} className="px-4 py-2 border rounded-lg text-sm">취소</button>
              <button onClick={handleAddRemittance} disabled={saving || !remitForm.remittanceDate || !remitForm.foreignAmount || !remitForm.exchangeRate}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50">등록</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
