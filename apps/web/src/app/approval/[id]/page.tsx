"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { approvalApi, expenseApi, getUser } from "@/lib/api";
import { fmtDateTime24 } from "@/lib/datetime";

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  SUBMITTED: "bg-blue-100 text-blue-700",
  AGREEMENT_PENDING: "bg-purple-100 text-purple-700",
  STEP_1_PENDING: "bg-yellow-100 text-yellow-700",
  STEP_2_PENDING: "bg-yellow-100 text-yellow-700",
  STEP_3_PENDING: "bg-yellow-100 text-yellow-700",
  APPROVED: "bg-green-100 text-green-700",
  REJECTED: "bg-red-100 text-red-700",
  RETURNED: "bg-orange-100 text-orange-700",
  CANCELLED: "bg-gray-200 text-gray-500",
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "임시저장",
  SUBMITTED: "상신",
  AGREEMENT_PENDING: "합의대기",
  STEP_1_PENDING: "1차 결재중",
  STEP_2_PENDING: "2차 결재중",
  STEP_3_PENDING: "3차 결재중",
  APPROVED: "승인완료",
  REJECTED: "반려",
  RETURNED: "반환",
  CANCELLED: "취소",
};

const STEP_STATUS_COLORS: Record<string, string> = {
  PENDING: "border-gray-300 bg-white",
  APPROVED: "border-green-500 bg-green-50",
  REJECTED: "border-red-500 bg-red-50",
  AGREED: "border-blue-500 bg-blue-50",
  DISAGREED: "border-orange-500 bg-orange-50 dark:bg-orange-950",
  SKIPPED: "border-gray-200 bg-gray-50",
};

const STEP_LABELS: Record<string, string> = {
  PENDING: "대기",
  APPROVED: "승인",
  REJECTED: "반려",
  AGREED: "합의",
  DISAGREED: "반대",
  SKIPPED: "건너뜀",
};

