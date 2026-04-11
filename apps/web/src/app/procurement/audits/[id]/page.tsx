"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { auditApi } from "@/lib/api";

const ITEM_STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-gray-100 text-gray-600",
  MATCHED: "bg-green-100 text-green-700",
  MISMATCHED: "bg-red-100 text-red-700",
  MISSING: "bg-orange-100 text-orange-700",
};
const ITEM_STATUS_LABELS: Record<string, string> = { PENDING: "미확인", MATCHED: "일치", MISMATCHED: "불일치", MISSING: "누락" };
const AUDIT_STATUS_LABELS: Record<string, string> = { PLANNED: "예정", IN_PROGRESS: "진행중", COMPLETED: "완료" };

export default function AuditDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [audit, setAudit] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [checkForm, setCheckForm] = useState({ actualQuantity: "", actualLocation: "", notes: "" });

  const load = useCallback(async () => {
    try { setAudit(await auditApi.getById(id)); }
    catch { }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const handleStart = async () => { await auditApi.start(id); load(); };
  const handleComplete = async () => { await auditApi.complete(id); load(); };

  const handleCheck = async () => {
    if (!checkingId || checkForm.actualQuantity === "") return;
    await auditApi.checkItem(checkingId, {
      actualQuantity: Number(checkForm.actualQuantity),
      actualLocation: checkForm.actualLocation || undefined,
      notes: checkForm.notes || undefined,
    });
    setCheckingId(null);
    setCheckForm({ actualQuantity: "", actualLocation: "", notes: "" });
    load();
  };

  if (loading) return <div className="text-center py-12 text-gray-400">로딩 중...</div>;
  if (!audit) return <div className="text-center py-12 text-red-500">실사를 찾을 수 없습니다.</div>;

  const items = (audit.items || []).filter((i: any) => !filter || i.status === filter);
  const stats = {
    total: audit.items?.length || 0,
    checked: audit.items?.filter((i: any) => i.status !== "PENDING").length || 0,
    matched: audit.items?.filter((i: any) => i.status === "MATCHED").length || 0,
    mismatched: audit.items?.filter((i: any) => i.status === "MISMATCHED").length || 0,
    missing: audit.items?.filter((i: any) => i.status === "MISSING").length || 0,
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold">{audit.name}</h2>
          <div className="text-sm text-gray-500">
            {AUDIT_STATUS_LABELS[audit.status]} · 예정: {new Date(audit.plannedDate).toLocaleDateString("ko-KR")}
          </div>
        </div>
        <div className="flex gap-2">
          {audit.status === "PLANNED" && (
            <button onClick={handleStart} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">실사 시작</button>
          )}
          {audit.status === "IN_PROGRESS" && (
            <button onClick={handleComplete} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm">실사 완료</button>
          )}
        </div>
      </div>

      {/* 진행 통계 */}
      <div className="grid grid-cols-5 gap-3 mb-6">
        <div className="bg-white border rounded-lg p-3 text-center">
          <div className="text-xs text-gray-500">전체</div><div className="text-lg font-bold">{stats.total}</div>
        </div>
        <div className="bg-white border rounded-lg p-3 text-center">
          <div className="text-xs text-gray-500">확인</div><div className="text-lg font-bold text-blue-600">{stats.checked}</div>
        </div>
        <div className="bg-white border rounded-lg p-3 text-center">
          <div className="text-xs text-gray-500">일치</div><div className="text-lg font-bold text-green-600">{stats.matched}</div>
        </div>
        <div className="bg-white border rounded-lg p-3 text-center">
          <div className="text-xs text-gray-500">불일치</div><div className="text-lg font-bold text-red-600">{stats.mismatched}</div>
        </div>
        <div className="bg-white border rounded-lg p-3 text-center">
          <div className="text-xs text-gray-500">누락</div><div className="text-lg font-bold text-orange-600">{stats.missing}</div>
        </div>
      </div>

      {/* 필터 */}
      <div className="flex gap-2 mb-4">
        {["", "PENDING", "MATCHED", "MISMATCHED", "MISSING"].map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded-full text-xs ${filter === f ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600"}`}>
            {f ? ITEM_STATUS_LABELS[f] : "전체"}
          </button>
        ))}
      </div>

      {/* 항목 목록 */}
      <div className="space-y-2">
        {items.map((item: any) => (
          <div key={item.id} className="bg-white border rounded-lg p-3 flex items-center gap-4">
            <div className="flex-1">
              <div className="text-sm font-medium">{item.inventoryItem?.inventoryNo}</div>
              <div className="text-xs text-gray-500">{item.inventoryItem?.productMaster?.name || "-"}</div>
              <div className="text-xs text-gray-400">
                시스템: {item.systemQuantity}개 / {item.systemLocation || "위치미상"}
                {item.actualQuantity !== null && ` → 실제: ${item.actualQuantity}개`}
              </div>
            </div>
            <span className={`text-xs px-2 py-1 rounded ${ITEM_STATUS_COLORS[item.status]}`}>
              {ITEM_STATUS_LABELS[item.status]}
            </span>
            {audit.status === "IN_PROGRESS" && item.status === "PENDING" && (
              <button onClick={() => { setCheckingId(item.id); setCheckForm({ actualQuantity: String(item.systemQuantity), actualLocation: item.systemLocation || "", notes: "" }); }}
                className="px-3 py-1 text-xs bg-blue-600 text-white rounded">확인</button>
            )}
          </div>
        ))}
      </div>

      {/* 체크 모달 */}
      {checkingId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setCheckingId(null)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">실사 확인</h3>
            <div className="space-y-3">
              <div>
                <label className="text-sm text-gray-600">실제 수량</label>
                <input type="number" value={checkForm.actualQuantity} onChange={(e) => setCheckForm(p => ({ ...p, actualQuantity: e.target.value }))}
                  className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-sm text-gray-600">실제 위치</label>
                <input value={checkForm.actualLocation} onChange={(e) => setCheckForm(p => ({ ...p, actualLocation: e.target.value }))}
                  className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-sm text-gray-600">메모</label>
                <textarea value={checkForm.notes} onChange={(e) => setCheckForm(p => ({ ...p, notes: e.target.value }))}
                  className="w-full border rounded px-3 py-2 text-sm" rows={2} />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setCheckingId(null)} className="px-4 py-2 border rounded-lg text-sm">취소</button>
              <button onClick={handleCheck} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">확인</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
