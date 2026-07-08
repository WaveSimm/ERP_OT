"use client";

/**
 * 게시판 design v2.0 (2026-05-22): 기능 요구 카테고리 전용 패널
 * - 상태/유형/모듈/담당자/릴리즈/완료일 표시
 * - ADMIN: 상태 변경, 담당자 지정, 릴리즈 입력
 * - 담당자(assignee): 상태 변경
 */

import { useEffect, useState } from "react";
import { postApi, userManagementApi, getUser } from "@/lib/api";

export type FeatureRequestStatus =
  | "SUBMITTED" | "UNDER_REVIEW" | "APPROVED" | "IN_PROGRESS"
  | "COMPLETED" | "REJECTED" | "ON_HOLD";

export type FeatureRequestType = "BUG" | "NEW_FEATURE" | "IMPROVEMENT" | "UI_UX" | "DOCS" | "OTHER";

const STATUS_LABEL: Record<FeatureRequestStatus, { text: string; bg: string; fg: string }> = {
  SUBMITTED:    { text: "접수",       bg: "bg-gray-100",    fg: "text-gray-700" },
  UNDER_REVIEW: { text: "검토 중",     bg: "bg-blue-100",    fg: "text-blue-700" },
  APPROVED:     { text: "승인",       bg: "bg-emerald-100", fg: "text-emerald-700" },
  IN_PROGRESS:  { text: "진행 중",     bg: "bg-amber-100",   fg: "text-amber-700" },
  COMPLETED:    { text: "완료",       bg: "bg-green-200",   fg: "text-green-800" },
  REJECTED:     { text: "반려",       bg: "bg-red-100",     fg: "text-red-700" },
  ON_HOLD:      { text: "보류",       bg: "bg-stone-200",   fg: "text-stone-700" },
};

const TYPE_LABEL: Record<FeatureRequestType, string> = {
  BUG: "🐛 버그",
  NEW_FEATURE: "✨ 신규 기능",
  IMPROVEMENT: "📈 개선",
  UI_UX: "🎨 UI/UX",
  DOCS: "📄 매뉴얼·문서",
  OTHER: "📌 기타",
};

interface Props {
  post: any;
  onUpdated: (next: any) => void;
}

export default function FeatureRequestPanel({ post, onUpdated }: Props) {
  const me = getUser();
  const isAdmin = me?.role === "ADMIN";
  const isAssignee = post.assigneeId === me?.id;
  const canChangeStatus = isAdmin || isAssignee;

  const status = (post.requestStatus ?? "SUBMITTED") as FeatureRequestStatus;
  const type = (post.requestType ?? null) as FeatureRequestType | null;

  const [submitting, setSubmitting] = useState(false);
  const [releaseVersionDraft, setReleaseVersionDraft] = useState<string>(post.releaseVersion ?? "");
  const [users, setUsers] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    if (!isAdmin) return;
    userManagementApi.members(true).then((arr: any) => {
      setUsers((arr ?? []).map((u: any) => ({ id: u.id, name: u.name ?? u.email })));
    }).catch(() => {});
  }, [isAdmin]);

  const handleStatus = async (next: FeatureRequestStatus) => {
    if (!canChangeStatus || submitting) return;
    setSubmitting(true);
    try {
      const r = await postApi.updateFeatureStatus(post.id, {
        requestStatus: next,
        ...(releaseVersionDraft !== post.releaseVersion ? { releaseVersion: releaseVersionDraft || null } : {}),
      });
      onUpdated({ ...post, ...r });
    } catch (e: any) {
      alert(e.message ?? "상태 변경 실패");
    } finally {
      setSubmitting(false);
    }
  };

  const handleAssign = async (assigneeId: string | null) => {
    if (!isAdmin || submitting) return;
    setSubmitting(true);
    try {
      const r = await postApi.assignFeature(post.id, assigneeId);
      onUpdated({ ...post, assigneeId: r.assigneeId });
    } catch (e: any) {
      alert(e.message ?? "담당자 지정 실패");
    } finally {
      setSubmitting(false);
    }
  };

  const handleReleaseVersion = async () => {
    if (!isAdmin || submitting) return;
    setSubmitting(true);
    try {
      const r = await postApi.updateFeatureStatus(post.id, {
        requestStatus: status,
        releaseVersion: releaseVersionDraft || null,
      });
      onUpdated({ ...post, releaseVersion: r.releaseVersion });
    } catch (e: any) {
      alert(e.message ?? "릴리즈 버전 저장 실패");
    } finally {
      setSubmitting(false);
    }
  };

  const resolvedAt = post.resolvedAt ? new Date(post.resolvedAt) : null;

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/50 dark:bg-blue-500/10 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-2">
        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_LABEL[status].bg} ${STATUS_LABEL[status].fg}`}>
          {STATUS_LABEL[status].text}
        </span>
        {type && <span className="text-xs text-gray-700">{TYPE_LABEL[type]}</span>}
        {post.moduleArea && <span className="text-xs text-gray-600">· 모듈: {post.moduleArea}</span>}
        {post.assignee?.name && <span className="text-xs text-gray-600">· 담당: {post.assignee.name}</span>}
        {post.releaseVersion && <span className="text-xs text-gray-600">· 릴리즈: {post.releaseVersion}</span>}
        {resolvedAt && (
          <span className="text-xs text-gray-500">
            · 완료 {resolvedAt.getFullYear()}-{String(resolvedAt.getMonth() + 1).padStart(2, "0")}-{String(resolvedAt.getDate()).padStart(2, "0")}
          </span>
        )}
      </div>

      {canChangeStatus && (
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-blue-200">
          <span className="text-xs text-gray-600">상태 변경:</span>
          {(Object.keys(STATUS_LABEL) as FeatureRequestStatus[]).map((s) => (
            <button
              key={s}
              type="button"
              disabled={submitting || s === status}
              onClick={() => handleStatus(s)}
              className={`px-2 py-0.5 rounded text-xs border ${s === status ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"} disabled:opacity-50`}
            >
              {STATUS_LABEL[s].text}
            </button>
          ))}
        </div>
      )}

      {isAdmin && (
        <div className="flex flex-wrap items-center gap-2 pt-2 mt-2 border-t border-blue-200">
          <label className="text-xs text-gray-600">담당자:</label>
          <select
            value={post.assigneeId ?? ""}
            onChange={(e) => handleAssign(e.target.value || null)}
            disabled={submitting}
            className="text-xs border border-gray-300 rounded px-2 py-1 bg-white"
          >
            <option value="">— 미지정 —</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>

          <label className="text-xs text-gray-600 ml-2">릴리즈:</label>
          <input
            type="text"
            value={releaseVersionDraft}
            onChange={(e) => setReleaseVersionDraft(e.target.value)}
            placeholder="v1.0.0"
            maxLength={50}
            className="text-xs border border-gray-300 rounded px-2 py-1 bg-white w-28"
          />
          <button
            type="button"
            onClick={handleReleaseVersion}
            disabled={submitting || releaseVersionDraft === (post.releaseVersion ?? "")}
            className="text-xs px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50"
          >
            저장
          </button>
        </div>
      )}
    </div>
  );
}
