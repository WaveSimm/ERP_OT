"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { repairApi, getUser } from "@/lib/api";
import SearchableSelect from "@/components/SearchableSelect";
import FilterableSelect from "@/components/FilterableSelect";

const STATUS_LABELS: Record<string, string> = {
  RECEIVED: "접수", INSPECTING_1ST: "1차점검", QUOTED: "견적발행",
  APPROVED: "승인", REPAIRING: "수리중", SHIPPED_TO_MFG: "제조사로 발송",
  RECEIVED_FROM_MFG: "본사 입고", INSPECTING_2ND: "2차점검",
  COMPLETED: "완료", NO_FAULT: "정상", NO_REPAIR: "수리안함",
  CLOSED: "종료", CANCELLED: "취소",
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

const PRIORITY_LABELS: Record<string, string> = {
  LOW: "낮음", NORMAL: "보통", HIGH: "높음", URGENT: "긴급",
};

const PRIORITY_COLORS: Record<string, string> = {
  LOW: "text-gray-400", NORMAL: "text-gray-600", HIGH: "text-orange-600", URGENT: "text-red-600",
};

const FILTER_GROUPS = [
  { key: "", label: "전체" },
  { key: "received", label: "접수" },
  { key: "inspecting", label: "점검중" },
  { key: "repairing", label: "본사수리중" },
  { key: "manufacturer", label: "제조사수리중" },
  { key: "received_from_mfg", label: "본사입고" },
  { key: "completed", label: "완료" },
];

function daysSince(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  return Math.floor(diff / 86400000);
}

export default function RepairOrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusGroup, setStatusGroup] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await repairApi.getRepairOrders({ statusGroup: statusGroup || undefined, search: search || undefined, page });
      setOrders(res.items);
      setTotal(res.total);
    } catch (e: any) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [statusGroup, search, page]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      {/* 필터 + 검색 */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex bg-gray-100 rounded-lg p-0.5">
          {FILTER_GROUPS.map((f) => (
            <button key={f.key} onClick={() => { setStatusGroup(f.key); setPage(1); }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                statusGroup === f.key ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}>
              {f.label}
            </button>
          ))}
        </div>
        <input
          type="text" placeholder="접수번호, 고객명, 시리얼..."
          value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm w-56 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="ml-auto">
          <button onClick={() => setShowForm(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700">
            + AS 접수
          </button>
        </div>
      </div>

      {/* 목록 테이블 */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm table-fixed">
            <colgroup>
              <col className="w-[88px]" />   {/* 접수번호: max12자 */}
              <col className="w-[140px]" />  {/* 고객: 20자 */}
              <col className="w-[200px]" />  {/* 장비: 30자 */}
              <col className="w-[140px]" />  {/* S.N: 20자 */}
              <col className="w-[72px]" />   {/* 상태 */}
              <col className="w-[96px]" />   {/* 점검상황 */}
              <col className="w-[72px]" />   {/* 영업상황 */}
              <col className="w-[52px]" />   {/* 우선도 */}
              <col className="w-[56px]" />   {/* 담당자: 3자 */}
              <col className="w-[60px]" />   {/* 접수일 */}
              <col className="w-[48px]" />   {/* 경과 */}
            </colgroup>
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-2 py-2.5 text-left text-xs font-semibold text-gray-500">접수번호</th>
                <th className="px-2 py-2.5 text-left text-xs font-semibold text-gray-500">고객</th>
                <th className="px-2 py-2.5 text-left text-xs font-semibold text-gray-500">장비</th>
                <th className="px-2 py-2.5 text-left text-xs font-semibold text-gray-500">S.N</th>
                <th className="px-2 py-2.5 text-center text-xs font-semibold text-gray-500">상태</th>
                <th className="px-2 py-2.5 text-left text-xs font-semibold text-gray-500">점검상황</th>
                <th className="px-2 py-2.5 text-left text-xs font-semibold text-gray-500">영업상황</th>
                <th className="px-2 py-2.5 text-center text-xs font-semibold text-gray-500">우선도</th>
                <th className="px-2 py-2.5 text-left text-xs font-semibold text-gray-500">담당자</th>
                <th className="px-2 py-2.5 text-center text-xs font-semibold text-gray-500">접수일</th>
                <th className="px-2 py-2.5 text-center text-xs font-semibold text-gray-500">경과</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={11} className="text-center py-8 text-gray-400">불러오는 중...</td></tr>
              )}
              {!loading && orders.length === 0 && (
                <tr><td colSpan={11} className="text-center py-8 text-gray-400">AS 접수 내역이 없습니다.</td></tr>
              )}
              {!loading && orders.map((o) => {
                const assetName = o.customerAsset?.name || o.equipment?.name || o.sensor?.name || o.productName || "-";
                const serialNumber = o.customerAsset?.serialNumber || o.equipment?.serialNumber || o.sensor?.serialNumber || o.productSerial || "-";
                return (
                  <tr key={o.id} onClick={() => router.push(`/repair/${o.id}`)}
                    className="border-t border-gray-100 hover:bg-blue-50/50 cursor-pointer">
                    <td className="px-2 py-2 font-medium text-blue-600 truncate">{o.orderNumber}</td>
                    <td className="px-2 py-2 text-gray-800 truncate" title={o.customer?.name}>{o.customer?.name || "-"}</td>
                    <td className="px-2 py-2 text-gray-700 truncate" title={assetName}>{assetName}</td>
                    <td className="px-2 py-2 text-gray-500 text-xs truncate" title={serialNumber}>{serialNumber}</td>
                    <td className="px-2 py-2 text-center">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium whitespace-nowrap ${STATUS_COLORS[o.status] || "bg-gray-100"}`}>
                        {STATUS_LABELS[o.status] || o.status}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-gray-600 text-xs truncate" title={o.techStatus}>{o.techStatus || "-"}</td>
                    <td className="px-2 py-2 text-gray-600 text-xs truncate">{o.salesStatus || "-"}</td>
                    <td className={`px-2 py-2 text-center text-xs font-medium ${PRIORITY_COLORS[o.priority]}`}>
                      {PRIORITY_LABELS[o.priority]}
                    </td>
                    <td className="px-2 py-2 text-gray-700 text-xs">{o.assigneeName || "-"}</td>
                    <td className="px-2 py-2 text-center text-gray-500 text-xs whitespace-nowrap">
                      {new Date(o.receivedAt).toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" })}
                    </td>
                    <td className="px-2 py-2 text-center text-gray-500 text-xs whitespace-nowrap">
                      {o.status !== "CLOSED" && o.status !== "CANCELLED" ? `${daysSince(o.receivedAt)}일` : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 페이지네이션 */}
        {total > 50 && (
          <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between text-xs text-gray-500">
            <span>총 {total}건</span>
            <div className="flex gap-1">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)}
                className="px-2 py-1 rounded border border-gray-200 disabled:opacity-30">이전</button>
              <span className="px-2 py-1">{page}</span>
              <button disabled={page * 50 >= total} onClick={() => setPage(page + 1)}
                className="px-2 py-1 rounded border border-gray-200 disabled:opacity-30">다음</button>
            </div>
          </div>
        )}
      </div>

      {/* AS 접수 모달 */}
      {showForm && (
        <RepairOrderForm
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); load(); }}
        />
      )}
    </div>
  );
}

// ─── AS 접수 폼 모달 ─────────────────────────────────────────────────────

function RepairOrderForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    orderType: "REPAIR",
    priority: "NORMAL",
    customerId: "",
    customerAssetId: "",
    symptom: "",
    currentLocation: "",
    isWarranty: false,
    receivedBy: getUser()?.name || "",
    notes: "",
  });
  const [customerName, setCustomerName] = useState("");
  const [assets, setAssets] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (form.customerId) {
      repairApi.getCustomerAssets({ customerId: form.customerId, limit: 500 }).then((r) => setAssets(r.items)).catch(() => {});
    } else {
      setAssets([]);
    }
  }, [form.customerId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await repairApi.createRepairOrder({
        ...form,
        customerId: form.customerId || undefined,
        customerAssetId: form.customerAssetId || undefined,
      });
      onSaved();
    } catch (e: any) {
      setError(e.message || "접수 실패");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">AS 접수</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          {/* 접수 종류 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">접수 종류</label>
              <select value={form.orderType} onChange={(e) => setForm((f) => ({ ...f, orderType: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="REPAIR">수리</option>
                <option value="DELIVERY">납품 점검</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">우선도</label>
              <select value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="LOW">낮음</option>
                <option value="NORMAL">보통</option>
                <option value="HIGH">높음</option>
                <option value="URGENT">긴급</option>
              </select>
            </div>
          </div>

          {/* 고객 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">고객</label>
            <div className="flex gap-2">
              <div className="flex-1">
                <SearchableSelect
                  value={customerName}
                  onChange={(v) => {
                    if (!v) {
                      setCustomerName("");
                      setForm((f) => ({ ...f, customerId: "", customerAssetId: "" }));
                    }
                  }}
                  onSelect={(opt) => {
                    if (opt) {
                      setCustomerName(opt.name);
                      setForm((f) => ({ ...f, customerId: opt.id, customerAssetId: "" }));
                    }
                  }}
                  placeholder="고객 검색... (비우면 자사 장비)"
                  loadOptions={async (q) => {
                    const res = await repairApi.getCustomers({ search: q, limit: 20 });
                    return (res.items || res).map((c: any) => ({ id: c.id, name: c.name, sub: c.businessNo || undefined }));
                  }}
                />
              </div>
              {form.customerId && (
                <button type="button" onClick={() => { setCustomerName(""); setForm((f) => ({ ...f, customerId: "", customerAssetId: "" })); }}
                  className="px-2 text-gray-400 hover:text-red-500 text-sm">✕</button>
              )}
            </div>
            {!form.customerId && <p className="text-xs text-gray-400 mt-1">자사 장비 (고객 없음)</p>}
          </div>

          {/* 고객 자산 */}
          {form.customerId && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">고객 장비/센서</label>
              <FilterableSelect
                value={form.customerAssetId}
                onChange={(v) => setForm((f) => ({ ...f, customerAssetId: v }))}
                options={assets.map((a: any) => ({
                  value: a.id,
                  label: `${a.name} ${a.serialNumber ? `(${a.serialNumber})` : ""}`,
                  sub: a.manufacturer || undefined,
                }))}
                placeholder="장비 선택..."
              />
            </div>
          )}

          {/* 접수 증상 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">접수 증상</label>
            <textarea value={form.symptom} onChange={(e) => setForm((f) => ({ ...f, symptom: e.target.value }))}
              rows={3} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none"
              placeholder="고장 증상을 입력하세요..." />
          </div>

          {/* 현재위치 + 무상여부 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">현재 위치</label>
              <input type="text" value={form.currentLocation}
                onChange={(e) => setForm((f) => ({ ...f, currentLocation: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="예: 본사" />
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.isWarranty}
                  onChange={(e) => setForm((f) => ({ ...f, isWarranty: e.target.checked }))}
                  className="rounded border-gray-300" />
                무상 수리
              </label>
            </div>
          </div>

          {/* 접수자 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">접수자</label>
            <input type="text" value={form.receivedBy}
              onChange={(e) => setForm((f) => ({ ...f, receivedBy: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>

          {/* 비고 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">비고</label>
            <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none" />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">취소</button>
            <button type="submit" disabled={saving}
              className="flex-1 bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
              {saving ? "접수 중..." : "접수"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
