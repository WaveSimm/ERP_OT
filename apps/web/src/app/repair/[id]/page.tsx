"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { repairApi } from "@/lib/api";

const STATUS_LABELS: Record<string, string> = {
  RECEIVED: "접수", INSPECTING_1ST: "1차점검", QUOTED: "견적발행",
  APPROVED: "승인", REPAIRING: "수리중", SHIPPED_TO_MFG: "제조사발송",
  RECEIVED_FROM_MFG: "제조사입고", INSPECTING_2ND: "2차점검",
  COMPLETED: "완료", CLOSED: "종료", CANCELLED: "취소",
};

const STATUS_COLORS: Record<string, string> = {
  RECEIVED: "bg-gray-100 text-gray-700",
  INSPECTING_1ST: "bg-blue-100 text-blue-700",
  QUOTED: "bg-yellow-100 text-yellow-700",
  APPROVED: "bg-green-100 text-green-700",
  REPAIRING: "bg-orange-100 text-orange-700",
  SHIPPED_TO_MFG: "bg-purple-100 text-purple-700",
  RECEIVED_FROM_MFG: "bg-purple-100 text-purple-700",
  INSPECTING_2ND: "bg-blue-100 text-blue-700",
  COMPLETED: "bg-emerald-100 text-emerald-700",
  CLOSED: "bg-gray-200 text-gray-600",
  CANCELLED: "bg-red-100 text-red-700",
};

const STATUS_FLOW = [
  "RECEIVED", "INSPECTING_1ST", "QUOTED", "APPROVED", "REPAIRING",
  "SHIPPED_TO_MFG", "RECEIVED_FROM_MFG", "INSPECTING_2ND", "COMPLETED", "CLOSED",
];

const COST_LABELS: Record<string, string> = {
  DIRECT_EXPENSE: "직접경비", LABOR: "공수", OVERSEAS_SHIPPING: "해외발송비", PARTS: "부품비", OTHER: "기타",
};

const QUOTE_STATUS_LABELS: Record<string, string> = {
  DRAFT: "작성중", SENT: "발송", APPROVED: "승인", REJECTED: "반려",
};

type TabKey = "info" | "inspection" | "report" | "cost" | "manufacturer" | "history";

const TABS: { key: TabKey; label: string }[] = [
  { key: "info", label: "기본정보" },
  { key: "inspection", label: "점검" },
  { key: "report", label: "보고서" },
  { key: "cost", label: "견적/비용" },
  { key: "manufacturer", label: "제조사" },
  { key: "history", label: "이력" },
];

