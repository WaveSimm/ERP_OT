"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { expenseApi } from "@/lib/api";
import { fmtDate, fmtDateTime24 } from "@/lib/datetime";
import { SettlementStatusBadge } from "../../_components/settlement-status-badge";

export default function SettlementDetailPage() {
  const { id } = useParams<{ id: string }>();
  return <SettlementDetail id={id} />;
}

export function SettlementDetail({ id, onBack }: { id: string; onBack?: () => void }) {
  const router = useRouter();
  const [s, setS] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [titleSaving, setTitleSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setS(await expenseApi.getSettlement(id));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  const remove = async () => {
    if (!confirm("정산묶음을 삭제하시겠습니까?")) return;
    await expenseApi.deleteSettlement(id);
    if (onBack) onBack();
    else router.push("/expense/settlements");
  };

  if (loading || !s) {
    return <div className="max-w-4xl mx-auto px-6 py-12 text-center text-gray-400">불러오는 중...</div>;
  }

  const isDraft = s.status === "DRAFT";
  const isRejected = s.status === "REJECTED";

  return (
    <div className="max-w-4xl mx-auto px-6 py-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <button onClick={() => onBack ? onBack() : router.push("/expense/settlements")} className="text-xs text-gray-500 hover:underline mb-1">← 목록</button>
          {editingTitle ? (
            <div className="flex items-center gap-2">
              <input type="text" value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key === "Enter" && titleDraft.trim()) {
                    setTitleSaving(true);
                    try {
                      await expenseApi.updateSettlementTitle(id, titleDraft.trim());
                      setEditingTitle(false);
                      await load();
                    } catch (err: any) {
                      alert(err.message);
                    } finally { setTitleSaving(false); }
                  } else if (e.key === "Escape") {
                    setEditingTitle(false);
                  }
                }}
                autoFocus
                className="text-2xl font-bold text-gray-900 border-b-2 border-blue-500 outline-none flex-1 min-w-0 bg-transparent"
              />
              <button onClick={async () => {
                if (!titleDraft.trim()) return;
                setTitleSaving(true);
                try {
                  await expenseApi.updateSettlementTitle(id, titleDraft.trim());
                  setEditingTitle(false);
                  await load();
                } catch (err: any) { alert(err.message); }
                finally { setTitleSaving(false); }
              }} disabled={titleSaving || !titleDraft.trim()}
                className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
                {titleSaving ? "저장 중" : "저장"}
              </button>
              <button onClick={() => setEditingTitle(false)} className="px-2 py-1 text-xs border border-gray-300 rounded">취소</button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-gray-900">{s.title}</h1>
              {["DRAFT", "REJECTED", "SUBMITTED"].includes(s.status) && (
                <button onClick={() => { setTitleDraft(s.title); setEditingTitle(true); }}
                  className="text-xs text-gray-400 hover:text-blue-600" title="제목 편집">
                  ✏️
                </button>
              )}
            </div>
          )}
        </div>
        <SettlementStatusBadge status={s.status} />
      </div>

      {/* 요약 카드 */}
      {(() => {
        // v1.6.1 (2026-05-15): 개인/법인 분리 합계 (source.ownership 기반)
        let personalAmt = 0, corporateAmt = 0;
        let personalCnt = 0, corporateCnt = 0;
        (s.items || []).forEach((it: any) => {
          const own = it.transaction?.source?.ownership;
          const amt = Number(it.transaction?.amount || 0);
          if (own === "CORPORATE") { corporateAmt += amt; corporateCnt++; }
          else { personalAmt += amt; personalCnt++; }
        });
        return (
          <div className="bg-white border border-gray-200 rounded-lg p-4 grid grid-cols-2 md:grid-cols-5 gap-4">
            <Stat label="기간" value={`${fmtDate(s.periodStart)} ~ ${fmtDate(s.periodEnd)}`} />
            <Stat label="거래 건수" value={s.totalCount ?? 0} />
            <Stat label="총 금액" value={`${Number(s.totalAmount ?? 0).toLocaleString()}원`} />
            <div>
              <div className="text-xs text-gray-500 mb-0.5">개인 (환급 대상)</div>
              <div className="text-sm font-semibold text-blue-700">{personalAmt.toLocaleString()}원</div>
              <div className="text-[10px] text-gray-400">{personalCnt}건</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-0.5">법인 (회사처리)</div>
              <div className="text-sm font-semibold text-gray-600">{corporateAmt.toLocaleString()}원</div>
              <div className="text-[10px] text-gray-400">{corporateCnt}건</div>
            </div>
          </div>
        );
      })()}

      {/* 진행 추적 */}
      <ProgressTimeline s={s} />

      {/* 사업(계약)별 합계 — items에서 계약 snapshot으로 직접 집계 */}
      {(() => {
        const byContract = new Map<string, { name: string; count: number; amount: number }>();
        (s.items || []).forEach((it: any) => {
          const t = it.transaction;
          const key = t.contractNumber && t.contractName ? `${t.contractNumber} - ${t.contractName}` : (t.contractNumber || t.contractName || "없음");
          const bucket = byContract.get(key) ?? { name: key, count: 0, amount: 0 };
          bucket.count++;
          bucket.amount += Number(t.amount || 0);
          byContract.set(key, bucket);
        });
        if (byContract.size === 0) return null;
        return (
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h2 className="text-sm font-bold text-gray-700 mb-2">사업(계약)별 합계</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {Array.from(byContract.entries()).map(([key, stat]) => (
                <div key={key} className="border border-gray-100 rounded p-2 text-xs">
                  <div className="text-gray-500 truncate" title={stat.name}>{stat.name}</div>
                  <div className="tabular-nums font-medium">{stat.amount.toLocaleString()}원 <span className="text-gray-400">({stat.count}건)</span></div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* 거래 라인 */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <h2 className="text-sm font-bold text-gray-700 px-4 pt-3 pb-2">거래 목록 ({s.items?.length ?? 0})</h2>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="px-3 py-1.5 text-left">거래일시</th>
              <th className="px-3 py-1.5 text-left">가맹점</th>
              <th className="px-3 py-1.5 text-left">사업(계약)</th>
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
                  <td className="px-3 py-1.5 text-xs">
                    {t.contractNumber && t.contractName ? `${t.contractNumber} - ${t.contractName}` : (t.contractNumber || t.contractName || "없음")}
                  </td>
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

      {/* v1.6.4 (2026-05-16): 결재 분리 — 정산서 상세에서는 결재 작성 진입만 제공 */}
      {(isDraft || isRejected) && !s.approvalDocumentId && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-sm text-gray-600">
            이 정산묶음으로 결재를 작성하려면 아래 「결재 작성」 버튼을 누르세요.
            양식과 결재선·내용은 결재 페이지에서 자유롭게 선택할 수 있습니다.
          </p>
        </div>
      )}

      {/* 액션 */}
      <div className="flex flex-wrap gap-2">
        <a href={expenseApi.excelDownloadUrl(id)} target="_blank" rel="noopener"
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50">
          📥 Excel 다운로드
        </a>
        {(isDraft || isRejected) && !s.approvalDocumentId && (s.totalCount ?? 0) > 0 && (
          <a href={`/approval/new?settlementId=${id}`}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700">
            📤 결재 작성
          </a>
        )}
        {(isDraft || isRejected) && !s.approvalDocumentId && (
          <button onClick={remove}
            className="px-3 py-1.5 text-sm border border-red-300 text-red-600 rounded-md hover:bg-red-50">
            삭제
          </button>
        )}
        {s.approvalDocumentId && (
          <a href={`/approval/${s.approvalDocumentId}`}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50">
            📄 결재 문서 보기 →
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
