"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { procurementApi, approvalApi, approvalLineApi, supplierApi, userManagementApi, inboundRequestApi } from "@/lib/api";
import SettlementSection, { PaymentRequestModal } from "@/components/procurement/SettlementSection";
import { DateInput } from "@/components/ui/DateInput";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "초안", PENDING_APPROVAL: "승인대기", APPROVED: "승인",
  REJECTED: "반려", ORDERED: "승인완료", PURCHASING: "발주완료",
  SHIPPED: "선적 완료", CUSTOMS: "통관중", PARTIALLY_RECEIVED: "부분입고",
  ARRIVED: "입고완료", SETTLEMENT: "송금상태", CLOSED: "마감",
};

// v1.6.1 (2026-05-15): 전이 버튼 라벨 — 상태 라벨과 다른 케이스
//   - CUSTOMS 전이 = "통관 시작" (관부가세 처리 대기)
//   - ARRIVED 전이 = "통관 완료" (관부가세 PAID 후 입고완료)
const TRANSITION_LABELS: Record<string, string> = {
  ...STATUS_LABELS,
  CUSTOMS: "통관 시작",
  ARRIVED: "통관 완료",
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  PENDING_APPROVAL: "bg-yellow-100 text-yellow-700",
  APPROVED: "bg-green-100 text-green-700",
  REJECTED: "bg-red-100 text-red-700",
  ORDERED: "bg-blue-100 text-blue-700",
  PURCHASING: "bg-sky-100 text-sky-700",
  SHIPPED: "bg-purple-100 text-purple-700",
  CUSTOMS: "bg-orange-100 text-orange-700",
  PARTIALLY_RECEIVED: "bg-amber-100 text-amber-700",
  ARRIVED: "bg-emerald-100 text-emerald-700",
  SETTLEMENT: "bg-cyan-100 text-cyan-700",
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
  // v1.6.1 (2026-05-15): 상태 전이 날짜 모달 (PURCHASING/SHIPPED/CUSTOMS)
  const [pendingTransition, setPendingTransition] = useState<string | null>(null);

  // Approval
  const [approvalDoc, setApprovalDoc] = useState<any>(null);
  const [rejectComment, setRejectComment] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);
  // v1.6 (2026-05-14): 결재자 이름 lookup + 본인 기본 결재선
  const [userMap, setUserMap] = useState<Record<string, string>>({});
  const [myApprovalLine, setMyApprovalLine] = useState<any>(null);

  // v1.6 (2026-05-14): 일정/물류 인라인 편집 (모든 상태에서 가능)
  const [showLogisticsEdit, setShowLogisticsEdit] = useState(false);
  // v1.6 (2026-05-14): 헤더의 [송금 요청] 버튼 — 회계정산 섹션과 데이터 공유
  const [showHeaderRequestModal, setShowHeaderRequestModal] = useState(false);
  const [settlementRefreshSignal, setSettlementRefreshSignal] = useState(0);
  const [headerOutstanding, setHeaderOutstanding] = useState(0);

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
  // v1.6 (2026-05-14): 사용자 이름 lookup용 맵 + 본인 결재선 (마운트 시 1회)
  useEffect(() => {
    userManagementApi.members(true).then((list: any) => {
      const m: Record<string, string> = {};
      (list as any[]).forEach((u: any) => { if (u.id && u.name) m[u.id] = u.name; });
      setUserMap(m);
    }).catch(() => {});
    approvalLineApi.getMe().then(setMyApprovalLine).catch(() => setMyApprovalLine(null));
  }, []);

  const handTransitionLabel = (status: string) => TRANSITION_LABELS[status] || status;
  const handleTransition = async (status: string) => {
    // v1.6.1 (2026-05-15): 날짜 기록 필요한 전이 — 모달 표시
    if (["PURCHASING", "SHIPPED", "CUSTOMS"].includes(status)) {
      setPendingTransition(status);
      return;
    }
    if (!confirm(`상태를 "${handTransitionLabel(status)}"(으)로 변경하시겠습니까?`)) return;
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

  // v1.6.1 (2026-05-15): 날짜 모달에서 확인
  const handleTransitionWithDate = async (status: string, transitionDate: string) => {
    setTransitioning(true);
    try {
      await procurementApi.transitionOrder(id, status, transitionDate);
      setPendingTransition(null);
      await load();
    } catch (e: any) {
      alert(e.message || "상태 전환 실패");
    } finally {
      setTransitioning(false);
    }
  };

  // v1.6 (2026-05-14): 결재 상신 취소
  const handleCancelSubmission = async () => {
    if (!confirm("결재 상신을 취소하시겠습니까?\n발주가 초안(DRAFT) 상태로 복귀됩니다.")) return;
    setTransitioning(true);
    try {
      await procurementApi.cancelOrderSubmission(id);
      await load();
    } catch (e: any) {
      alert(e.message || "상신 취소 실패");
    } finally {
      setTransitioning(false);
    }
  };

  // v1.6 (2026-05-14): DRAFT 상태에서만 삭제 가능
  const handleDelete = async () => {
    if (!confirm("이 발주를 삭제하시겠습니까?\n품목과 진행 이력이 모두 함께 삭제됩니다.")) return;
    setTransitioning(true);
    try {
      await procurementApi.deleteOrder(id);
      router.push("/procurement");
    } catch (e: any) {
      alert(e.message || "삭제 실패");
      setTransitioning(false);
    }
  };

  const handleSubmitApproval = async () => {
    setTransitioning(true);
    try {
      const templates = await approvalApi.getTemplates();
      const poTemplate = templates.find((t: any) => t.code === "PO");
      if (!poTemplate) throw new Error("구매 발주서 결재 템플릿을 찾을 수 없습니다.");

      // v1.6 (2026-05-14): 발주별 결재선 우선, 없으면 본인 기본 결재선으로 fallback
      //   - 상신 직전 최신 order 재조회 (state stale 방지)
      const latestOrder = await procurementApi.getOrder(id);
      let approverId: string | null | undefined = latestOrder.approverId;
      let secondApproverId: string | null | undefined = latestOrder.secondApproverId;
      let thirdApproverId: string | null | undefined = latestOrder.thirdApproverId;
      let approverName = "";
      let secondApproverName = "";
      let thirdApproverName = "";

      if (!approverId) {
        // fallback: 본인 기본 결재선
        const line = await approvalLineApi.getMe();
        if (!line || !line.approverId) {
          throw new Error("결재라인이 설정되지 않았습니다.\n발주 편집에서 결재라인을 지정하거나, [결재선 설정] 페이지에서 기본 결재선을 등록하십시오.");
        }
        approverId = line.approverId;
        secondApproverId = line.secondApproverId;
        thirdApproverId = line.thirdApproverId;
        approverName = line.approverName || "";
        secondApproverName = line.secondApproverName || "";
        thirdApproverName = line.thirdApproverName || "";
      }

      const lookup = (uid: string | null | undefined) => uid ? (userMap[uid] || uid) : "";
      // userMap 우선 (이름 검색이 더 신뢰성 있음)
      if (!approverName) approverName = userMap[approverId!] || "";
      if (secondApproverId && !secondApproverName) secondApproverName = userMap[secondApproverId] || "";
      if (thirdApproverId && !thirdApproverName) thirdApproverName = userMap[thirdApproverId] || "";

      const lines = [
        `1차: ${lookup(approverId)}`,
        secondApproverId ? `2차: ${lookup(secondApproverId)}` : null,
        thirdApproverId ? `3차: ${lookup(thirdApproverId)}` : null,
      ].filter(Boolean);
      if (!confirm(`아래 결재라인으로 상신하시겠습니까?\n\n${lines.join("\n")}`)) {
        setTransitioning(false);
        return;
      }

      // v1.6 (2026-05-14): approvalLine 형식으로 전송 — 백엔드는 body.approvalLine을 읽음
      //   (body.steps가 아니라 body.approvalLine. 잘못 보내면 백엔드가 fallback해서 본인 기본 결재선을 자동 로드)
      //   동일 인물이 여러 단계에 지정되어도 그대로 송신 (사용자 명시 의도 존중)
      const approvalLine: any[] = [
        { stepOrder: 1, role: "APPROVER", userId: approverId, userName: approverName },
      ];
      if (secondApproverId) {
        approvalLine.push({ stepOrder: 2, role: "APPROVER", userId: secondApproverId, userName: secondApproverName });
      }
      if (thirdApproverId) {
        approvalLine.push({ stepOrder: 3, role: "APPROVER", userId: thirdApproverId, userName: thirdApproverName });
      }

      const itemsData = order.items?.map((i: any) => ({
        name: i.name, spec: i.spec || "", quantity: i.quantity,
        unitPrice: Number(i.unitPrice), amount: Number(i.amount),
      }));

      const doc = await approvalApi.createDocument({
        templateId: poTemplate.id,
        title: `구매발주서 - ${order.orderNumber} (${order.manufacturer})`,
        department: "영업팀",
        approvalStepCount: approvalLine.length,
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
        approvalLine,
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

  // v1.6 (2026-05-14): 결재라인 카드 — DRAFT면 상단, 그 외엔 상세 정보 아래에서 렌더
  const approvalLineCard = (() => {
    const orderHasLine = !!order.approverId;
    const source = orderHasLine
      ? { approverId: order.approverId, secondApproverId: order.secondApproverId, thirdApproverId: order.thirdApproverId }
      : (myApprovalLine && myApprovalLine.approverId ? myApprovalLine : null);
    return (
      <div className="bg-white rounded-lg border p-6 mb-4">
        <h3 className="font-medium mb-3">
          결재라인
          <span className={`ml-2 px-2 py-0.5 text-[10px] rounded ${
            orderHasLine ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"
          }`}>
            {orderHasLine ? "발주별 지정" : "본인 기본 결재선 (fallback)"}
          </span>
        </h3>
        {source ? (
          <div className="flex items-center flex-wrap gap-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 text-[10px] rounded bg-blue-100 text-blue-700">1차</span>
              <span className="font-medium">{userMap[source.approverId] || source.approverId}</span>
            </div>
            {source.secondApproverId && (
              <>
                <span className="text-gray-300">→</span>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 text-[10px] rounded bg-indigo-100 text-indigo-700">2차</span>
                  <span className="font-medium">{userMap[source.secondApproverId] || source.secondApproverId}</span>
                </div>
              </>
            )}
            {source.thirdApproverId && (
              <>
                <span className="text-gray-300">→</span>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 text-[10px] rounded bg-purple-100 text-purple-700">3차</span>
                  <span className="font-medium">{userMap[source.thirdApproverId] || source.thirdApproverId}</span>
                </div>
              </>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-400">
            결재라인이 지정되지 않았습니다.
            {order.status === "DRAFT" ? " 편집에서 결재라인을 지정하거나, " : " "}
            <a href="/approval-lines" className="text-blue-600 hover:underline">결재선 설정</a>에서 기본 결재선을 등록하십시오.
          </p>
        )}
      </div>
    );
  })();

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
          {/* v1.6 (2026-05-14): PO PDF — APPROVED 이상에서 노출 */}
          {!["DRAFT", "PENDING_APPROVAL", "REJECTED"].includes(order.status) && (
            <button
              onClick={() => window.open(`/procurement/orders/${id}/po-print`, "_blank")}
              className="px-3 py-1.5 text-sm border border-blue-300 text-blue-600 rounded-lg hover:bg-blue-50"
              title="발주서 PDF (새 탭에서 인쇄 → PDF 저장 → 이메일로 발송)"
            >
              📄 발주서 PDF
            </button>
          )}
          {/* v1.6 (2026-05-14): 송금 요청 — APPROVED 이상에서 노출 (회계정산 노출 조건과 동일) */}
          {!["DRAFT", "PENDING_APPROVAL", "REJECTED"].includes(order.status) && (
            <button
              onClick={async () => {
                // 최신 잔여 조회 후 모달 오픈
                try {
                  const settlement = await procurementApi.getSettlement(id);
                  const outstanding = Number(settlement?.summary?.outstanding ?? 0);
                  setHeaderOutstanding(outstanding > 0 ? outstanding : 0);
                } catch { setHeaderOutstanding(0); }
                setShowHeaderRequestModal(true);
              }}
              className="px-3 py-1.5 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700"
              title="재무 접수 > 발주송금 탭에서 처리됩니다"
            >
              💸 송금 요청
            </button>
          )}
          {order.status === "DRAFT" && (
            <>
              {/* v1.6 (2026-05-14): DRAFT 상태에서 편집 가능 */}
              <button
                onClick={() => router.push(`/procurement/orders/${id}/edit`)}
                disabled={transitioning}
                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                편집
              </button>
              <button
                onClick={handleSubmitApproval}
                disabled={transitioning}
                className="px-3 py-1.5 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50"
              >
                결재 상신
              </button>
              {/* v1.6 (2026-05-14): DRAFT 상태에서만 삭제 가능 */}
              <button
                onClick={handleDelete}
                disabled={transitioning}
                className="px-3 py-1.5 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50"
              >
                삭제
              </button>
            </>
          )}
          {/* v1.6 (2026-05-14): 결재 상신 취소 — PENDING_APPROVAL 상태에서만 */}
          {order.status === "PENDING_APPROVAL" && (
            <button
              onClick={handleCancelSubmission}
              disabled={transitioning}
              className="px-3 py-1.5 text-sm text-amber-700 border border-amber-200 rounded-lg hover:bg-amber-50 disabled:opacity-50"
            >
              상신 취소
            </button>
          )}
          {/* v1.6 (2026-05-14): PARTIALLY_RECEIVED는 [입고 처리] 모달로만, SETTLEMENT는 송금 요청으로만 진입 */}
          {/* v1.6.1 (2026-05-15): CUSTOMS 상태에서 ARRIVED 전이("통관 완료") 노출 — 관부가세 PAID 시에만 활성 */}
          {order.status !== "DRAFT" && order.allowedTransitions?.filter((t: string) => !["PENDING_APPROVAL", "APPROVED", "REJECTED", "DRAFT", "PARTIALLY_RECEIVED", "SETTLEMENT"].includes(t)).map((t: string) => {
            const isArrived = t === "ARRIVED";
            const customsPaid = order.customsTax?.status === "PAID";
            const disabledByCustomsTax = isArrived && order.status === "CUSTOMS" && !customsPaid;
            return (
              <button
                key={t}
                onClick={() => handleTransition(t)}
                disabled={transitioning || disabledByCustomsTax}
                title={disabledByCustomsTax ? "관부가세 납부가 완료되어야 통관 완료할 수 있습니다." : ""}
                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {TRANSITION_LABELS[t]}
              </button>
            );
          })}
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

      {/* v1.6 (2026-05-14): DRAFT 상태에선 결재라인을 헤더 직후 상단에 표시 */}
      {order.status === "DRAFT" && approvalLineCard}

      {/* 결재 현황 — 상신 이후에만 표시. RETURNED(철회됨)는 숨김 */}
      {approvalDoc && approvalDoc.status !== "RETURNED" && (
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
          <span className="text-gray-400 text-xs">견적금액</span>
          <div className="font-bold font-mono">{fmtAmount(order.totalAmount, order.currency)}
            {order.totalAmountKRW && <span className="text-xs text-gray-400 font-normal ml-1">({fmtAmount(order.totalAmountKRW, "KRW")})</span>}
          </div>
        </div>
        <div className="h-6 w-px bg-gray-200" />
        <div><span className="text-gray-400 text-xs">승인일</span><div>{fmtDate(order.approvedAt)}</div></div>
        <div className="h-6 w-px bg-gray-200" />
        <div><span className="text-gray-400 text-xs">발주일</span><div>{fmtDate(order.orderDate)}</div></div>
        <div className="h-6 w-px bg-gray-200" />
        <div><span className="text-gray-400 text-xs">예상 선적일</span><div>{fmtDate(order.estimatedShipDate)}</div></div>
        <div className="h-6 w-px bg-gray-200" />
        <div><span className="text-gray-400 text-xs">실제 선적일</span><div>{fmtDate(order.actualShipDate)}</div></div>
        <div className="h-6 w-px bg-gray-200" />
        <div><span className="text-gray-400 text-xs">통관일</span><div>{fmtDate(order.customsDate)}</div></div>
        <div className="h-6 w-px bg-gray-200" />
        <div><span className="text-gray-400 text-xs">입고일</span><div>{fmtDate(order.arrivalDate)}</div></div>
      </div>

      {/* 상세 정보 */}
      <div className="bg-white rounded-lg border p-6 mb-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium">상세 정보</h3>
          {/* v1.6 (2026-05-14): 일정·입고장소·통관담당은 전 상태에서 수정 가능 */}
          <button
            onClick={() => setShowLogisticsEdit(true)}
            className="text-xs text-blue-600 hover:underline"
          >
            일정 편집 ✏
          </button>
        </div>
        <div className="grid grid-cols-3 gap-x-12 gap-y-4 text-sm">
          {/* 1줄: 계약번호 / 계약명 / 고객사 */}
          <div><span className="text-gray-500">계약번호:</span> {order.contract ? <a href={`/procurement/contracts/${order.contract.id}`} className="ml-2 text-blue-600 hover:underline">{order.contract.contractNumber}</a> : <span className="ml-2">-</span>}</div>
          <div><span className="text-gray-500">계약명:</span> <span className="ml-2">{order.contract?.name || "-"}</span></div>
          <div><span className="text-gray-500">고객사:</span> <span className="ml-2">{order.customer || order.contract?.client || order.contract?.customer || "-"}</span></div>

          {/* 2줄: 제조사 / 통화 / 금액 */}
          <div><span className="text-gray-500">제조사:</span> <button onClick={async () => {
            try {
              const s = await supplierApi.findByName(order.manufacturer);
              if (s?.id) router.push(`/procurement/suppliers/${s.id}`);
            } catch { router.push(`/procurement/suppliers?search=${encodeURIComponent(order.manufacturer)}`); }
          }} className="ml-2 text-blue-600 hover:underline">{order.manufacturer}</button></div>
          <div><span className="text-gray-500">통화:</span> <span className="ml-2">{order.currency}</span></div>
          <div><span className="text-gray-500">견적금액:</span> <span className="ml-2 font-mono">{fmtAmount(order.totalAmount, order.currency)}</span></div>

          {/* 3줄: Quote No / 결제수단 / 통관담당 */}
          <div><span className="text-gray-500">Quote No:</span> <span className="ml-2">{order.invoiceNo || "-"}</span></div>
          <div><span className="text-gray-500">결제수단:</span> <span className="ml-2">{order.paymentTerms || "-"}</span></div>
          <div><span className="text-gray-500">통관담당:</span> <span className="ml-2">{order.customsHandler || "-"}</span></div>

          {/* 4줄: 예상 선적일 / 실제 선적일 / 통관일 */}
          <div><span className="text-gray-500">예상 선적일:</span> <span className="ml-2">{fmtDate(order.estimatedShipDate)}</span></div>
          <div><span className="text-gray-500">실제 선적일:</span> <span className="ml-2">{fmtDate(order.actualShipDate)}</span></div>
          <div><span className="text-gray-500">통관일:</span> <span className="ml-2">{fmtDate(order.customsDate)}</span></div>

          {/* 5줄: 승인일 / 발주일 */}
          <div><span className="text-gray-500">승인일:</span> <span className="ml-2">{fmtDate(order.approvedAt)}</span></div>
          <div><span className="text-gray-500">발주일:</span> <span className="ml-2">{fmtDate(order.orderDate)}</span></div>
        </div>
        {order.notes && (
          <div className="mt-4 pt-4 border-t">
            <div className="text-gray-500 text-sm mb-1">비고</div>
            <div className="text-sm whitespace-pre-wrap">{order.notes}</div>
          </div>
        )}
      </div>

      {/* v1.6 (2026-05-14): DRAFT가 아닐 땐 결재라인 카드를 표시하지 않음 — 결재 현황 카드와 중복 */}

      {/* v1.6 회계정산 (2026-05-14) — 결재 승인 이후 언제든 입력 가능 */}
      {!["DRAFT", "PENDING_APPROVAL", "REJECTED"].includes(order.status) && (
        <SettlementSection
          orderId={id}
          orderCurrency={order.currency}
          orderStatus={order.status}
          refreshSignal={settlementRefreshSignal}
        />
      )}

      {/* v1.6.1 (2026-05-15) 관부가세 카드 — CUSTOMS 진입 이후 표시 */}
      {order.customsTax && (
        <div className="bg-white rounded-lg border p-6 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium">관부가세</h3>
            <span className={`text-xs px-2 py-0.5 rounded-full ${
              order.customsTax.status === "PAID" ? "bg-green-100 text-green-700" :
              order.customsTax.status === "REJECTED" ? "bg-red-100 text-red-700" :
              "bg-amber-100 text-amber-700"
            }`}>
              {order.customsTax.status === "PAID" ? "납부 완료" : order.customsTax.status === "REJECTED" ? "반려" : "재무팀 처리 대기"}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-3 text-sm">
            <div>
              <div className="text-gray-500 text-xs">관세</div>
              <div className="font-mono">{order.customsTax.customsDuty != null ? `₩${Number(order.customsTax.customsDuty).toLocaleString()}` : "-"}</div>
            </div>
            <div>
              <div className="text-gray-500 text-xs">부가세</div>
              <div className="font-mono">{order.customsTax.vat != null ? `₩${Number(order.customsTax.vat).toLocaleString()}` : "-"}</div>
            </div>
            <div>
              <div className="text-gray-500 text-xs">합계</div>
              <div className="font-mono font-medium">{order.customsTax.totalAmount != null ? `₩${Number(order.customsTax.totalAmount).toLocaleString()}` : "-"}</div>
            </div>
            <div>
              <div className="text-gray-500 text-xs">납부일</div>
              <div>{order.customsTax.paidAt ? fmtDate(order.customsTax.paidAt) : "-"}</div>
            </div>
            {order.customsTax.rejectReason && (
              <div className="col-span-4 text-xs text-red-600">반려 사유: {order.customsTax.rejectReason}</div>
            )}
            {order.customsTax.notes && (
              <div className="col-span-4 text-xs text-gray-600">메모: {order.customsTax.notes}</div>
            )}
          </div>
        </div>
      )}

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

      {/* v1.6.1 (2026-05-15): 상태 전이 날짜 모달 (PURCHASING/SHIPPED/CUSTOMS) */}
      {pendingTransition && (
        <TransitionDateModal
          status={pendingTransition}
          statusLabel={TRANSITION_LABELS[pendingTransition]}
          onClose={() => setPendingTransition(null)}
          onConfirm={(date) => handleTransitionWithDate(pendingTransition, date)}
        />
      )}

      {/* v1.6 (2026-05-14): 헤더의 [송금 요청] 모달 — 회계정산 섹션과 동일한 컴포넌트 재사용 */}
      {showHeaderRequestModal && (
        <PaymentRequestModal
          orderId={id}
          orderCurrency={order.currency}
          defaultAmount={headerOutstanding}
          onClose={() => setShowHeaderRequestModal(false)}
          onSaved={() => {
            setShowHeaderRequestModal(false);
            setSettlementRefreshSignal((s) => s + 1);
          }}
        />
      )}

      {/* v1.6 (2026-05-14): 일정·물류 편집 모달 — 전 상태에서 가능 */}
      {showLogisticsEdit && (
        <LogisticsEditModal
          order={order}
          onClose={() => setShowLogisticsEdit(false)}
          onSaved={async () => { setShowLogisticsEdit(false); await load(); }}
        />
      )}

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

// ─── 일정·물류 편집 모달 (v1.6, 2026-05-14) ───────────────────────────
//   전 상태에서 예상 선적일/입고장소/통관담당 수정 가능
function LogisticsEditModal({
  order,
  onClose,
  onSaved,
}: {
  order: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    estimatedShipDate: order.estimatedShipDate ? order.estimatedShipDate.slice(0, 10) : "",
    arrivalLocation: order.arrivalLocation || "",
    customsHandler: order.customsHandler || "",
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: any = {
        estimatedShipDate: form.estimatedShipDate || null,
        arrivalLocation: form.arrivalLocation || null,
        customsHandler: form.customsHandler || null,
      };
      await procurementApi.updateOrder(order.id, payload);
      onSaved();
    } catch (e: any) {
      alert(e.message || "수정 실패");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold mb-4">일정 / 물류 편집</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">예상 선적일</label>
            <DateInput
              value={form.estimatedShipDate}
              onChange={(e: any) => setForm({ ...form, estimatedShipDate: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">입고장소</label>
            <input
              type="text"
              value={form.arrivalLocation}
              onChange={(e) => setForm({ ...form, arrivalLocation: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">통관담당</label>
            <input
              type="text"
              value={form.customsHandler}
              onChange={(e) => setForm({ ...form, customsHandler: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">취소</button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

// v1.6.1 (2026-05-15) — 상태 전이 시 날짜 입력 모달
// PURCHASING(발주완료)/SHIPPED(선적완료)/CUSTOMS(통관) 전이에 사용
function TransitionDateModal({
  status,
  statusLabel,
  onClose,
  onConfirm,
}: {
  status: string;
  statusLabel: string;
  onClose: () => void;
  onConfirm: (date: string) => void | Promise<void>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [saving, setSaving] = useState(false);

  const fieldLabel =
    status === "PURCHASING" ? "발주일" :
    status === "SHIPPED"    ? "선적일" :
    status === "CUSTOMS"    ? "통관 시작일" : "날짜";

  const handleSubmit = async () => {
    if (!date) { alert(`${fieldLabel}을(를) 입력해주세요.`); return; }
    setSaving(true);
    try { await onConfirm(date); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold mb-1">"{statusLabel}" 으로 변경</h3>
        <p className="text-xs text-gray-500 mb-4">{fieldLabel}을(를) 확인하거나 변경해주세요.</p>
        <div className="mb-6">
          <label className="block text-sm text-gray-600 mb-1">{fieldLabel} *</label>
          <DateInput
            value={date}
            onChange={(e: any) => setDate(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={saving}
            className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-50">취소</button>
          <button onClick={handleSubmit} disabled={saving || !date}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {saving ? "처리 중..." : "확인"}
          </button>
        </div>
      </div>
    </div>
  );
}
