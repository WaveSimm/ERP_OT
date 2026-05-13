"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { inventoryApi } from "@/lib/api";
import LocationSelect from "@/components/LocationSelect";
import { DateInput } from "@/components/ui/DateInput";
import { usePermission } from "@/hooks/usePermission";

const STATUS_LABELS: Record<string, string> = { IN_STOCK: "재고", RELEASED: "출고", IN_REPAIR: "수리중" };
const STATUS_COLORS: Record<string, string> = { IN_STOCK: "bg-green-100 text-green-700", RELEASED: "bg-blue-100 text-blue-700", IN_REPAIR: "bg-orange-100 text-orange-700" };
const CATEGORY_LABELS: Record<string, string> = { IN_TRANSIT: "미착품", PRODUCT: "상품", RAW_MATERIAL: "원재료", PREV_PRODUCT: "전기상품", PREV_RAW_MATERIAL: "전기원재료" };
const TXN_LABELS: Record<string, string> = { PURCHASE: "입고", TRANSFER: "이동", RELEASE: "출고", RETURN: "반납" };
const TXN_COLORS: Record<string, string> = { PURCHASE: "bg-green-100 text-green-700", RELEASE: "bg-blue-100 text-blue-700", RETURN: "bg-purple-100 text-purple-700", TRANSFER: "bg-gray-100 text-gray-700" };
const COST_LABELS: Record<string, string> = { AS: "A/S", UPGRADE: "업그레이드", PARTS_ADDITION: "부품추가", MODULE_ADDITION: "모듈추가", REPAIR: "수리", OTHER: "기타" };
const AUDIT_ITEM_STATUS_COLORS: Record<string, string> = { PENDING: "bg-gray-100 text-gray-600", MATCHED: "bg-green-100 text-green-700", MISMATCHED: "bg-red-100 text-red-700", MISSING: "bg-orange-100 text-orange-700" };
const AUDIT_ITEM_STATUS_LABELS: Record<string, string> = { PENDING: "미확인", MATCHED: "일치", MISMATCHED: "불일치", MISSING: "누락" };
const AUDIT_STATUS_LABELS: Record<string, string> = { PLANNED: "예정", IN_PROGRESS: "진행중", COMPLETED: "완료" };

