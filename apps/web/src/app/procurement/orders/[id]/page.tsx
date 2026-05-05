"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { procurementApi, approvalApi, approvalLineApi, supplierApi } from "@/lib/api";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "초안", PENDING_APPROVAL: "승인대기", APPROVED: "승인",
  REJECTED: "반려", ORDERED: "발주완료", IN_PRODUCTION: "제작중",
  SHIPPED: "출하/선적", CUSTOMS: "통관중", PARTIALLY_RECEIVED: "부분입고",
  ARRIVED: "입고완료", CLOSED: "마감",
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  PENDING_APPROVAL: "bg-yellow-100 text-yellow-700",
  APPROVED: "bg-green-100 text-green-700",
  REJECTED: "bg-red-100 text-red-700",
  ORDERED: "bg-blue-100 text-blue-700",
  IN_PRODUCTION: "bg-indigo-100 text-indigo-700",
  SHIPPED: "bg-purple-100 text-purple-700",
  CUSTOMS: "bg-orange-100 text-orange-700",
  PARTIALLY_RECEIVED: "bg-amber-100 text-amber-700",
  ARRIVED: "bg-emerald-100 text-emerald-700",
  CLOSED: "bg-gray-200 text-gray-600",
};

const RECEIPT_LABELS: Record<string, string> = {
  PENDING: "미입고", PARTIALLY_RECEIVED: "부분입고", FULLY_RECEIVED: "입고완료",
};

const STEP_STATUS_LABELS: Record<string, string> = {
  PENDING: "대기", APPROVED: "승인", REJECTED: "반려", SKIPPED: "건너뜀",
};

const CURRENCY_SYMBOLS: Record<string, string> = {
  EUR: "\u20AC", GBP: "\u00A3", USD: "$", KRW: "\u20A9",
};