export default function RepairOrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>("info");
  const [transitions, setTransitions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [o, t] = await Promise.all([
        repairApi.getRepairOrder(id),
        repairApi.getTransitions(id),
      ]);
      setOrder(o);
      setTransitions(t.allowedTransitions);
    } catch (e: any) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const changeStatus = async (status: string) => {
    if (!confirm(`상태를 "${STATUS_LABELS[status]}"(으)로 변경하시겠습니까?`)) return;
    setSaving(true);
    try {
      await repairApi.changeStatus(id, { status });
      await load();
    } catch (e: any) {
      alert(e.message || "상태 변경 실패");
    } finally {
      setSaving(false);
    }
  };

  const updateField = async (field: string, value: any) => {
    try {
      await repairApi.updateRepairOrder(id, { [field]: value });
      await load();
    } catch (e: any) {
      alert(e.message || "저장 실패");
    }
  };

  const updateTechStatus = async (techStatus: string) => {
    try { await repairApi.updateTechStatus(id, { techStatus }); await load(); } catch {}
  };

  const updateSalesStatus = async (salesStatus: string) => {
    try { await repairApi.updateSalesStatus(id, { salesStatus }); await load(); } catch {}
  };

  if (loading) return <div className="py-12 text-center text-gray-400">불러오는 중...</div>;
  if (!order) return <div className="py-12 text-center text-gray-400">AS 접수를 찾을 수 없습니다.</div>;

  const assetName = order.customerAsset?.name || order.equipment?.name || order.sensor?.name || "-";
  const serialNumber = order.customerAsset?.serialNumber || order.equipment?.serialNumber || order.sensor?.serialNumber || "";

  return (
    <div>
      {/* 헤더 */}
      <div className="bg-white border border-gray-200 rounded-lg p-5 mb-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h2 className="text-xl font-bold text-gray-900">{order.orderNumber}</h2>
            <p className="text-sm text-gray-500 mt-1">
              {order.customer?.name || "자사 장비"} &middot; {assetName}
              {serialNumber && <span className="text-gray-400 ml-1">(S.N: {serialNumber})</span>}
            </p>
          </div>
          <span className={`px-3 py-1 rounded-lg text-sm font-semibold ${STATUS_COLORS[order.status]}`}>
            {STATUS_LABELS[order.status]}
          </span>
        </div>

        {/* 상태 플로우 */}
        <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-1">
          {STATUS_FLOW.map((s, i) => {
            const current = order.status === s;
            const passed = STATUS_FLOW.indexOf(order.status) > i;
            return (
              <div key={s} className="flex items-center">
                {i > 0 && <span className={`mx-0.5 text-xs ${passed ? "text-blue-400" : "text-gray-300"}`}>&rarr;</span>}
                <span className={`text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap ${
                  current ? "bg-blue-600 text-white font-semibold" :
                  passed ? "bg-blue-100 text-blue-600" : "bg-gray-100 text-gray-400"
                }`}>
                  {STATUS_LABELS[s]}
                </span>
              </div>
            );
          })}
        </div>

        {/* 이중 상태 + 상태 변경 버튼 */}
        <div className="flex flex-wrap items-center gap-3">
          <DualStatusField label="점검상황" value={order.techStatus || ""} onSave={updateTechStatus} />
          <DualStatusField label="영업상황" value={order.salesStatus || ""} onSave={updateSalesStatus} />
          <div className="ml-auto flex gap-2">
            {transitions.map((t) => (
              <button key={t} onClick={() => changeStatus(t)} disabled={saving}
                className="px-3 py-1.5 text-xs font-medium border border-gray-300 rounded-lg hover:bg-blue-50 hover:border-blue-300 hover:text-blue-600 disabled:opacity-50">
                &rarr; {STATUS_LABELS[t]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 border-b border-gray-200 mb-4">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* 탭 내용 */}
      {tab === "info" && <InfoTab order={order} onUpdate={updateField} />}
      {tab === "inspection" && <InspectionTab order={order} onUpdate={updateField} onReload={load} />}
      {tab === "report" && <ReportTab order={order} onReload={load} />}
      {tab === "cost" && <CostTab order={order} onReload={load} />}
      {tab === "manufacturer" && <ManufacturerTab order={order} onReload={load} />}
      {tab === "history" && <HistoryTab order={order} />}
    </div>
  );
}

// ─── 이중 상태 편집 필드 ─────────────────────────────────────────────────

function DualStatusField({ label, value, onSave }: { label: string; value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const save = () => {
    if (draft !== value) onSave(draft);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <span className="text-xs text-gray-500">{label}:</span>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus
          onBlur={save} onKeyDown={(e) => e.key === "Enter" && save()}
          className="px-2 py-1 text-xs border border-blue-300 rounded w-28 focus:outline-none" />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 cursor-pointer" onClick={() => { setDraft(value); setEditing(true); }}>
      <span className="text-xs text-gray-500">{label}:</span>
      <span className="text-xs font-medium text-gray-700 bg-gray-100 px-2 py-0.5 rounded hover:bg-blue-50">
        {value || "-"}
      </span>
    </div>
  );
}

// ─── 기본정보 탭 ─────────────────────────────────────────────────────────

function InfoTab({ order, onUpdate }: { order: any; onUpdate: (f: string, v: any) => void }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="접수 종류" value={order.orderType === "REPAIR" ? "수리" : "납품 점검"} />
        <Field label="우선도" value={{ LOW: "낮음", NORMAL: "보통", HIGH: "높음", URGENT: "긴급" }[order.priority as string] || order.priority} />
        <Field label="고객" value={order.customer?.name || "자사 장비"} />
        <Field label="장비/센서" value={
          (order.customerAsset?.name || order.equipment?.name || order.sensor?.name || "-") +
          (order.customerAsset?.manufacturer ? ` (${order.customerAsset.manufacturer})` : "")
        } />
        <Field label="시리얼 번호" value={order.customerAsset?.serialNumber || order.equipment?.serialNumber || order.sensor?.serialNumber || "-"} />
        <Field label="OT재고NO" value={order.otInventoryNo || "-"} />
        <Field label="현재 위치" value={order.currentLocation || "-"} />
        <Field label="무상 수리" value={order.isWarranty ? "예" : "아니오"} />
        <Field label="접수자" value={order.receivedBy || "-"} />
        <Field label="접수일" value={new Date(order.receivedAt).toLocaleDateString("ko-KR")} />
        <Field label="담당자" value={order.assigneeName || "-"} />
        <Field label="예상 수리 기간" value={order.estimatedDays ? `${order.estimatedDays}일` : "-"} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">접수 증상</label>
        <p className="text-sm text-gray-800 bg-gray-50 rounded-lg p-3 whitespace-pre-wrap">{order.symptom || "-"}</p>
      </div>
      {order.notes && (
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">비고</label>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{order.notes}</p>
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-xs text-gray-500">{label}</span>
      <p className="text-sm font-medium text-gray-800">{value}</p>
    </div>
  );
}

// ─── 점검 탭 ─────────────────────────────────────────────────────────────

function InspectionTab({ order, onUpdate, onReload }: { order: any; onUpdate: (f: string, v: any) => void; onReload: () => void }) {
  const [d1, setD1] = useState(order.diagnosis1st || "");
  const [d2, setD2] = useState(order.diagnosis2nd || "");
  const [details, setDetails] = useState(order.repairDetails || "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await repairApi.updateRepairOrder(order.id, {
        diagnosis1st: d1 || undefined,
        diagnosis2nd: d2 || undefined,
        repairDetails: details || undefined,
      });
      onReload();
    } catch {}
    setSaving(false);
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">1차 점검소견</label>
        <textarea value={d1} onChange={(e) => setD1(e.target.value)} rows={3}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none" />
        <span className="text-xs text-gray-500">점검자: {order.inspector1stName || "-"}</span>
      </div>

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={order.needsMfgRepair}
            onChange={(e) => onUpdate("needsMfgRepair", e.target.checked)}
            className="rounded border-gray-300" />
          제조사 수리 필요
        </label>
        {order.needsMfgRepair && (
          <input type="text" defaultValue={order.mfgReferenceNo || ""} placeholder="Maker Reference No."
            onBlur={(e) => onUpdate("mfgReferenceNo", e.target.value)}
            className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm" />
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">2차 점검소견 (제조사 수리 후)</label>
        <textarea value={d2} onChange={(e) => setD2(e.target.value)} rows={3}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none" />
        <span className="text-xs text-gray-500">점검자: {order.inspector2ndName || "-"}</span>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">수리 내용</label>
        <textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={3}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none" />
      </div>

      <button onClick={save} disabled={saving}
        className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
        {saving ? "저장 중..." : "저장"}
      </button>
    </div>
  );
}

// ─── 보고서 탭 (Phase 2) ────────────────────────────────────────────────

function ReportTab({ order, onReload }: { order: any; onReload: () => void }) {
  const report = order.inspectionReport;
  const [editing, setEditing] = useState(!report);
  const [form, setForm] = useState({
    reportNumber: report?.reportNumber || "",
    symptom: report?.symptom || order.symptom || "",
    inspectorName: report?.inspectorName || "",
    result: report?.result || "",
    needsMfgRepair: report?.needsMfgRepair || false,
    mfgRepairReason: report?.mfgRepairReason || "",
    inspectionSteps: report?.inspectionSteps || [{ step: 1, content: "", result: "" }],
  });
  const [saving, setSaving] = useState(false);

  const updateStep = (idx: number, field: string, value: string) => {
    const steps = [...form.inspectionSteps];
    steps[idx] = { ...steps[idx], [field]: value };
    setForm({ ...form, inspectionSteps: steps });
  };

  const addStep = () => {
    setForm({
      ...form,
      inspectionSteps: [...form.inspectionSteps, { step: form.inspectionSteps.length + 1, content: "", result: "" }],
    });
  };

  const removeStep = (idx: number) => {
    const steps = form.inspectionSteps.filter((_: any, i: number) => i !== idx).map((s: any, i: number) => ({ ...s, step: i + 1 }));
    setForm({ ...form, inspectionSteps: steps });
  };

  const save = async () => {
    setSaving(true);
    try {
      if (report) {
        await repairApi.updateInspectionReport(report.id, form);
      } else {
        await repairApi.createInspectionReport({ ...form, repairOrderId: order.id });
      }
      await onReload();
      setEditing(false);
    } catch (e: any) {
      alert(e.message || "저장 실패");
    }
    setSaving(false);
  };

  if (!editing && report) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm text-gray-800">점검보고서 {report.reportNumber && `(${report.reportNumber})`}</h3>
          <button onClick={() => setEditing(true)} className="text-xs text-blue-600 hover:underline">수정</button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="점검자" value={report.inspectorName || "-"} />
          <Field label="접수증상" value={report.symptom || "-"} />
          <Field label="제조사수리" value={report.needsMfgRepair ? `필요 (${report.mfgRepairReason || "-"})` : "불필요"} />
          <Field label="점검결과" value={report.result || "-"} />
        </div>
        {report.inspectionSteps?.length > 0 && (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-2">점검 내용</label>
            <table className="w-full text-sm border border-gray-200 rounded">
              <thead><tr className="bg-gray-50">
                <th className="py-1.5 px-2 text-left text-xs text-gray-500 w-12">순서</th>
                <th className="py-1.5 px-2 text-left text-xs text-gray-500">점검내용</th>
                <th className="py-1.5 px-2 text-left text-xs text-gray-500 w-32">결과</th>
              </tr></thead>
              <tbody>
                {report.inspectionSteps.map((s: any, i: number) => (
                  <tr key={i} className="border-t border-gray-100">
                    <td className="py-1.5 px-2 text-gray-600">{s.step}</td>
                    <td className="py-1.5 px-2">{s.content}</td>
                    <td className="py-1.5 px-2 text-gray-600">{s.result}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
      <h3 className="font-semibold text-sm text-gray-800">{report ? "보고서 수정" : "보고서 작성"}</h3>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">보고서번호</label>
          <input value={form.reportNumber} onChange={(e) => setForm({ ...form, reportNumber: e.target.value })}
            className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">점검자</label>
          <input value={form.inspectorName} onChange={(e) => setForm({ ...form, inspectorName: e.target.value })}
            className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm" />
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">접수증상</label>
        <textarea value={form.symptom} onChange={(e) => setForm({ ...form, symptom: e.target.value })} rows={2}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none" />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-gray-500">점검 단계</label>
          <button onClick={addStep} className="text-xs text-blue-600 hover:underline">+ 단계 추가</button>
        </div>
        {form.inspectionSteps.map((s: any, i: number) => (
          <div key={i} className="flex gap-2 mb-2">
            <span className="text-xs text-gray-400 pt-2 w-6">{s.step}</span>
            <input value={s.content} onChange={(e) => updateStep(i, "content", e.target.value)} placeholder="점검내용"
              className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm" />
            <input value={s.result} onChange={(e) => updateStep(i, "result", e.target.value)} placeholder="결과"
              className="w-28 px-2 py-1.5 border border-gray-300 rounded text-sm" />
            {form.inspectionSteps.length > 1 && (
              <button onClick={() => removeStep(i)} className="text-xs text-red-400 hover:text-red-600">삭제</button>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.needsMfgRepair}
            onChange={(e) => setForm({ ...form, needsMfgRepair: e.target.checked })}
            className="rounded border-gray-300" />
          제조사 수리 필요
        </label>
        {form.needsMfgRepair && (
          <input value={form.mfgRepairReason} onChange={(e) => setForm({ ...form, mfgRepairReason: e.target.value })}
            placeholder="제조사 수리 사유" className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm" />
        )}
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">점검결과</label>
        <textarea value={form.result} onChange={(e) => setForm({ ...form, result: e.target.value })} rows={2}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none" />
      </div>

      <div className="flex gap-2">
        <button onClick={save} disabled={saving}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
          {saving ? "저장 중..." : "저장"}
        </button>
        {report && (
          <button onClick={() => setEditing(false)}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">취소</button>
        )}
      </div>
    </div>
  );
}

// ─── 견적/비용 탭 (Phase 2+3) ───────────────────────────────────────────

function CostTab({ order, onReload }: { order: any; onReload: () => void }) {
  const [showCostForm, setShowCostForm] = useState(false);
  const [showQuoteForm, setShowQuoteForm] = useState(false);
  const [costForm, setCostForm] = useState({ costType: "DIRECT_EXPENSE", description: "", amount: "", currency: "KRW", notes: "" });
  const [quoteForm, setQuoteForm] = useState({ quoteNumber: "", laborCost: "", partsCost: "", shippingCost: "", notes: "" });
  const [saving, setSaving] = useState(false);

  const saveCost = async () => {
    if (!costForm.amount) return alert("금액을 입력해주세요.");
    setSaving(true);
    try {
      await repairApi.createRepairCost({
        repairOrderId: order.id,
        costType: costForm.costType,
        description: costForm.description || undefined,
        amount: parseFloat(costForm.amount),
        currency: costForm.currency,
        notes: costForm.notes || undefined,
      });
      await onReload();
      setShowCostForm(false);
      setCostForm({ costType: "DIRECT_EXPENSE", description: "", amount: "", currency: "KRW", notes: "" });
    } catch (e: any) { alert(e.message || "저장 실패"); }
    setSaving(false);
  };

  const deleteCost = async (costId: string) => {
    if (!confirm("비용 항목을 삭제하시겠습니까?")) return;
    try { await repairApi.deleteRepairCost(costId); await onReload(); } catch {}
  };

  const saveQuote = async () => {
    const labor = parseFloat(quoteForm.laborCost) || 0;
    const parts = parseFloat(quoteForm.partsCost) || 0;
    const shipping = parseFloat(quoteForm.shippingCost) || 0;
    const total = labor + parts + shipping;
    if (total <= 0) return alert("금액을 입력해주세요.");
    setSaving(true);
    try {
      await repairApi.createRepairQuote({
        repairOrderId: order.id,
        quoteNumber: quoteForm.quoteNumber || undefined,
        laborCost: labor || undefined,
        partsCost: parts || undefined,
        shippingCost: shipping || undefined,
        totalAmount: total,
        notes: quoteForm.notes || undefined,
      });
      await onReload();
      setShowQuoteForm(false);
      setQuoteForm({ quoteNumber: "", laborCost: "", partsCost: "", shippingCost: "", notes: "" });
    } catch (e: any) { alert(e.message || "저장 실패"); }
    setSaving(false);
  };

  const changeQuoteStatus = async (quoteId: string, status: string) => {
    if (!confirm(`견적 상태를 "${QUOTE_STATUS_LABELS[status]}"(으)로 변경하시겠습니까?`)) return;
    try { await repairApi.changeQuoteStatus(quoteId, { status }); await onReload(); } catch (e: any) { alert(e.message || "실패"); }
  };

  const deleteQuote = async (quoteId: string) => {
    if (!confirm("견적을 삭제하시겠습니까?")) return;
    try { await repairApi.deleteRepairQuote(quoteId); await onReload(); } catch (e: any) { alert(e.message || "실패"); }
  };

  const totalCost = (order.costs || []).reduce((s: number, c: any) => s + Number(c.amount || 0), 0);

  return (
    <div className="space-y-4">
      {/* 비용 항목 */}
      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm text-gray-800">비용 항목</h3>
          <button onClick={() => setShowCostForm(!showCostForm)}
            className="text-xs text-blue-600 hover:underline">{showCostForm ? "취소" : "+ 비용 추가"}</button>
        </div>

        {showCostForm && (
          <div className="border border-blue-100 rounded-lg p-3 mb-3 bg-blue-50/30 space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <select value={costForm.costType} onChange={(e) => setCostForm({ ...costForm, costType: e.target.value })}
                className="px-2 py-1.5 border border-gray-300 rounded text-sm">
                {Object.entries(COST_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <input value={costForm.description} onChange={(e) => setCostForm({ ...costForm, description: e.target.value })}
                placeholder="설명" className="px-2 py-1.5 border border-gray-300 rounded text-sm" />
              <input type="number" value={costForm.amount} onChange={(e) => setCostForm({ ...costForm, amount: e.target.value })}
                placeholder="금액" className="px-2 py-1.5 border border-gray-300 rounded text-sm" />
            </div>
            <div className="flex gap-2">
              <input value={costForm.notes} onChange={(e) => setCostForm({ ...costForm, notes: e.target.value })}
                placeholder="비고" className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm" />
              <button onClick={saveCost} disabled={saving}
                className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-semibold disabled:opacity-50">저장</button>
            </div>
          </div>
        )}

        {order.costs?.length > 0 ? (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 text-xs text-gray-500">유형</th>
                  <th className="text-left py-2 text-xs text-gray-500">설명</th>
                  <th className="text-right py-2 text-xs text-gray-500">금액</th>
                  <th className="text-right py-2 text-xs text-gray-500 w-12"></th>
                </tr>
              </thead>
              <tbody>
                {order.costs.map((c: any) => (
                  <tr key={c.id} className="border-t border-gray-100">
                    <td className="py-2">{COST_LABELS[c.costType] || c.costType}</td>
                    <td className="py-2 text-gray-600">{c.description || "-"}</td>
                    <td className="py-2 text-right font-medium">{Number(c.amount).toLocaleString()} {c.currency}</td>
                    <td className="py-2 text-right">
                      <button onClick={() => deleteCost(c.id)} className="text-xs text-red-400 hover:text-red-600">삭제</button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-300">
                  <td colSpan={2} className="py-2 font-semibold text-sm">합계</td>
                  <td className="py-2 text-right font-bold text-blue-600">{totalCost.toLocaleString()} KRW</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </>
        ) : (
          <p className="text-sm text-gray-400">등록된 비용이 없습니다.</p>
        )}
      </div>

      {/* 견적 */}
      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm text-gray-800">견적</h3>
          <button onClick={() => setShowQuoteForm(!showQuoteForm)}
            className="text-xs text-blue-600 hover:underline">{showQuoteForm ? "취소" : "+ 견적 작성"}</button>
        </div>

        {showQuoteForm && (
          <div className="border border-blue-100 rounded-lg p-3 mb-3 bg-blue-50/30 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input value={quoteForm.quoteNumber} onChange={(e) => setQuoteForm({ ...quoteForm, quoteNumber: e.target.value })}
                placeholder="견적번호" className="px-2 py-1.5 border border-gray-300 rounded text-sm" />
              <div></div>
              <input type="number" value={quoteForm.laborCost} onChange={(e) => setQuoteForm({ ...quoteForm, laborCost: e.target.value })}
                placeholder="공임" className="px-2 py-1.5 border border-gray-300 rounded text-sm" />
              <input type="number" value={quoteForm.partsCost} onChange={(e) => setQuoteForm({ ...quoteForm, partsCost: e.target.value })}
                placeholder="부품비" className="px-2 py-1.5 border border-gray-300 rounded text-sm" />
              <input type="number" value={quoteForm.shippingCost} onChange={(e) => setQuoteForm({ ...quoteForm, shippingCost: e.target.value })}
                placeholder="배송비" className="px-2 py-1.5 border border-gray-300 rounded text-sm" />
              <input value={quoteForm.notes} onChange={(e) => setQuoteForm({ ...quoteForm, notes: e.target.value })}
                placeholder="비고" className="px-2 py-1.5 border border-gray-300 rounded text-sm" />
            </div>
            <button onClick={saveQuote} disabled={saving}
              className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-semibold disabled:opacity-50">저장</button>
          </div>
        )}

        {order.quotes?.length > 0 ? (
          order.quotes.map((q: any) => (
            <div key={q.id} className="border border-gray-100 rounded-lg p-3 mb-2">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{q.quoteNumber || "견적"}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${
                    q.status === "APPROVED" ? "bg-green-100 text-green-700" :
                    q.status === "REJECTED" ? "bg-red-100 text-red-700" :
                    q.status === "SENT" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"
                  }`}>{QUOTE_STATUS_LABELS[q.status] || q.status}</span>
                </div>
                <div className="flex gap-1">
                  {q.status === "DRAFT" && (
                    <button onClick={() => changeQuoteStatus(q.id, "SENT")}
                      className="text-xs text-blue-600 hover:underline">발송</button>
                  )}
                  {q.status === "SENT" && (
                    <>
                      <button onClick={() => changeQuoteStatus(q.id, "APPROVED")}
                        className="text-xs text-green-600 hover:underline">승인</button>
                      <button onClick={() => changeQuoteStatus(q.id, "REJECTED")}
                        className="text-xs text-red-600 hover:underline">반려</button>
                    </>
                  )}
                  {q.status === "DRAFT" && (
                    <button onClick={() => deleteQuote(q.id)}
                      className="text-xs text-red-400 hover:underline ml-2">삭제</button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2 text-xs text-gray-600">
                {q.laborCost && <span>공임: {Number(q.laborCost).toLocaleString()}</span>}
                {q.partsCost && <span>부품비: {Number(q.partsCost).toLocaleString()}</span>}
                {q.shippingCost && <span>배송비: {Number(q.shippingCost).toLocaleString()}</span>}
              </div>
              <p className="text-sm font-semibold mt-1">{Number(q.totalAmount).toLocaleString()} {q.currency}</p>
            </div>
          ))
        ) : (
          <p className="text-sm text-gray-400">등록된 견적이 없습니다.</p>
        )}
      </div>
    </div>
  );
}

// ─── 제조사 탭 (Phase 5) ────────────────────────────────────────────────

function ManufacturerTab({ order, onReload }: { order: any; onReload: () => void }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ direction: "OUTBOUND", carrier: "", trackingNumber: "", notes: "" });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await repairApi.createShipment({ repairOrderId: order.id, ...form });
      await onReload();
      setShowForm(false);
      setForm({ direction: "OUTBOUND", carrier: "", trackingNumber: "", notes: "" });
    } catch (e: any) { alert(e.message || "저장 실패"); }
    setSaving(false);
  };

  const changeShipmentStatus = async (shipmentId: string, status: string) => {
    try { await repairApi.changeShipmentStatus(shipmentId, { status }); await onReload(); } catch (e: any) { alert(e.message || "실패"); }
  };

  const SHIPMENT_STATUS: Record<string, string> = {
    PREPARING: "준비중", SHIPPED: "발송완료", IN_TRANSIT: "운송중", DELIVERED: "수령완료",
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm text-gray-800">제조사 발송/입고 이력</h3>
        <button onClick={() => setShowForm(!showForm)}
          className="text-xs text-blue-600 hover:underline">{showForm ? "취소" : "+ 발송/입고 등록"}</button>
      </div>

      {showForm && (
        <div className="border border-blue-100 rounded-lg p-3 mb-3 bg-blue-50/30 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}
              className="px-2 py-1.5 border border-gray-300 rounded text-sm">
              <option value="OUTBOUND">발송 (자사→제조사)</option>
              <option value="INBOUND">입고 (제조사→자사)</option>
            </select>
            <input value={form.carrier} onChange={(e) => setForm({ ...form, carrier: e.target.value })}
              placeholder="운송사" className="px-2 py-1.5 border border-gray-300 rounded text-sm" />
            <input value={form.trackingNumber} onChange={(e) => setForm({ ...form, trackingNumber: e.target.value })}
              placeholder="운송장번호" className="px-2 py-1.5 border border-gray-300 rounded text-sm" />
          </div>
          <div className="flex gap-2">
            <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="비고" className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm" />
            <button onClick={save} disabled={saving}
              className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-semibold disabled:opacity-50">저장</button>
          </div>
        </div>
      )}

      {order.shipments?.length > 0 ? (
        <div className="space-y-3">
          {order.shipments.map((s: any) => (
            <div key={s.id} className="border border-gray-100 rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                    s.direction === "OUTBOUND" ? "bg-orange-100 text-orange-700" : "bg-green-100 text-green-700"
                  }`}>
                    {s.direction === "OUTBOUND" ? "발송" : "입고"}
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">
                    {SHIPMENT_STATUS[s.status] || s.status}
                  </span>
                </div>
                <div className="flex gap-1">
                  {s.status === "PREPARING" && (
                    <button onClick={() => changeShipmentStatus(s.id, "SHIPPED")} className="text-xs text-blue-600 hover:underline">발송완료</button>
                  )}
                  {s.status === "SHIPPED" && (
                    <button onClick={() => changeShipmentStatus(s.id, "DELIVERED")} className="text-xs text-green-600 hover:underline">수령완료</button>
                  )}
                  {s.status === "IN_TRANSIT" && (
                    <button onClick={() => changeShipmentStatus(s.id, "DELIVERED")} className="text-xs text-green-600 hover:underline">수령완료</button>
                  )}
                </div>
              </div>
              {s.carrier && <p className="text-sm text-gray-700">운송사: {s.carrier}</p>}
              {s.trackingNumber && <p className="text-sm text-gray-700">운송장: {s.trackingNumber}</p>}
              {s.shippedAt && <p className="text-xs text-gray-500">발송일: {new Date(s.shippedAt).toLocaleDateString("ko-KR")}</p>}
              {s.receivedAt && <p className="text-xs text-gray-500">입고일: {new Date(s.receivedAt).toLocaleDateString("ko-KR")}</p>}
              {s.notes && <p className="text-xs text-gray-400 mt-1">{s.notes}</p>}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-400">제조사 발송/입고 이력이 없습니다.</p>
      )}

      {order.mfgReferenceNo && (
        <div className="mt-4 p-3 bg-gray-50 rounded-lg">
          <span className="text-xs text-gray-500">Maker Reference No.</span>
          <p className="text-sm font-medium">{order.mfgReferenceNo}</p>
        </div>
      )}
    </div>
  );
}

// ─── 이력 탭 ─────────────────────────────────────────────────────────────

function HistoryTab({ order }: { order: any }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5">
      <h3 className="font-semibold text-sm text-gray-800 mb-3">상태 이력</h3>
      <div className="space-y-2">
        <HistoryItem label="접수" date={order.receivedAt} />
        {order.completedAt && <HistoryItem label="완료" date={order.completedAt} />}
        {order.closedAt && <HistoryItem label="종료" date={order.closedAt} />}
      </div>
      {order.shipments?.length > 0 && (
        <div className="mt-4">
          <h4 className="text-xs font-semibold text-gray-500 mb-2">발송/입고</h4>
          {order.shipments.map((s: any) => (
            <div key={s.id} className="flex items-center gap-2 text-xs text-gray-600 mb-1">
              <span className={s.direction === "OUTBOUND" ? "text-orange-600" : "text-green-600"}>
                {s.direction === "OUTBOUND" ? "발송" : "입고"}
              </span>
              <span>{s.status}</span>
              {s.shippedAt && <span>{new Date(s.shippedAt).toLocaleDateString("ko-KR")}</span>}
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-gray-400 mt-3">
        생성: {new Date(order.createdAt).toLocaleString("ko-KR")} &middot;
        수정: {new Date(order.updatedAt).toLocaleString("ko-KR")}
      </p>
    </div>
  );
}

function HistoryItem({ label, date }: { label: string; date: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-2 h-2 rounded-full bg-blue-500" />
      <span className="text-sm font-medium text-gray-800">{label}</span>
      <span className="text-xs text-gray-500">{new Date(date).toLocaleString("ko-KR")}</span>
    </div>
  );
}