export default function InventoryDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { isAdmin } = usePermission();

  const [item, setItem] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!item) return;
    const ok = confirm(
      `정말 재고 [${item.inventoryNo}] 를 삭제하시겠습니까?\n\n` +
      `⚠ 의존 이력(입출고 ${item._count?.transactions ?? 0}건, 원가이력, 재고실사) 도 함께 영구 삭제됩니다.\n` +
      `이 작업은 되돌릴 수 없습니다.\n\n` +
      `(운용 전 데이터 정리용. 운용 도입 후엔 이 버튼은 제거되고 폐기 상태로 대체됩니다.)`
    );
    if (!ok) return;
    setDeleting(true);
    try {
      await inventoryApi.delete(id);
      router.push("/procurement/inventory");
    } catch (e: any) {
      alert(e.message || "삭제 실패");
      setDeleting(false);
    }
  };

  // Edit mode
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ serialNumber: "", category: "", currentLocation: "", currentStatus: "", projectName: "", assigneeName: "", notes: "" });

  // Transaction form
  const [showTxnModal, setShowTxnModal] = useState(false);
  const [txnForm, setTxnForm] = useState({ type: "RELEASE", date: new Date().toISOString().slice(0, 10), toLocation: "", projectName: "", assigneeName: "", notes: "" });

  // Cost form
  const [showCostModal, setShowCostModal] = useState(false);
  const [costForm, setCostForm] = useState({ type: "AS", title: "", cost: "", eventDate: new Date().toISOString().slice(0, 10), vendor: "", notes: "" });

  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await inventoryApi.getById(id);
      setItem(data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const startEdit = () => {
    setEditForm({
      serialNumber: item.serialNumber || "",
      category: item.category || "PRODUCT",
      currentLocation: item.currentLocation || "",
      currentStatus: item.currentStatus || "IN_STOCK",
      projectName: item.projectName || "",
      assigneeName: item.assigneeName || "",
      notes: item.notes || "",
    });
    setEditing(true);
  };

  const handleSaveEdit = async () => {
    setSaving(true);
    try {
      await inventoryApi.update(id, {
        serialNumber: editForm.serialNumber || undefined,
        category: editForm.category,
        currentLocation: editForm.currentLocation || undefined,
        currentStatus: editForm.currentStatus,
        projectName: editForm.projectName || undefined,
        assigneeName: editForm.assigneeName || undefined,
        notes: editForm.notes || undefined,
      });
      setEditing(false);
      load();
    } catch (e: any) { alert(e.message || "저장 실패"); }
    finally { setSaving(false); }
  };

  const handleAddTransaction = async () => {
    setSaving(true);
    try {
      await inventoryApi.createTransaction({
        inventoryItemId: id,
        type: txnForm.type,
        date: txnForm.date,
        toLocation: txnForm.toLocation || undefined,
        projectName: txnForm.projectName || undefined,
        assigneeName: txnForm.assigneeName || undefined,
        notes: txnForm.notes || undefined,
      });
      setShowTxnModal(false);
      setTxnForm({ type: "RELEASE", date: new Date().toISOString().slice(0, 10), toLocation: "", projectName: "", assigneeName: "", notes: "" });
      load();
    } catch (e: any) { alert(e.message); }
    finally { setSaving(false); }
  };

  const handleAddCost = async () => {
    if (!costForm.title || !costForm.cost) { alert("제목과 금액을 입력하세요."); return; }
    setSaving(true);
    try {
      await inventoryApi.addCostEvent({
        inventoryItemId: id,
        type: costForm.type,
        title: costForm.title,
        cost: Number(costForm.cost),
        eventDate: costForm.eventDate,
        vendor: costForm.vendor || undefined,
        notes: costForm.notes || undefined,
      });
      setShowCostModal(false);
      setCostForm({ type: "AS", title: "", cost: "", eventDate: new Date().toISOString().slice(0, 10), vendor: "", notes: "" });
      load();
    } catch (e: any) { alert(e.message); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="text-center py-12 text-gray-400">로딩 중...</div>;
  if (!item) return <div className="text-center py-12 text-red-500">재고를 찾을 수 없습니다.</div>;

  return (
    <div className="space-y-6">
      {/* ── 헤더 ─────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">{item.inventoryNo}</h2>
          <div className="text-sm text-gray-500 mt-1">
            {item.itemName || item.productMaster?.name || "미지정"} · {item.manufacturer || item.productMaster?.manufacturer || ""} · {item.serialNumber || "시리얼 없음"}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-gray-500">TCO (총소유비용)</div>
          <div className="text-xl font-bold">₩{Number(item.totalCostOfOwnership).toLocaleString()}</div>
          {Number(item.totalAdditionalCost) > 0 && (
            <div className="text-xs text-orange-600">추가비용: ₩{Number(item.totalAdditionalCost).toLocaleString()}</div>
          )}
        </div>
      </div>

      {/* ── 1. 기본정보 ──────────────────────────── */}
      <section className="bg-white rounded-lg border">
        <div className="flex items-center justify-between px-5 py-3 border-b bg-gray-50 rounded-t-lg">
          <h3 className="font-semibold text-sm">기본정보</h3>
          {editing ? (
            <div className="flex gap-2">
              <button onClick={() => setEditing(false)} className="px-3 py-1 text-xs border rounded hover:bg-gray-100">취소</button>
              <button onClick={handleSaveEdit} disabled={saving}
                className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">저장</button>
            </div>
          ) : (
            <div className="flex gap-2">
              <button onClick={startEdit} className="px-3 py-1 text-xs border rounded hover:bg-gray-100">편집</button>
              {isAdmin && (
                <button onClick={handleDelete} disabled={deleting}
                  title="운용 전 정리용 — 의존 이력도 함께 영구 삭제됨"
                  className="px-3 py-1 text-xs border border-red-300 text-red-600 rounded hover:bg-red-50 disabled:opacity-50">
                  {deleting ? "삭제 중..." : "🗑 삭제 (ADMIN)"}
                </button>
              )}
            </div>
          )}
        </div>
        <div className="p-5">
          {editing ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">시리얼번호</label>
                <input value={editForm.serialNumber} onChange={(e) => setEditForm(f => ({ ...f, serialNumber: e.target.value }))}
                  className="w-full border rounded px-3 py-1.5 text-sm" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">분류</label>
                <select value={editForm.category} onChange={(e) => setEditForm(f => ({ ...f, category: e.target.value }))}
                  className="w-full border rounded px-3 py-1.5 text-sm">
                  {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">상태</label>
                <select value={editForm.currentStatus} onChange={(e) => setEditForm(f => ({ ...f, currentStatus: e.target.value }))}
                  className="w-full border rounded px-3 py-1.5 text-sm">
                  {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">보관위치</label>
                <LocationSelect value={editForm.currentLocation} onChange={(v) => setEditForm(f => ({ ...f, currentLocation: v }))} />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">프로젝트</label>
                <input value={editForm.projectName} onChange={(e) => setEditForm(f => ({ ...f, projectName: e.target.value }))}
                  className="w-full border rounded px-3 py-1.5 text-sm" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">담당자</label>
                <input value={editForm.assigneeName} onChange={(e) => setEditForm(f => ({ ...f, assigneeName: e.target.value }))}
                  className="w-full border rounded px-3 py-1.5 text-sm" />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-gray-500 mb-1 block">비고</label>
                <textarea value={editForm.notes} onChange={(e) => setEditForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full border rounded px-3 py-1.5 text-sm" rows={3} placeholder="관련 내용을 자유롭게 입력하세요" />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3">
              <InfoField label="분류" value={CATEGORY_LABELS[item.category]} />
              <InfoField label="상태">
                <span className={`text-xs px-2 py-0.5 rounded ${STATUS_COLORS[item.currentStatus] || "bg-gray-100"}`}>
                  {STATUS_LABELS[item.currentStatus]}
                </span>
              </InfoField>
              <InfoField label="보관위치" value={item.currentLocation || "-"} />
              <InfoField label="추적방식" value={item.trackingMode === "INDIVIDUAL" ? "개별추적" : "벌크"} />
              <InfoField label="시리얼번호" value={item.serialNumber || "-"} />
              <InfoField label="단가" value={item.unitPrice ? `₩${Number(item.unitPrice).toLocaleString()}` : "-"} />
              <InfoField label="프로젝트" value={item.projectName || "-"} />
              <InfoField label="담당자" value={item.assigneeName || "-"} />
              {item.orderItem && (
                <InfoField label="발주 연결" value={item.orderItem.order?.orderNumber || item.sourceId} />
              )}
              {item.costSettlement && (
                <>
                  <InfoField label="수입원가정산">
                    <button
                      onClick={() => router.push(`/procurement/settlements/${item.costSettlement.id}`)}
                      className="text-sm font-medium text-blue-600 hover:underline"
                    >
                      {item.costSettlement.declarationNo}
                    </button>
                    <div className="text-xs text-gray-400">{item.costSettlement.supplier}</div>
                  </InfoField>
                  {item.costSettlement.contract && (
                    <InfoField label="계약번호">
                      <button
                        onClick={() => router.push(`/procurement/contracts/${item.costSettlement.contract.id}`)}
                        className="text-sm font-medium text-blue-600 hover:underline"
                      >
                        {item.costSettlement.contract.contractNumber}
                      </button>
                      <div className="text-xs text-gray-400">{item.costSettlement.contract.name} · {item.costSettlement.contract.client}</div>
                    </InfoField>
                  )}
                </>
              )}
              <div className="col-span-2 sm:col-span-4 border-t pt-3 mt-1">
                <div className="text-xs text-gray-500 mb-0.5">비고</div>
                <div className="text-sm whitespace-pre-wrap text-gray-700 min-h-[2rem]">{item.notes || "-"}</div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── 2. 비용 이력 ─────────────────────────── */}
      <section className="bg-white rounded-lg border">
        <div className="flex items-center justify-between px-5 py-3 border-b bg-gray-50 rounded-t-lg">
          <h3 className="font-semibold text-sm">
            비용 이력
            {(item.costEvents || []).length > 0 && (
              <span className="ml-2 text-xs text-gray-400 font-normal">{(item.costEvents || []).length}건</span>
            )}
          </h3>
          <button onClick={() => setShowCostModal(true)} className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700">
            + 추가비용 등록
          </button>
        </div>
        <div className="p-5">
          {(item.costEvents || []).length === 0 ? (
            <div className="text-center py-6 text-gray-400 text-sm">비용 이력이 없습니다.</div>
          ) : (
            <div className="space-y-2">
              {(item.costEvents || []).map((ce: any) => (
                <div key={ce.id} className="border rounded-lg p-3 flex items-center gap-4">
                  <div className="w-20 text-center text-xs font-medium px-2 py-1 rounded bg-orange-100 text-orange-700">
                    {COST_LABELS[ce.type] || ce.type}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{ce.title}</div>
                    {ce.vendor && <div className="text-xs text-gray-500">{ce.vendor}</div>}
                    {ce.description && <div className="text-xs text-gray-400 truncate">{ce.description}</div>}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-medium text-sm">₩{Number(ce.cost).toLocaleString()}</div>
                    <div className="text-xs text-gray-400">{new Date(ce.eventDate).toLocaleDateString("ko-KR")}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── 3. 입출고 이력 ────────────────────────── */}
      <section className="bg-white rounded-lg border">
        <div className="flex items-center justify-between px-5 py-3 border-b bg-gray-50 rounded-t-lg">
          <h3 className="font-semibold text-sm">
            입출고 이력
            {(item.transactions || []).length > 0 && (
              <span className="ml-2 text-xs text-gray-400 font-normal">{(item.transactions || []).length}건</span>
            )}
          </h3>
          <button onClick={() => setShowTxnModal(true)} className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700">
            + 입출고 등록
          </button>
        </div>
        <div className="p-5">
          {(item.transactions || []).length === 0 ? (
            <div className="text-center py-6 text-gray-400 text-sm">입출고 이력이 없습니다.</div>
          ) : (
            <div className="space-y-2">
              {(item.transactions || []).map((txn: any) => (
                <div key={txn.id} className="border rounded-lg p-3 flex items-center gap-4">
                  <div className={`w-16 text-center text-xs font-medium px-2 py-1 rounded ${TXN_COLORS[txn.type] || "bg-gray-100 text-gray-700"}`}>
                    {TXN_LABELS[txn.type]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm">
                      {txn.fromLocation && <span className="text-gray-500">{txn.fromLocation} → </span>}
                      {txn.toLocation || "-"}
                    </div>
                    {txn.projectName && <div className="text-xs text-gray-500">프로젝트: {txn.projectName}</div>}
                    {txn.assigneeName && <div className="text-xs text-gray-500">담당자: {txn.assigneeName}</div>}
                    {txn.notes && <div className="text-xs text-gray-400 truncate">{txn.notes}</div>}
                  </div>
                  <div className="text-xs text-gray-400 shrink-0">{new Date(txn.date).toLocaleDateString("ko-KR")}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── 4. 재고실사 이력 ────────────────────────── */}
      {(item.auditItems || []).length > 0 && (
        <section className="bg-white rounded-lg border">
          <div className="px-5 py-3 border-b bg-gray-50 rounded-t-lg">
            <h3 className="font-semibold text-sm">
              재고실사 이력
              <span className="ml-2 text-xs text-gray-400 font-normal">{(item.auditItems || []).length}건</span>
            </h3>
          </div>
          <div className="p-5">
            <div className="space-y-2">
              {(item.auditItems || []).map((ai: any) => (
                <div key={ai.id} className="border rounded-lg px-3 py-2 flex items-center gap-3 hover:bg-gray-50 cursor-pointer"
                  onClick={() => router.push(`/procurement/audits/${ai.audit?.id}`)}>
                  <span className={`text-xs px-2 py-0.5 rounded whitespace-nowrap ${AUDIT_ITEM_STATUS_COLORS[ai.status]}`}>
                    {AUDIT_ITEM_STATUS_LABELS[ai.status]}
                  </span>
                  <span className="text-sm font-medium truncate">{ai.audit?.name || "-"}</span>
                  <span className="text-xs text-gray-400 whitespace-nowrap">
                    {ai.audit?.plannedDate ? new Date(ai.audit.plannedDate).toLocaleDateString("ko-KR") : ""}
                  </span>
                  <span className="text-xs text-gray-400 whitespace-nowrap ml-auto">
                    {ai.systemQuantity}개{ai.actualQuantity !== null && <span className={ai.status === "MATCHED" ? " text-green-600" : " text-red-600"}> → {ai.actualQuantity}개</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── 입출고 모달 ──────────────────────────── */}
      {showTxnModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowTxnModal(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">입출고 등록</h3>
            <div className="space-y-3">
              <div>
                <label className="text-sm text-gray-600">유형</label>
                <select value={txnForm.type} onChange={(e) => setTxnForm(p => ({ ...p, type: e.target.value }))}
                  className="w-full border rounded px-3 py-2 text-sm">
                  {Object.entries(TXN_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm text-gray-600">날짜</label>
                <DateInput value={txnForm.date} onChange={(e) => setTxnForm(p => ({ ...p, date: e.target.value }))}
                  className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-sm text-gray-600">{txnForm.type === "RELEASE" ? "출고 목적지" : "이동 위치"}</label>
                <LocationSelect value={txnForm.toLocation} onChange={(v) => setTxnForm(p => ({ ...p, toLocation: v }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-gray-600">프로젝트</label>
                  <input value={txnForm.projectName} onChange={(e) => setTxnForm(p => ({ ...p, projectName: e.target.value }))}
                    className="w-full border rounded px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-sm text-gray-600">담당자</label>
                  <input value={txnForm.assigneeName} onChange={(e) => setTxnForm(p => ({ ...p, assigneeName: e.target.value }))}
                    className="w-full border rounded px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="text-sm text-gray-600">메모</label>
                <textarea value={txnForm.notes} onChange={(e) => setTxnForm(p => ({ ...p, notes: e.target.value }))}
                  className="w-full border rounded px-3 py-2 text-sm" rows={2} />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowTxnModal(false)} className="px-4 py-2 border rounded-lg text-sm">취소</button>
              <button onClick={handleAddTransaction} disabled={saving}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50">등록</button>
            </div>
          </div>
        </div>
      )}

      {/* ── 비용 모달 ────────────────────────────── */}
      {showCostModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowCostModal(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">추가비용 등록</h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-gray-600">유형</label>
                  <select value={costForm.type} onChange={(e) => setCostForm(p => ({ ...p, type: e.target.value }))}
                    className="w-full border rounded px-3 py-2 text-sm">
                    {Object.entries(COST_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-sm text-gray-600">날짜</label>
                  <DateInput value={costForm.eventDate} onChange={(e) => setCostForm(p => ({ ...p, eventDate: e.target.value }))}
                    className="w-full border rounded px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="text-sm text-gray-600">제목 *</label>
                <input value={costForm.title} onChange={(e) => setCostForm(p => ({ ...p, title: e.target.value }))}
                  className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-gray-600">금액 (원) *</label>
                  <input type="number" value={costForm.cost} onChange={(e) => setCostForm(p => ({ ...p, cost: e.target.value }))}
                    className="w-full border rounded px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-sm text-gray-600">업체</label>
                  <input value={costForm.vendor} onChange={(e) => setCostForm(p => ({ ...p, vendor: e.target.value }))}
                    className="w-full border rounded px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="text-sm text-gray-600">메모</label>
                <textarea value={costForm.notes} onChange={(e) => setCostForm(p => ({ ...p, notes: e.target.value }))}
                  className="w-full border rounded px-3 py-2 text-sm" rows={2} />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowCostModal(false)} className="px-4 py-2 border rounded-lg text-sm">취소</button>
              <button onClick={handleAddCost} disabled={saving}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50">등록</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoField({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-gray-500 mb-0.5">{label}</div>
      {children || <div className="text-sm font-medium">{value}</div>}
    </div>
  );
}