function fmtAmount(val: string | number, currency?: string) {
  const n = Number(val);
  const sym = currency ? (CURRENCY_SYMBOLS[currency] || currency) : "";
  return `${sym}${n.toLocaleString("ko-KR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function fmtDate(d: string | null) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("ko-KR");
}

import { fmtDateTime24 } from "@/lib/datetime";
function fmtDateTime(d: string | null) {
  if (!d) return "-";
  return fmtDateTime24(d);
}

export default function OrderDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [transitioning, setTransitioning] = useState(false);

  // Approval
  const [approvalDoc, setApprovalDoc] = useState<any>(null);
  const [rejectComment, setRejectComment] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);

  // Receive form
  const [showReceive, setShowReceive] = useState(false);
  const [receiveQtys, setReceiveQtys] = useState<Record<string, number>>({});

  // Inventory link
  const [linkItemId, setLinkItemId] = useState<string | null>(null);
  const [linkInvNo, setLinkInvNo] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const o = await procurementApi.getOrder(id);
      setOrder(o);

      // 결재 문서 조회
      try {
        const doc = await approvalApi.getDocumentByReference("ORDER", id);
        setApprovalDoc(doc || null);
      } catch { setApprovalDoc(null); }
    } catch {
      router.push("/procurement");
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => { load(); }, [load]);

  const handleTransition = async (status: string) => {
    if (!confirm(`상태를 "${STATUS_LABELS[status]}"(으)로 변경하시겠습니까?`)) return;
    setTransitioning(true);
    try {
      await procurementApi.transitionOrder(id, status);
      await load();
    } catch (e: any) {
      alert(e.message || "상태 전환 실패");
    } finally {
      setTransitioning(false);
    }
  };

  const handleSubmitApproval = async () => {
    if (!confirm("결재를 상신하시겠습니까?")) return;
    setTransitioning(true);
    try {
      const templates = await approvalApi.getTemplates();
      const poTemplate = templates.find((t: any) => t.code === "PO");
      if (!poTemplate) throw new Error("구매 발주서 결재 템플릿을 찾을 수 없습니다.");

      const line = await approvalLineApi.getMe();
      if (!line) throw new Error("결재라인이 설정되지 않았습니다.");

      const steps: any[] = [{ stepOrder: 1, roleName: "1차 결재", approverId: line.approverId, approverName: line.approverName || "" }];
      if (line.secondApproverId && line.secondApproverId !== line.approverId) {
        steps.push({ stepOrder: 2, roleName: "2차 결재", approverId: line.secondApproverId, approverName: line.secondApproverName || "" });
      }

      const itemsData = order.items?.map((i: any) => ({
        name: i.name, spec: i.spec || "", quantity: i.quantity,
        unitPrice: Number(i.unitPrice), amount: Number(i.amount),
      }));

      const doc = await approvalApi.createDocument({
        templateId: poTemplate.id,
        title: `구매발주서 - ${order.orderNumber} (${order.manufacturer})`,
        department: "영업팀",
        approvalStepCount: steps.length,
        referenceType: "ORDER",
        referenceId: id,
        itemsData,
        itemsTotal: Number(order.totalAmount),
        amount: Number(order.totalAmount),
        content: {
          orderNumber: order.orderNumber,
          manufacturer: order.manufacturer,
          currency: order.currency,
          contractNumber: order.contract?.contractNumber,
        },
        notes: order.notes || undefined,
        steps,
      });

      await approvalApi.submitDocument(doc.id);
      await procurementApi.transitionOrder(id, "PENDING_APPROVAL");
      await load();
    } catch (e: any) {
      alert(e.message || "결재 상신 실패");
    } finally {
      setTransitioning(false);
    }
  };

  const handleApprove = async () => {
    if (!approvalDoc || !confirm("승인하시겠습니까?")) return;
    try {
      await approvalApi.approveDocument(approvalDoc.id);
      await load();
    } catch (e: any) {
      alert(e.message || "승인 실패");
    }
  };

  const handleReject = async () => {
    if (!approvalDoc || !rejectComment.trim()) {
      alert("반려 사유를 입력해주세요.");
      return;
    }
    try {
      await approvalApi.rejectDocument(approvalDoc.id, rejectComment);
      setShowRejectForm(false);
      setRejectComment("");
      await load();
    } catch (e: any) {
      alert(e.message || "반려 실패");
    }
  };

  const handleReceive = async () => {
    const receipts = Object.entries(receiveQtys)
      .filter(([, qty]) => qty > 0)
      .map(([itemId, quantity]) => ({ itemId, quantity }));
    if (receipts.length === 0) return alert("입고 수량을 입력해주세요.");
    try {
      await procurementApi.receiveItems(id, receipts);
      setShowReceive(false);
      setReceiveQtys({});
      await load();
    } catch (e: any) {
      alert(e.message || "입고 처리 실패");
    }
  };

  const handleLinkInventory = async () => {
    if (!linkItemId || !linkInvNo.trim()) return;
    try {
      await procurementApi.linkInventory(linkItemId, linkInvNo.trim());
      setLinkItemId(null);
      setLinkInvNo("");
      await load();
    } catch (e: any) {
      alert(e.message || "재고 연결 실패");
    }
  };

  const handleUnlinkInventory = async (itemId: string, inventoryId: string) => {
    if (!confirm("재고 연결을 해제하시겠습니까?")) return;
    try {
      await procurementApi.unlinkInventory(itemId, inventoryId);
      await load();
    } catch (e: any) {
      alert(e.message || "연결 해제 실패");
    }
  };

  if (loading || !order) {
    return <div className="flex items-center justify-center h-64 text-gray-400">로딩 중...</div>;
  }

  const canReceive = ["CUSTOMS", "PARTIALLY_RECEIVED"].includes(order.status);

  // 현재 결재 단계에서 내가 결재자인지 확인
  const currentPendingStep = approvalDoc?.steps?.find((s: any) => s.status === "PENDING");

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => router.push("/procurement")} className="text-gray-400 hover:text-gray-600">&larr;</button>
        <div>
          <h1 className="text-xl font-bold">{order.orderNumber}</h1>
          <p className="text-sm text-gray-500">{order.manufacturer} | {order.contract?.name || order.contract?.contractNumber}</p>
        </div>
        <span className={`ml-3 px-3 py-1 rounded-full text-sm font-medium ${STATUS_COLORS[order.status]}`}>
          {STATUS_LABELS[order.status]}
        </span>
        <div className="ml-auto flex gap-2">
          {order.status === "DRAFT" && (
            <button
              onClick={handleSubmitApproval}
              disabled={transitioning}
              className="px-3 py-1.5 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50"
            >
              결재 상신
            </button>
          )}
          {order.status !== "DRAFT" && order.allowedTransitions?.filter((t: string) => !["PENDING_APPROVAL", "APPROVED", "REJECTED"].includes(t)).map((t: string) => (
            <button
              key={t}
              onClick={() => handleTransition(t)}
              disabled={transitioning}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {STATUS_LABELS[t]}
            </button>
          ))}
          {canReceive && (
            <button
              onClick={() => setShowReceive(true)}
              className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700"
            >
              입고 처리
            </button>
          )}
        </div>
      </div>

      {/* 결재 현황 — 상신 이후에만 표시 */}
      {approvalDoc && (
        <div className={`rounded-lg border p-4 mb-4 ${
          approvalDoc.status === "APPROVED" ? "bg-green-50 border-green-200" :
          approvalDoc.status === "REJECTED" ? "bg-red-50 border-red-200" :
          approvalDoc.status === "DRAFT" ? "bg-gray-50 border-gray-200" :
          "bg-yellow-50 border-yellow-200"
        }`}>
          <div className="flex items-center gap-4 mb-3">
            <h3 className="font-medium text-sm">결재 현황</h3>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
              approvalDoc.status === "APPROVED" ? "bg-green-100 text-green-700" :
              approvalDoc.status === "REJECTED" ? "bg-red-100 text-red-700" :
              approvalDoc.status === "DRAFT" ? "bg-gray-100 text-gray-600" :
              "bg-yellow-100 text-yellow-700"
            }`}>
              {approvalDoc.status === "APPROVED" ? "승인완료" :
               approvalDoc.status === "REJECTED" ? "반려" :
               approvalDoc.status === "DRAFT" ? "초안" :
               "결재진행중"}
            </span>
            {approvalDoc.requesterName && (
              <span className="text-xs text-gray-500">기안: {approvalDoc.requesterName}</span>
            )}
          </div>

          {/* 결재 단계 스텝 표시 */}
          <div className="flex items-center gap-2 mb-3">
            {approvalDoc.steps?.map((step: any, idx: number) => (
              <div key={step.id} className="flex items-center gap-2">
                {idx > 0 && <span className="text-gray-300">&rarr;</span>}
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ${
                  step.status === "APPROVED" ? "bg-green-100 text-green-800" :
                  step.status === "REJECTED" ? "bg-red-100 text-red-800" :
                  step.status === "PENDING" && idx === approvalDoc.steps.findIndex((s: any) => s.status === "PENDING")
                    ? "bg-white border-2 border-yellow-400 text-yellow-800 font-medium"
                    : "bg-gray-100 text-gray-500"
                }`}>
                  <span>{step.roleName}</span>
                  <span className="font-medium">{step.approverName}</span>
                  {step.status === "APPROVED" && <span className="text-green-600 text-xs">&#10003;</span>}
                  {step.status === "REJECTED" && <span className="text-red-600 text-xs">&#10007;</span>}
                </div>
              </div>
            ))}
          </div>

          {/* 반려 사유 표시 */}
          {approvalDoc.status === "REJECTED" && approvalDoc.steps?.some((s: any) => s.status === "REJECTED" && s.comment) && (
            <div className="text-sm text-red-700 bg-red-100 rounded px-3 py-2 mb-3">
              <span className="font-medium">반려 사유: </span>
              {approvalDoc.steps.find((s: any) => s.status === "REJECTED")?.comment}
            </div>
          )}

          {/* 결재 액션 — 현재 대기중인 결재자에게만 */}
          {currentPendingStep && /PENDING/.test(approvalDoc.status) && approvalDoc.status !== "DRAFT" && (
            <div className="flex items-center gap-2 pt-2 border-t border-yellow-200">
              <span className="text-sm text-gray-600 mr-2">내 차례:</span>
              <button
                onClick={handleApprove}
                className="px-4 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700"
              >
                승인
              </button>
              {showRejectForm ? (
                <div className="flex items-center gap-2 flex-1">
                  <input
                    type="text"
                    value={rejectComment}
                    onChange={(e) => setRejectComment(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleReject()}
                    placeholder="반려 사유 입력..."
                    className="flex-1 border rounded-lg px-3 py-1.5 text-sm"
                    autoFocus
                  />
                  <button onClick={handleReject} className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700">반려</button>
                  <button onClick={() => { setShowRejectForm(false); setRejectComment(""); }} className="text-gray-400 hover:text-gray-600 text-sm">취소</button>
                </div>
              ) : (
                <button
                  onClick={() => setShowRejectForm(true)}
                  className="px-4 py-1.5 text-sm border border-red-300 text-red-600 rounded-lg hover:bg-red-50"
                >
                  반려
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Summary */}
      <div className="flex items-center gap-6 bg-white rounded-lg border px-4 py-2.5 mb-4 text-sm">
        <div>
          <span className="text-gray-400 text-xs">금액</span>
          <div className="font-bold font-mono">{fmtAmount(order.totalAmount, order.currency)}
            {order.totalAmountKRW && <span className="text-xs text-gray-400 font-normal ml-1">({fmtAmount(order.totalAmountKRW, "KRW")})</span>}
          </div>
        </div>
        <div className="h-6 w-px bg-gray-200" />
        <div><span className="text-gray-400 text-xs">발주일</span><div>{fmtDate(order.orderDate)}</div></div>
        <div className="h-6 w-px bg-gray-200" />
        <div><span className="text-gray-400 text-xs">예상 출하일</span><div>{fmtDate(order.estimatedShipDate)}</div></div>
        <div className="h-6 w-px bg-gray-200" />
        <div><span className="text-gray-400 text-xs">입고일</span><div>{fmtDate(order.arrivalDate)}</div></div>
      </div>

      {/* 상세 정보 */}
      <div className="bg-white rounded-lg border p-6 mb-4">
        <h3 className="font-medium mb-4">상세 정보</h3>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-12 gap-y-4 text-sm">
          <div><span className="text-gray-500">계약번호:</span> {order.contract ? <a href={`/procurement/contracts/${order.contract.id}`} className="ml-2 text-blue-600 hover:underline">{order.contract.contractNumber}</a> : <span className="ml-2">-</span>}</div>
          <div><span className="text-gray-500">계약명:</span> <span className="ml-2">{order.contract?.name || "-"}</span></div>
          <div><span className="text-gray-500">고객:</span> <span className="ml-2">{order.contract?.customer || "-"}</span></div>
          <div><span className="text-gray-500">제조사:</span> <button onClick={async () => {
            try {
              const s = await supplierApi.findByName(order.manufacturer);
              if (s?.id) router.push(`/procurement/suppliers/${s.id}`);
            } catch { router.push(`/procurement/suppliers?search=${encodeURIComponent(order.manufacturer)}`); }
          }} className="ml-2 text-blue-600 hover:underline">{order.manufacturer}</button></div>
          <div><span className="text-gray-500">통화:</span> <span className="ml-2">{order.currency}</span></div>
          <div><span className="text-gray-500">Invoice No:</span> <span className="ml-2">{order.invoiceNo || "-"}</span></div>
          <div><span className="text-gray-500">OA번호:</span> <span className="ml-2">{order.oaNumber || "-"}</span></div>
          <div><span className="text-gray-500">결제기한:</span> <span className="ml-2">{fmtDate(order.dueDate)}</span></div>
          <div><span className="text-gray-500">입고장소:</span> <span className="ml-2">{order.arrivalLocation || "-"}</span></div>
          <div><span className="text-gray-500">통관담당:</span> <span className="ml-2">{order.customsHandler || "-"}</span></div>
          <div><span className="text-gray-500">예상생산완료:</span> <span className="ml-2">{fmtDate(order.estimatedProductionEnd)}</span></div>
          <div><span className="text-gray-500">실제출하일:</span> <span className="ml-2">{fmtDate(order.actualShipDate)}</span></div>
          <div><span className="text-gray-500">통관일:</span> <span className="ml-2">{fmtDate(order.customsDate)}</span></div>
          <div><span className="text-gray-500">생성일:</span> <span className="ml-2">{fmtDateTime(order.createdAt)}</span></div>
        </div>
        {order.notes && (
          <div className="mt-4 pt-4 border-t">
            <div className="text-gray-500 text-sm mb-1">비고</div>
            <div className="text-sm whitespace-pre-wrap">{order.notes}</div>
          </div>
        )}
      </div>

      {/* 품목 */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <div className="px-4 py-3 border-b bg-gray-50">
          <h3 className="font-medium">품목 ({order.items?.length || 0})</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600">품목명</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">사양</th>
              <th className="px-4 py-3 text-center font-medium text-gray-600">수량</th>
              <th className="px-4 py-3 text-center font-medium text-gray-600">입고</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">단가</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">금액</th>
              <th className="px-4 py-3 text-center font-medium text-gray-600">입고상태</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">재고번호</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {order.items?.map((item: any) => (
              <tr key={item.id}>
                <td className="px-4 py-3">
                  {item.name}
                  {item.productMaster && (
                    <span className="text-xs text-gray-400 ml-1">({item.productMaster.modelName})</span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-500">{item.spec || "-"}</td>
                <td className="px-4 py-3 text-center">{item.quantity}</td>
                <td className="px-4 py-3 text-center font-mono">
                  {item.receivedQuantity}/{item.quantity}
                </td>
                <td className="px-4 py-3 text-right font-mono">{fmtAmount(item.unitPrice, order.currency)}</td>
                <td className="px-4 py-3 text-right font-mono">{fmtAmount(item.amount, order.currency)}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${
                    item.receiptStatus === "FULLY_RECEIVED" ? "bg-green-100 text-green-700" :
                    item.receiptStatus === "PARTIALLY_RECEIVED" ? "bg-amber-100 text-amber-700" :
                    "bg-gray-100 text-gray-600"
                  }`}>
                    {RECEIPT_LABELS[item.receiptStatus] || item.receiptStatus}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-1">
                    {item.inventoryItems?.map((inv: any) => (
                      <span key={inv.id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">
                        <a href={`/inventory/${inv.id}`} className="hover:underline font-mono">{inv.inventoryNo}</a>
                        <button
                          onClick={() => handleUnlinkInventory(item.id, inv.id)}
                          className="text-blue-400 hover:text-red-500 ml-0.5"
                          title="연결 해제"
                        >&times;</button>
                      </span>
                    ))}
                    {linkItemId === item.id ? (
                      <span className="inline-flex items-center gap-1">
                        <input
                          type="text"
                          value={linkInvNo}
                          onChange={(e) => setLinkInvNo(e.target.value.toUpperCase())}
                          onKeyDown={(e) => e.key === "Enter" && handleLinkInventory()}
                          placeholder="E00001"
                          className="w-20 border rounded px-1.5 py-0.5 text-xs font-mono"
                          autoFocus
                        />
                        <button onClick={handleLinkInventory} className="text-green-600 hover:text-green-800 text-xs font-bold">&#10003;</button>
                        <button onClick={() => { setLinkItemId(null); setLinkInvNo(""); }} className="text-gray-400 hover:text-gray-600 text-xs">&times;</button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setLinkItemId(item.id)}
                        className="text-gray-400 hover:text-blue-600 text-xs"
                        title="재고번호 연결"
                      >+ 연결</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Receive Modal */}
      {showReceive && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setShowReceive(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">입고 처리</h2>
            <div className="space-y-3">
              {order.items?.filter((i: any) => i.receiptStatus !== "FULLY_RECEIVED").map((item: any) => (
                <div key={item.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                  <div className="flex-1">
                    <div className="font-medium text-sm">{item.name}</div>
                    <div className="text-xs text-gray-500">
                      잔여: {item.quantity - item.receivedQuantity}개 (총 {item.quantity}개 중 {item.receivedQuantity}개 입고)
                    </div>
                  </div>
                  <input
                    type="number"
                    min={0}
                    max={item.quantity - item.receivedQuantity}
                    value={receiveQtys[item.id] || ""}
                    onChange={(e) => setReceiveQtys({ ...receiveQtys, [item.id]: Number(e.target.value) })}
                    placeholder="수량"
                    className="w-20 border rounded px-2 py-1 text-sm text-center"
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowReceive(false)} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">취소</button>
              <button onClick={handleReceive} className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700">입고 확인</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