export default function ApprovalDetailPage() {
  const params = useParams();
  const router = useRouter();
  const docId = params.id as string;
  const currentUser = getUser();

  const [doc, setDoc] = useState<any>(null);
  const [files, setFiles] = useState<any[]>([]);
  const [settlement, setSettlement] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState("");
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [d, f] = await Promise.all([
        approvalApi.getDocument(docId),
        approvalApi.getDocumentFiles(docId).catch(() => []),
      ]);
      setDoc(d);
      setFiles(f);
      // 경비정산 결재 문서 (EXPENSE 양식 + referenceType=EXPENSE_SETTLEMENT)
      // → expense-service에서 settlement 본문(거래·영수증) 추가 로드
      if (d?.referenceType === "EXPENSE_SETTLEMENT" && d?.referenceId) {
        try {
          const s = await expenseApi.getSettlement(d.referenceId);
          setSettlement(s);
        } catch (err) {
          console.error("settlement load failed", err);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [docId]);

  useEffect(() => { load(); }, [load]);

  const doAction = async (action: "submit" | "approve" | "reject" | "agree" | "withdraw") => {
    setActing(true);
    try {
      if (action === "withdraw") {
        if (!confirm("상신을 취소하시겠습니까?")) { setActing(false); return; }
        await approvalApi.withdrawDocument(docId);
      } else if (action === "submit") await approvalApi.submitDocument(docId);
      else if (action === "approve") await approvalApi.approveDocument(docId, comment);
      else if (action === "reject") {
        if (!comment.trim()) { alert("반려 사유를 입력해주세요."); setActing(false); return; }
        await approvalApi.rejectDocument(docId, comment);
      } else if (action === "agree") await approvalApi.agreeDocument(docId, comment);
      setComment("");
      await load();
    } catch (e: any) {
      alert(e.message || "작업 실패");
    } finally {
      setActing(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await approvalApi.uploadFile(docId, file);
      const f = await approvalApi.getDocumentFiles(docId);
      setFiles(f);
    } catch {
      alert("파일 업로드 실패");
    }
    e.target.value = "";
  };

  if (loading) return <div className="text-center py-12 text-gray-400">로딩 중...</div>;
  if (!doc) return <div className="text-center py-12 text-red-500 dark:text-red-400">문서를 찾을 수 없습니다.</div>;

  const steps = (doc.steps || []).sort((a: any, b: any) => a.stepOrder - b.stepOrder);
  const isDrafter = currentUser?.id === (doc.requestedBy || doc.drafterId);
  const currentStep = steps.find((s: any) => s.status === "PENDING" && (s.approverId === currentUser?.id || s.userId === currentUser?.id));
  const canApprove = !!currentStep && (currentStep.roleName === "결재" || currentStep.role === "APPROVER");
  const canAgree = !!currentStep && (currentStep.roleName === "합의" || currentStep.role === "AGREEER");
  const canWithdraw = isDrafter && ["SUBMITTED", "AGREEMENT_PENDING", "STEP_1_PENDING", "STEP_2_PENDING", "STEP_3_PENDING"].includes(doc.status);
  const fields = doc.content || doc.fields || {};
  const body = doc.richBody || doc.body || "";
  const items = doc.itemsData || doc.items || [];

  return (
    <div className="max-w-4xl">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs px-2 py-0.5 rounded bg-gray-100">{doc.template?.name || doc.templateCode}</span>
            <span className={`text-xs px-2 py-0.5 rounded ${STATUS_COLORS[doc.status]}`}>
              {STATUS_LABELS[doc.status] || doc.status}
            </span>
          </div>
          <h2 className="text-xl font-bold">{doc.title}</h2>
          <div className="text-sm text-gray-500 mt-1">
            문서번호: {doc.documentNumber || "미발행"} · 기안자: {doc.requesterName || doc.drafterName || doc.requestedBy} · 부서: {doc.department || "-"}
            {doc.submittedAt && ` · 상신일: ${new Date(doc.submittedAt).toLocaleDateString("ko-KR")}`}
          </div>
        </div>
        {(doc.amount || doc.itemsTotal || doc.totalAmount) > 0 && (
          <div className="text-right">
            <div className="text-xs text-gray-500">총 금액</div>
            <div className="text-xl font-bold">₩{Number(doc.amount || doc.itemsTotal || doc.totalAmount).toLocaleString()}</div>
          </div>
        )}
      </div>

      {/* 결재선 타임라인 */}
      <div className="mb-6">
        <h3 className="text-sm font-medium text-gray-700 mb-3">결재선</h3>
        <div className="flex items-start gap-0 overflow-x-auto">
          {/* 기안자 */}
          <div className="flex items-start">
            <div className="border-2 rounded-lg p-3 min-w-[120px] text-center border-blue-500 bg-blue-50">
              <div className="text-xs text-gray-400 mb-1">기안</div>
              <div className="font-medium text-sm">{doc.requesterName || doc.drafterName || doc.requestedBy}</div>
              <div className="text-xs mt-1 font-medium text-blue-600 dark:text-blue-300">기안</div>
              {doc.submittedAt && (
                <div className="text-[10px] text-gray-400 mt-1">
                  {new Date(doc.submittedAt).toLocaleDateString("ko-KR")}
                </div>
              )}
            </div>
            {steps.length > 0 && (
              <div className="flex items-center h-16 px-1">
                <span className="text-gray-300">→</span>
              </div>
            )}
          </div>
          {steps.map((step: any, idx: number) => (
            <div key={step.id} className="flex items-start">
              <div className={`border-2 rounded-lg p-3 min-w-[120px] text-center ${STEP_STATUS_COLORS[step.status]}`}>
                <div className="text-xs text-gray-400 mb-1">
                  {step.roleName || (step.role === "APPROVER" ? "결재" : "합의")} {step.stepOrder}
                </div>
                <div className="font-medium text-sm">{step.approverName || step.userName || step.approverId}</div>
                <div className={`text-xs mt-1 font-medium ${
                  step.status === "APPROVED" || step.status === "AGREED" ? "text-green-600 dark:text-green-300" :
                  step.status === "REJECTED" || step.status === "DISAGREED" ? "text-red-600 dark:text-red-300" : "text-gray-400"
                }`}>
                  {STEP_LABELS[step.status]}
                </div>
                {step.actedAt && (
                  <div className="text-[10px] text-gray-400 mt-1">
                    {new Date(step.actedAt).toLocaleDateString("ko-KR")}
                  </div>
                )}
                {step.comment && (
                  <div className="text-[10px] text-gray-500 mt-1 italic">"{step.comment}"</div>
                )}
              </div>
              {idx < steps.length - 1 && (
                <div className="flex items-center h-16 px-1">
                  <span className="text-gray-300">→</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 필드 정보 — template에 정의된 field만, template 순서대로 표시 (hidden 제외) */}
      {fields && Object.keys(fields).length > 0 && (() => {
        const templateFields: any[] = doc.template?.fields ?? [];
        // template 순서를 따라 정렬 + hidden 타입(settlementId 등 내부 ID) 제외
        const renderable = templateFields
          .filter((f: any) => f.type !== "hidden" && f.key in fields)
          .map((f: any) => [f.key, fields[f.key]] as [string, any]);
        if (renderable.length === 0) return null;

        const formatVal = (val: any, fieldType?: string) => {
          // date-multi (workDates) — array 또는 string 모두 처리
          if (fieldType === "date-multi" || Array.isArray(val)) {
            const list = Array.isArray(val) ? val : String(val).split(",");
            const cleaned = list.map((d) => String(d).trim()).filter(Boolean);
            if (cleaned.length === 0) return "—";
            return cleaned.join(", ");
          }
          if (val === null || val === undefined || val === "") return "—";
          // 금액 — money / currency / 숫자 + 금액성 키
          if (fieldType === "money" || fieldType === "currency") {
            return `${Number(val).toLocaleString()}원`;
          }
          // 객체(예: categoryStats — type:"json")는 보기 좋게 분해
          if (fieldType === "json" || typeof val === "object") {
            const entries = Object.values(val) as Array<{ name?: string; count?: number; amount?: number }>;
            if (entries.every((e) => e && typeof e === "object" && "amount" in e)) {
              return (
                <div className="space-y-0.5">
                  {entries.map((e, i) => (
                    <div key={i} className="text-xs">
                      <span className="text-gray-600">{e.name ?? "—"}:</span>{" "}
                      <span className="tabular-nums">{Number(e.amount ?? 0).toLocaleString()}원</span>
                      <span className="text-gray-400"> ({e.count ?? 0}건)</span>
                    </div>
                  ))}
                </div>
              );
            }
            return JSON.stringify(val);
          }
          return String(val);
        };

        // OT/LEAVE 전용 12-col 레이아웃
        const tplCode = doc.template?.code;
        const isOT = tplCode === "OT";
        const isLeave = tplCode === "LEAVE";
        const useCustom = isOT || isLeave;
        const gridClass = useCustom
          ? "bg-gray-50 rounded-lg p-4 grid grid-cols-1 sm:grid-cols-12 gap-3"
          : "bg-gray-50 rounded-lg p-4 grid grid-cols-2 gap-3";
        const getItemClass = (key: string): string => {
          if (!useCustom) return "";
          if (isOT) {
            if (key === "project") return "sm:col-span-6";
            if (key === "task") return "sm:col-span-6";
            return "sm:col-span-12";
          }
          if (isLeave) {
            if (key === "leaveType") return "sm:col-span-4";
            if (key === "startDate") return "sm:col-span-4";
            if (key === "endDate") return "sm:col-span-4";
            return "sm:col-span-12";
          }
          return "";
        };

        return (
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-700 mb-2">문서 정보</h3>
            <div className={gridClass}>
              {renderable.map(([key, val]) => {
                const fieldDef = templateFields.find((f: any) => f.key === key);
                // v1.6.4 (2026-05-16): approval-ref 필드 — 연결된 결재 문서로 link 렌더
                if (fieldDef?.type === "approval-ref" && val) {
                  return (
                    <div key={key} className={getItemClass(key)}>
                      <div className="text-xs text-gray-500">{fieldDef.label || key}</div>
                      <div className="text-sm font-medium">
                        <a href={`/approval/${val}`} className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1">
                          📄 결재 문서 보기 →
                        </a>
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={key} className={getItemClass(key)}>
                    <div className="text-xs text-gray-500">{fieldDef?.label || key}</div>
                    <div className="text-sm font-medium">{formatVal(val, fieldDef?.type)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* 본문 */}
      {body && (
        <div className="mb-6">
          <h3 className="text-sm font-medium text-gray-700 mb-2">본문</h3>
          <div className="bg-white border rounded-lg p-4 text-sm whitespace-pre-wrap">{body}</div>
        </div>
      )}

      {/* 항목 테이블 */}
      {doc.referenceType === "EXPENSE_SETTLEMENT" ? (
        // settlement 우선 (drafter — 영수증 링크 포함), 실패 시 doc.items로 fallback (승인자)
        settlement ? (
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-700 mb-2">거래 목록 ({settlement.items?.length ?? 0}건)</h3>
            <table className="w-full text-sm border rounded">
              <thead className="bg-gray-50">
                <tr className="text-xs text-gray-600">
                  <th className="text-left px-3 py-2">거래일시</th>
                  <th className="text-left px-3 py-2">가맹점</th>
                  <th className="text-left px-3 py-2">사업(계약)</th>
                  <th className="text-right px-3 py-2">금액</th>
                  <th className="text-left px-3 py-2">상세 / 메모</th>
                  <th className="text-center px-3 py-2">영수증</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(settlement.items ?? []).map((it: any) => {
                  const t = it.transaction;
                  const confirmed = (t.matches ?? []).find((m: any) => m.confirmedAt);
                  return (
                    <tr key={it.id}>
                      <td className="px-3 py-1.5 text-xs whitespace-nowrap">{fmtDateTime24(t.transactedAt, { short: true })}</td>
                      <td className="px-3 py-1.5">
                        <span className={t.isCanceled ? "line-through text-gray-400" : ""}>{t.merchantName}</span>
                        {t.isCanceled && <span className="ml-1 px-1 py-0.5 text-[10px] bg-red-100 text-red-700 rounded">취소</span>}
                      </td>
                      <td className="px-3 py-1.5 text-xs">{t.contractNumber && t.contractName ? `${t.contractNumber} - ${t.contractName}` : (t.contractNumber || t.contractName || "없음")}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-medium">{Number(t.amount).toLocaleString()}</td>
                      <td className="px-3 py-1.5 text-xs text-gray-600 max-w-[220px] truncate" title={[t.detail, t.memo, it.memoOverride].filter(Boolean).join(" / ")}>
                        {[t.detail, it.memoOverride ?? t.memo].filter(Boolean).join(" / ") || "—"}
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        {confirmed ? (
                          <a href={`/api/v1/expense/receipts/${confirmed.receipt.id}/download`} target="_blank" rel="noopener"
                            className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-700" title="영수증 보기">📎</a>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                <tr className="bg-gray-50 font-medium">
                  <td colSpan={3} className="px-3 py-2 text-right text-xs text-gray-600">합계</td>
                  <td className="px-3 py-2 text-right tabular-nums">{Number(settlement.totalAmount ?? 0).toLocaleString()}원</td>
                  <td colSpan={2}></td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : items && items.length > 0 ? (
          // 승인자가 정산서 직접 접근 불가 시 doc.items에 저장된 데이터로 렌더
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-700 mb-2">거래 목록 ({items.length}건)</h3>
            <table className="w-full text-sm border rounded">
              <thead className="bg-gray-50">
                <tr className="text-xs text-gray-600">
                  <th className="text-left px-3 py-2">거래일시</th>
                  <th className="text-left px-3 py-2">가맹점</th>
                  <th className="text-left px-3 py-2">사업(계약)</th>
                  <th className="text-right px-3 py-2">금액</th>
                  <th className="text-left px-3 py-2">메모</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((it: any, idx: number) => (
                  <tr key={idx}>
                    <td className="px-3 py-1.5 text-xs whitespace-nowrap">{it.transactedAt ? fmtDateTime24(it.transactedAt, { short: true }) : "—"}</td>
                    <td className="px-3 py-1.5">{it.merchantName ?? "—"}</td>
                    <td className="px-3 py-1.5 text-xs">{it.categoryName ?? "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-medium">{Number(it.amount ?? 0).toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-xs text-gray-600">{it.memo ?? "—"}</td>
                  </tr>
                ))}
                <tr className="bg-gray-50 font-medium">
                  <td colSpan={3} className="px-3 py-2 text-right text-xs text-gray-600">합계</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {items.reduce((s: number, it: any) => s + Number(it.amount ?? 0), 0).toLocaleString()}원
                  </td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : null
      ) : items && items.length > 0 ? (
        <div className="mb-6">
          <h3 className="text-sm font-medium text-gray-700 mb-2">항목</h3>
          <table className="w-full text-sm border rounded">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-3 py-2">내역</th>
                <th className="text-right px-3 py-2">단가</th>
                <th className="text-right px-3 py-2">수량</th>
                <th className="text-right px-3 py-2">소계</th>
                <th className="text-right px-3 py-2">부가세</th>
                <th className="text-center px-3 py-2">증빙</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((item: any, idx: number) => (
                <tr key={idx}>
                  <td className="px-3 py-2">{item.description}</td>
                  <td className="px-3 py-2 text-right">{Number(item.unitPrice).toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">{item.quantity}</td>
                  <td className="px-3 py-2 text-right">{Number(item.subtotal).toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">{Number(item.vat).toLocaleString()}</td>
                  <td className="px-3 py-2 text-center">
                    {(item.attachments || []).length > 0 ? (
                      <div className="flex flex-col items-center gap-0.5">
                        {(item.attachments as any[]).map((att: any) => (
                          <a key={att.id} href={`/api/v1/approval/files/${att.id}/download`}
                            className="text-xs text-blue-600 dark:text-blue-400 hover:underline truncate max-w-[100px]" title={att.fileName}>
                            {att.fileName}
                          </a>
                        ))}
                      </div>
                    ) : item.evidence ? (
                      <span className="text-emerald-600 dark:text-emerald-400 text-base" title={item.evidence}>✓</span>
                    ) : (
                      <span className="text-xs text-gray-300">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* 첨부파일 */}
      <div className="mb-6">
        <h3 className="text-sm font-medium text-gray-700 mb-2">첨부파일</h3>
        {files.length === 0 ? (
          <p className="text-sm text-gray-400">첨부파일이 없습니다.</p>
        ) : (
          <ul className="space-y-1">
            {files.map((f: any) => (
              <li key={f.id} className="flex items-center gap-2 text-sm">
                <span>📎</span>
                <a href={`/api/v1/approval/files/${f.id}/download`} className="text-blue-600 dark:text-blue-400 hover:underline">
                  {f.fileName}
                </a>
                <span className="text-gray-400 text-xs">{(f.fileSize / 1024).toFixed(1)}KB</span>
              </li>
            ))}
          </ul>
        )}
        {(isDrafter && doc.status === "DRAFT") && (
          <label className="mt-2 inline-block text-xs text-blue-600 dark:text-blue-400 cursor-pointer hover:underline">
            + 파일 추가
            <input type="file" className="hidden" onChange={handleFileUpload} />
          </label>
        )}
      </div>

      {/* 편집 가능 안내 */}
      {isDrafter && ["DRAFT", "RETURNED", "REJECTED"].includes(doc.status) && (
        <div className="border-t pt-4 mb-4">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push(`/approval/${docId}/edit`)}
              className="px-4 py-2 border-2 border-blue-500 text-blue-600 dark:text-blue-400 rounded-lg text-sm font-medium hover:bg-blue-50 dark:hover:bg-blue-950">
              문서 편집
            </button>
            <span className="text-sm text-gray-500">내용을 수정하려면 편집 버튼을 눌러주세요.</span>
          </div>
        </div>
      )}

      {/* 결재 액션 */}
      {(canApprove || canAgree || (isDrafter && doc.status === "DRAFT") || canWithdraw) && (
        <div className="border-t pt-4">
          <div className="mb-3">
            <label className="block text-sm font-medium text-gray-700 mb-1">의견</label>
            <textarea
              value={comment} onChange={(e) => setComment(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm" rows={2}
              placeholder="의견을 입력하세요 (반려 시 필수)"
            />
          </div>
          <div className="flex gap-3">
            {isDrafter && doc.status === "DRAFT" && (
              <button disabled={acting} onClick={() => doAction("submit")}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                상신
              </button>
            )}
            {canApprove && (
              <>
                <button disabled={acting} onClick={() => doAction("approve")}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 disabled:opacity-50">
                  승인
                </button>
                <button disabled={acting} onClick={() => doAction("reject")}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 disabled:opacity-50">
                  반려
                </button>
              </>
            )}
            {canAgree && (
              <button disabled={acting} onClick={() => doAction("agree")}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                합의
              </button>
            )}
            {canWithdraw && (
              <button disabled={acting} onClick={() => doAction("withdraw")}
                className="px-4 py-2 bg-orange-500 text-white rounded-lg text-sm hover:bg-orange-600 disabled:opacity-50">
                상신 취소
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
