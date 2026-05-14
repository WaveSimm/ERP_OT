"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { procurementApi, userManagementApi } from "@/lib/api";

const CURRENCY_SYMBOLS: Record<string, string> = { EUR: "€", GBP: "£", USD: "$", KRW: "₩" };
const fmtAmount = (v: any, c?: string) => {
  if (v == null) return "-";
  const n = Number(v);
  const sym = c ? (CURRENCY_SYMBOLS[c] || c) : "";
  return `${sym}${n.toLocaleString("ko-KR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
};
const fmtDate = (d: any) => d ? new Date(d).toLocaleDateString("ko-KR") : "-";

/**
 * 발주서 (Purchase Order) 인쇄용 페이지 — v1.6 (2026-05-14)
 *  - 새 탭으로 열고 브라우저 인쇄(Ctrl+P) → "PDF로 저장"
 *  - 사용자가 다운로드한 PDF를 이메일로 직접 발송
 */
export default function POPrintPage() {
  const params = useParams();
  const id = params.id as string;

  const [order, setOrder] = useState<any>(null);
  const [userMap, setUserMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [o, users] = await Promise.all([
          procurementApi.getOrder(id),
          userManagementApi.members(true).catch(() => [] as any[]),
        ]);
        setOrder(o);
        const m: Record<string, string> = {};
        (users as any[]).forEach((u: any) => { if (u.id && u.name) m[u.id] = u.name; });
        setUserMap(m);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) return <div className="p-8 text-gray-400">로딩 중...</div>;
  if (!order) return <div className="p-8 text-red-600">발주를 찾을 수 없습니다.</div>;

  const lookup = (uid?: string | null) => uid ? (userMap[uid] || uid) : "-";

  return (
    <div className="po-print">
      <style jsx global>{`
        @media print {
          @page { size: A4; margin: 14mm 12mm; }
          /* 발주서 본문만 인쇄, 레이아웃·헤더 등 그 외 모든 요소 숨김 */
          body * { visibility: hidden !important; }
          .po-print, .po-print * { visibility: visible !important; }
          .po-print { position: absolute !important; top: 0; left: 0; width: 100% !important; padding: 0 !important; }
          .no-print { display: none !important; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; background: white !important; }
        }
        .po-print { font-family: "Malgun Gothic", "맑은 고딕", sans-serif; color: #111; max-width: 210mm; margin: 0 auto; padding: 16px; background: white; }
        .po-print table { width: 100%; border-collapse: collapse; }
        .po-print th, .po-print td { border: 1px solid #444; padding: 6px 8px; font-size: 12px; }
        .po-print th { background: #f3f4f6; font-weight: 600; }
      `}</style>

      {/* 인쇄 버튼 (인쇄 시 자동 숨김) */}
      <div className="no-print mb-4 flex gap-2 justify-end">
        <button onClick={() => window.print()} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">인쇄 / PDF 저장</button>
        <button onClick={() => window.close()} className="px-4 py-2 border rounded-lg text-sm">닫기</button>
      </div>

      {/* 헤더 */}
      <div style={{ textAlign: "center", marginBottom: 16 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>발주서 / PURCHASE ORDER</h1>
        <div style={{ marginTop: 4, fontSize: 12, color: "#666" }}>OceanTech</div>
      </div>

      {/* 발주 기본 정보 */}
      <table style={{ marginBottom: 12 }}>
        <tbody>
          <tr>
            <th style={{ width: "20%" }}>발주번호 (PO No.)</th>
            <td style={{ width: "30%" }}>{order.orderNumber}</td>
            <th style={{ width: "20%" }}>발주일 (Date)</th>
            <td style={{ width: "30%" }}>{fmtDate(order.orderDate || order.createdAt)}</td>
          </tr>
          <tr>
            <th>제조사 (Supplier)</th>
            <td>{order.manufacturer}</td>
            <th>고객사 (Customer)</th>
            <td>{order.customer || order.contract?.client || "-"}</td>
          </tr>
          <tr>
            <th>계약 (Contract)</th>
            <td colSpan={3}>{order.contract?.contractNumber} {order.contract?.name && `· ${order.contract.name}`}</td>
          </tr>
          <tr>
            <th>통화 (Currency)</th>
            <td>{order.currency}</td>
            <th>Quote No</th>
            <td>{order.invoiceNo || "-"}</td>
          </tr>
          <tr>
            <th>결제기한 (Due)</th>
            <td>{fmtDate(order.dueDate)}</td>
            <th>결제방식 (Terms)</th>
            <td>{order.paymentTerms || "-"}</td>
          </tr>
          <tr>
            <th>OA번호 (Order Ack.)</th>
            <td colSpan={3}>{order.oaNumber || "-"}</td>
          </tr>
        </tbody>
      </table>

      {/* 일정/물류 */}
      <table style={{ marginBottom: 12 }}>
        <thead><tr><th colSpan={4} style={{ textAlign: "left" }}>일정 / 물류 (Schedule &amp; Logistics)</th></tr></thead>
        <tbody>
          <tr>
            <th style={{ width: "20%" }}>예상 생산완료</th>
            <td style={{ width: "30%" }}>{fmtDate(order.estimatedProductionEnd)}</td>
            <th style={{ width: "20%" }}>예상 선적일</th>
            <td style={{ width: "30%" }}>{fmtDate(order.estimatedShipDate)}</td>
          </tr>
          <tr>
            <th>입고장소 (Delivery)</th>
            <td>{order.arrivalLocation || "-"}</td>
            <th>통관담당</th>
            <td>{order.customsHandler || "-"}</td>
          </tr>
        </tbody>
      </table>

      {/* 결재라인 */}
      <table style={{ marginBottom: 12 }}>
        <thead>
          <tr>
            <th colSpan={3} style={{ textAlign: "left" }}>결재 (Approval)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th style={{ width: "33%", height: 40 }}>1차</th>
            <th style={{ width: "33%" }}>2차</th>
            <th style={{ width: "34%" }}>3차</th>
          </tr>
          <tr style={{ height: 60 }}>
            <td style={{ textAlign: "center", verticalAlign: "bottom" }}>{lookup(order.approverId)}</td>
            <td style={{ textAlign: "center", verticalAlign: "bottom" }}>{order.secondApproverId ? lookup(order.secondApproverId) : "-"}</td>
            <td style={{ textAlign: "center", verticalAlign: "bottom" }}>{order.thirdApproverId ? lookup(order.thirdApproverId) : "-"}</td>
          </tr>
        </tbody>
      </table>

      {/* 품목 */}
      <table style={{ marginBottom: 12 }}>
        <thead>
          <tr>
            <th style={{ width: "5%" }}>No</th>
            <th style={{ width: "28%" }}>품명 (Item)</th>
            <th style={{ width: "20%" }}>SKU 코드</th>
            <th style={{ width: "8%" }}>수량 (Qty)</th>
            <th style={{ width: "13%" }}>단가 (Unit)</th>
            <th style={{ width: "13%" }}>금액 (Amount)</th>
            <th style={{ width: "13%" }}>비고</th>
          </tr>
        </thead>
        <tbody>
          {(order.items || []).map((it: any, idx: number) => (
            <tr key={it.id}>
              <td style={{ textAlign: "center" }}>{idx + 1}</td>
              <td>{it.name}</td>
              <td style={{ fontFamily: "monospace" }}>{it.spec || "-"}</td>
              <td style={{ textAlign: "right" }}>{it.quantity}</td>
              <td style={{ textAlign: "right", fontFamily: "monospace" }}>{fmtAmount(it.unitPrice, order.currency)}</td>
              <td style={{ textAlign: "right", fontFamily: "monospace" }}>{fmtAmount(it.amount, order.currency)}</td>
              <td style={{ fontSize: 11 }}>{it.notes || ""}</td>
            </tr>
          ))}
          <tr>
            <th colSpan={5} style={{ textAlign: "right" }}>합계 (Total)</th>
            <th style={{ textAlign: "right", fontFamily: "monospace" }}>{fmtAmount(order.totalAmount, order.currency)}</th>
            <th></th>
          </tr>
          {order.totalAmountKRW && (
            <tr>
              <th colSpan={5} style={{ textAlign: "right" }}>원화 환산</th>
              <th style={{ textAlign: "right", fontFamily: "monospace" }}>{fmtAmount(order.totalAmountKRW, "KRW")}</th>
              <th></th>
            </tr>
          )}
        </tbody>
      </table>

      {/* 비고 */}
      {order.notes && (
        <table style={{ marginBottom: 12 }}>
          <thead><tr><th style={{ textAlign: "left" }}>비고 (Remarks)</th></tr></thead>
          <tbody>
            <tr><td style={{ whiteSpace: "pre-wrap" }}>{order.notes}</td></tr>
          </tbody>
        </table>
      )}

      {/* 푸터 */}
      <div style={{ marginTop: 24, fontSize: 11, color: "#666", textAlign: "center", borderTop: "1px solid #ddd", paddingTop: 8 }}>
        OceanTech · Generated by ERP-OT · {new Date().toLocaleString("ko-KR")}
      </div>
    </div>
  );
}
