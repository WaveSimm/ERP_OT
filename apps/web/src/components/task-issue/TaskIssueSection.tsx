"use client";

import { useEffect, useState } from "react";
import { taskIssueApi } from "@/lib/api";
import type { TaskIssue } from "@/lib/api/types";
import { fmtDateTime24 } from "@/lib/datetime";

interface Props {
  taskId: string;
}

export default function TaskIssueSection({ taskId }: Props) {
  const [issues, setIssues] = useState<TaskIssue[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    taskIssueApi
      .listByTask(taskId)
      .then((data) => {
        if (!cancelled) setIssues((data ?? []) as TaskIssue[]);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message ?? "이슈 목록 로드 실패");
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  const handleCreate = async () => {
    const content = draft.trim();
    if (!content || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const created = await taskIssueApi.create(taskId, { content });
      setIssues((prev) => [created, ...prev]);
      setDraft("");
    } catch (err: any) {
      setError(err?.message ?? "이슈 등록 실패");
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void handleCreate();
    }
  };

  const handleToggle = async (issue: TaskIssue) => {
    const next = !issue.isResolved;
    // 낙관적 업데이트
    setIssues((prev) => prev.map((i) => (i.id === issue.id ? { ...i, isResolved: next } : i)));
    try {
      const updated = await taskIssueApi.update(issue.id, { isResolved: next });
      setIssues((prev) => prev.map((i) => (i.id === issue.id ? updated : i)));
    } catch (err: any) {
      // 롤백
      setIssues((prev) => prev.map((i) => (i.id === issue.id ? { ...i, isResolved: issue.isResolved } : i)));
      setError(err?.message ?? "이슈 상태 변경 실패");
    }
  };

  const handleDelete = async (issue: TaskIssue) => {
    if (!confirm("이 이슈를 삭제하시겠습니까?")) return;
    const prev = issues;
    setIssues((cur) => cur.filter((i) => i.id !== issue.id));
    try {
      await taskIssueApi.remove(issue.id);
    } catch (err: any) {
      setIssues(prev);
      setError(err?.message ?? "이슈 삭제 실패");
    }
  };

  const openCount = issues.filter((i) => !i.isResolved).length;

  return (
    <div className="space-y-2">
      {/* 입력 — 텍스트 + Enter로 이슈 생성 */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="이슈를 입력하고 Enter (미해결로 등록됩니다)"
          maxLength={2000}
          disabled={submitting}
          className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={handleCreate}
          disabled={submitting || !draft.trim()}
          className="px-3 py-2 text-xs bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 shrink-0"
        >
          {submitting ? "등록 중..." : "이슈 등록"}
        </button>
      </div>

      {error && (
        <div className="px-3 py-2 bg-red-50 border border-red-200 dark:border-red-800 rounded text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-4">
          <div className="animate-spin w-5 h-5 border-2 border-red-600 border-t-transparent rounded-full" />
        </div>
      ) : issues.length === 0 ? (
        <p className="text-xs text-gray-400 py-2">등록된 이슈가 없습니다.</p>
      ) : (
        <>
          {openCount > 0 && (
            <div className="text-[11px] text-red-600 font-medium">미해결 이슈 {openCount}건</div>
          )}
          <ul className="space-y-1.5">
            {issues.map((issue) => (
              <li
                key={issue.id}
                className={`group flex items-start gap-2 border rounded-lg px-3 py-2 text-sm ${
                  issue.isResolved
                    ? "border-gray-200 bg-gray-50 dark:bg-gray-800/40"
                    : "border-red-200 bg-red-50/50 dark:bg-red-500/10"
                }`}
              >
                <input
                  type="checkbox"
                  checked={issue.isResolved}
                  onChange={() => handleToggle(issue)}
                  className="mt-0.5 w-4 h-4 shrink-0 accent-red-600 cursor-pointer"
                  title={issue.isResolved ? "미해결로 되돌리기" : "해결로 표시"}
                />
                <div className="flex-1 min-w-0">
                  <div
                    className={`whitespace-pre-wrap break-words ${
                      issue.isResolved ? "text-gray-400 line-through" : "text-gray-800 dark:text-gray-100"
                    }`}
                  >
                    {issue.content}
                  </div>
                  <div className="text-[11px] text-gray-400 mt-0.5">
                    {issue.authorName || "익명"} · {fmtDateTime24(issue.createdAt)}
                    {issue.isResolved && issue.resolvedAt && ` · 해결 ${fmtDateTime24(issue.resolvedAt)}`}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(issue)}
                  className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-600 text-xs shrink-0 transition-opacity"
                  title="삭제"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
