"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { expenseApi, projectApi, departmentApi, userManagementApi, approvalLineApi } from "@/lib/api";
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
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [titleSaving, setTitleSaving] = useState(false);

  // 결재 상신 시 함께 보낼 옵션 — 지출결의서 편집 단계 생략용
  const [projectName, setProjectName] = useState("");
  const [body, setBody] = useState("");
  const [projects, setProjects] = useState<any[]>([]);
  const [projectSearch, setProjectSearch] = useState("");
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);
  const [departments, setDepartments] = useState<any[]>([]);
  const [allMembers, setAllMembers] = useState<any[]>([]);
  const [approvalLine, setApprovalLine] = useState<{ userId: string; userName: string; role: string }[]>([]);
  const [selectedDeptId, setSelectedDeptId] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedRole, setSelectedRole] = useState("APPROVER");

  const filteredProjects = projectSearch
    ? projects.filter((p: any) => (p.name || "").toLowerCase().includes(projectSearch.toLowerCase()))
    : projects;
  const filteredMembers = selectedDeptId
    ? allMembers.filter((m: any) => m.departmentId === selectedDeptId)
    : allMembers;

  const load = async () => {
    setLoading(true);
    try {
      setS(await expenseApi.getSettlement(id));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  // DRAFT/REJECTED 일 때만 결재 상신 입력용 데이터 로드
  useEffect(() => {
    if (!s) return;
    if (!["DRAFT", "REJECTED"].includes(s.status)) return;
    Promise.all([
      projectApi.list().then((r: any) => r.items || r).catch(() => []),
      departmentApi.list().catch(() => []),
      userManagementApi.members(true).catch(() => []),
    ]).then(([projs, depts, members]) => {
      setProjects(Array.isArray(projs) ? projs : []);
      setDepartments(Array.isArray(depts) ? depts : []);
      setAllMembers(Array.isArray(members) ? members : []);
    });
  }, [s?.status]);

  const addApprover = () => {
    if (!selectedUserId) return;
    const m = allMembers.find((x: any) => x.id === selectedUserId);
    if (!m) return;
    if (approvalLine.some((a) => a.userId === selectedUserId)) return;
    setApprovalLine((prev) => [...prev, { userId: m.id, userName: m.name, role: selectedRole }]);
    setSelectedUserId("");
  };
  const removeApprover = (idx: number) => setApprovalLine((p) => p.filter((_, i) => i !== idx));

  const loadMyApprovalLine = async () => {
    try {
      const info = await approvalLineApi.getMe();
      if (!info) return;
      const line: { userId: string; userName: string; role: string }[] = [];
      if (info.approverId && info.approverName) {
        line.push({ userId: info.approverId, userName: info.approverName + (info.isDelegated ? " (위임)" : ""), role: "APPROVER" });
      }
      if (info.secondApproverId && info.secondApproverName) {
        line.push({ userId: info.secondApproverId, userName: info.secondApproverName, role: "APPROVER" });
      }
      if (info.thirdApproverId && info.thirdApproverName) {
        line.push({ userId: info.thirdApproverId, userName: info.thirdApproverName, role: "APPROVER" });
      }
      if (line.length > 0) setApprovalLine(line);
    } catch { /* ignore */ }
  };

  const submit = async () => {
    if (!confirm("결재를 상신하시겠습니까?\n상신 후에는 정산 내용을 수정할 수 없습니다.")) return;
    setSubmitting(true);
    try {
      await expenseApi.submitSettlement(id, {
        projectName: projectName.trim() || null,
        body: body.trim() || null,
        approvers: approvalLine.length > 0
          ? approvalLine.map((a, i) => ({
              stepOrder: i + 1,
              roleName: a.role === "AGREEER" ? "합의" : "결재",
              approverId: a.userId,
              approverName: a.userName,
            }))
          : undefined,
      });
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

      {/* 결재 상신 입력 (DRAFT/REJECTED 만) — 지출결의서 편집 단계 생략용 */}
      {(isDraft || isRejected) && (
        <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
          <h2 className="text-sm font-bold text-gray-700">결재 상신 정보</h2>
          <p className="text-xs text-gray-500">아래 항목은 상신할 결재 문서에 함께 들어갑니다. 비워두면 기본값 사용.</p>

          {/* 프로젝트 (옵션) */}
          <div>
            <label className="block text-xs text-gray-600 mb-1">프로젝트 (옵션)</label>
            <div className="relative">
              <input
                type="text"
                value={projectName}
                onChange={(e) => { setProjectName(e.target.value); setProjectSearch(e.target.value); setShowProjectDropdown(true); }}
                onFocus={() => setShowProjectDropdown(true)}
                onBlur={() => setTimeout(() => setShowProjectDropdown(false), 150)}
                placeholder="프로젝트명 검색 또는 직접 입력"
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
              {showProjectDropdown && filteredProjects.length > 0 && (
                <ul className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg max-h-48 overflow-y-auto shadow-lg">
                  {filteredProjects.slice(0, 20).map((p: any) => (
                    <li key={p.id}
                      onMouseDown={() => { setProjectName(p.name); setShowProjectDropdown(false); }}
                      className="px-3 py-1.5 text-sm hover:bg-blue-50 cursor-pointer">
                      {p.name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* 본문 (옵션) */}
          <div>
            <label className="block text-xs text-gray-600 mb-1">본문 (옵션)</label>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3}
              placeholder="결재 문서 본문 — 비워두면 기본값"
              className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>

          {/* 결재선 */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <label className="text-xs text-gray-600">결재선 (비우면 부서 기본선 자동 적용)</label>
              <button onClick={loadMyApprovalLine} className="text-xs text-blue-500 hover:underline">부서 기본선 불러오기</button>
            </div>
            {approvalLine.length > 0 && (
              <div className="flex gap-2 flex-wrap mb-2">
                {approvalLine.map((a, i) => (
                  <div key={i} className="flex items-center gap-1 bg-blue-50 rounded-full px-3 py-1 text-sm">
                    <span className="text-xs text-blue-500">{i + 1}차</span>
                    <span>{a.userName}</span>
                    <span className="text-xs text-gray-400">({a.role === "APPROVER" ? "결재" : "합의"})</span>
                    <button onClick={() => removeApprover(i)} className="text-gray-400 hover:text-red-500 ml-1">✕</button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2 items-end flex-wrap">
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">부서</label>
                <select value={selectedDeptId} onChange={(e) => { setSelectedDeptId(e.target.value); setSelectedUserId(""); }}
                  className="border rounded px-2 py-1 text-sm w-36">
                  <option value="">전체 부서</option>
                  {departments.map((d: any) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">이름</label>
                <select value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)}
                  className="border rounded px-2 py-1 text-sm w-40">
                  <option value="">선택하세요</option>
                  {filteredMembers.map((m: any) => (
                    <option key={m.id} value={m.id}>{m.name}{m.position ? ` (${m.position})` : ""}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">역할</label>
                <select value={selectedRole} onChange={(e) => setSelectedRole(e.target.value)}
                  className="border rounded px-2 py-1 text-sm">
                  <option value="APPROVER">결재</option>
                  <option value="AGREEER">합의</option>
                </select>
              </div>
              <button onClick={addApprover} disabled={!selectedUserId}
                className="px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded text-sm disabled:opacity-40">추가</button>
            </div>
          </div>
        </div>
      )}

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
