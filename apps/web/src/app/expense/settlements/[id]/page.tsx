"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { expenseApi } from "@/lib/api";
import { fmtDate, fmtDateTime24 } from "@/lib/datetime";
import { SettlementStatusBadge } from "../../page";

export default function SettlementDetailPage() {
  const { id } = useParams<{ id: string }>();
  return <SettlementDetail id={id} />;
}

export function SettlementDetail({ id, onBack }: { id: string; onBack?: () => void }) {
  const router = useRouter();
  const [s, setS] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [canceling, setCanceling] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setS(await expenseApi.getSettlement(id));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  const submit = async () => {
    if (!confirm("결재를 상신하시겠습니까?\n상신 후에는 정산 내용을 수정할 수 없습니다.")) return;
    setSubmitting(true);
    try {
      await expenseApi.submitSettlement(id);
      await load();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async () => {
    if (!confirm("정산결재를 삭제하시겠습니까?")) return;
    await expenseApi.deleteSettlement(id);
    if (onBack) onBack();
    else router.push("/expense/settlements");
  };

  const cancel = async () => {
    if (!confirm("결재 상신을 취소하시겠습니까?\n취소하면 정산이 DRAFT 상태로 되돌아가며,\n결재 문서도 함께 회수됩니다.")) return;
    setCanceling(true);
    try {
      await expenseApi.cancelSettlement(id);
      await load();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setCanceling(false);
    }
  };

  if (loading || !s) {
    return <div className="max-w-4xl mx-auto px-6 py-12 text-center text-gray-400">불러오는 중...</div>;
  }

  const isDraft = s.status === "DRAFT";
  const isRejected = s.status === "REJECTED";

  return (
    <div className="max-w-4xl mx-auto px-6 py-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <button onClick={() => onBack ? onBack() : router.push("/expense/settlements")} className="text-xs text-gray-500 hover:underline mb-1">← 목록</button>
          <h1 className="text-2xl font-bold text-gray-900">{s.title}</h1>
        </div>
        <SettlementStatusBadge status={s.status} />
      </div>

      {/* 요약 카드 */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 grid grid-cols-3 gap-4">
        <Stat label="기간" value={`${fmtDate(s.periodStart)} ~ ${fmtDate(s.periodEnd)}`} />
        <Stat label="거래 건수" value={s.totalCount ?? 0} />
        <Stat label="총 금액" value={`${Number(s.totalAmount ?? 0).toLocaleString()}원`} />
      </div>

      {/* 진행 추적 */}
      <ProgressTimeline s={s} />

      {/* 카테고리별 합계 */}
      {s.categoryStats && Object.keys(s.categoryStats).length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h2 className="text-sm font-bold text-gray-700 mb-2">카테고리별 합계</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {Object.entries(s.categoryStats).map(([code, stat]: [string, any]) => (
              <div key={code} className="border border-gray-100 rounded p-2 text-xs">
                <div className="text-gray-500">{stat.name}</div>
                <div className="tabular-nums font-medium">{stat.amount.toLocaleString()}원 <span className="text-gray-400">({stat.count}건)</span></div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 거래 라인 */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <h2 className="text-sm font-bold text-gray-700 px-4 pt-3 pb-2">거래 목록 ({s.items?.length ?? 0})</h2>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="px-3 py-1.5 text-left">거래일시</th>
              <th className="px-3 py-1.5 text-left">가맹점</th>
              <th className="px-3 py-1.5 text-left">카테고리</th>
              <th className="px-3 py-1.5 text-left">상세 내역</th>
              <th className="px-3 py-1.5 text-left">결제수단</th>
              <th className="px-3 py-1.5 text-right">금액</th>
              <th className="px-3 py-1.5 text-left">메모</th>
              <th className="px-3 py-1.5 text-center">영수증</th>
            </tr>
          </thead>
          <tbody>
            {(s.items ?? []).map((it: any) => {
              const t = it.transaction;
              const confirmedReceipt = t.matches?.find((m: any) => m.confirmedAt);
              return (
                <tr key={it.id} className="border-t border-gray-100">
                  <td className="px-3 py-1.5 text-xs text-gray-600 whitespace-nowrap">{fmtDateTime24(t.transactedAt, { short: true })}</td>
                  <td className="px-3 py-1.5">
                    <span className={t.isCanceled ? "line-through text-gray-400" : ""}>{t.merchantName}</span>
                    {t.isCanceled && (
                      <span className="ml-2 px-1.5 py-0.5 text-[10px] font-medium bg-red-100 text-red-700 rounded">취소</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-xs">{t.category?.name ?? "기타"}</td>
                  <td className="px-3 py-1.5 text-xs text-gray-700 max-w-[200px] truncate" title={t.detail ?? ""}>{t.detail ?? ""}</td>
                  <td className="px-3 py-1.5 text-xs text-gray-500">{t.source?.displayName ?? t.source?.name ?? "-"}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{Number(t.amount).toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-xs text-gray-600 max-w-[200px] truncate" title={t.memo ?? ""}>{it.memoOverride ?? t.memo ?? ""}</td>
                  <td className="px-3 py-1.5 text-center">
                    {confirmedReceipt ? (
                      <a href={expenseApi.receiptDownloadUrl(confirmedReceipt.receipt.id)} target="_blank" rel="noopener" className="text-blue-600 text-xs hover:underline">📎</a>
                    ) : <span className="text-xs text-gray-400">-</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 액션 */}
      <div className="flex flex-wrap gap-2">
        <a href={expenseApi.excelDownloadUrl(id)} target="_blank" rel="noopener"
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50">
          📥 Excel 다운로드
        </a>
        {isDraft && (
          <button onClick={submit} disabled={submitting || (s.totalCount ?? 0) === 0}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50">
            {submitting ? "상신 중..." : "📤 결재 상신"}
          </button>
        )}
        {(isDraft || isRejected) && (
          <button onClick={remove}
            className="px-3 py-1.5 text-sm border border-red-300 text-red-600 rounded-md hover:bg-red-50">
            삭제
          </button>
        )}
        {s.status === "SUBMITTED" && (
          <button onClick={cancel} disabled={canceling}
            className="px-3 py-1.5 text-sm border border-amber-300 text-amber-700 rounded-md hover:bg-amber-50 disabled:opacity-50">
            {canceling ? "취소 중..." : "↩ 결재 취소"}
          </button>
        )}
        {s.approvalDocumentId && (
          <a href={`/approval/${s.approvalDocumentId}`}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50">
            📄 결재 문서 보기
          </a>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-sm font-semibold text-gray-900 mt-0.5">{value}</div>
    </div>
  );
}

function ProgressTimeline({ s }: { s: any }) {
  const STEPS = [
    { key: "DRAFT", label: "작성", at: s.createdAt, done: true },
    { key: "SUBMITTED", label: "결재 상신", at: s.submittedAt, done: !!s.submittedAt },
    { key: "APPROVED", label: s.status === "REJECTED" ? "반려" : "결재 완료", at: s.approvedAt ?? s.rejectedAt, done: !!(s.approvedAt || s.rejectedAt) },
    { key: "RECEIVED", label: "재무팀 접수", at: s.receivedAt, done: !!s.receivedAt },
    { key: "PAID", label: "💰 입금 완료", at: s.paidAt, done: !!s.paidAt },
  ];
  const isRejected = s.status === "REJECTED";

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <h2 className="text-sm font-bold text-gray-700 mb-3">진행 추적</h2>
      <div className="space-y-2">
        {STEPS.map((step, idx) => {
          const isLast = idx === STEPS.length - 1;
          const failed = isRejected && step.key === "APPROVED";
          return (
            <div key={step.key} className="flex items-center gap-3">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
                failed ? "bg-red-100 text-red-700" :
                step.done ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-400"
              }`}>
                {failed ? "✕" : step.done ? "✓" : idx + 1}
              </div>
              <div className="flex-1">
                <div className={`text-sm ${failed ? "text-red-700" : step.done ? "text-gray-900 font-medium" : "text-gray-500"}`}>
                  {step.label}
                </div>
                {step.at && <div className="text-xs text-gray-500">{fmtDateTime24(step.at)}</div>}
              </div>
            </div>
          );
        })}
      </div>
      {s.rejectReason && (
        <div className="mt-3 p-2 bg-red-50 border border-red-200 text-sm text-red-700 rounded">
          반려 사유: {s.rejectReason}
        </div>
      )}
      {s.paidNote && (
        <div className="mt-3 p-2 bg-blue-50 border border-blue-200 text-xs text-blue-700 rounded">
          입금 메모: {s.paidNote}
        </div>
      )}
    </div>
  );
}
