"use client";

import { useState } from "react";

export default function CommentForm({
  onSubmit,
  onCancel,
  placeholder = "댓글 작성...",
  initial = "",
  submitLabel = "등록",
  compact = false,
}: {
  onSubmit: (content: string) => Promise<void>;
  onCancel?: () => void;
  placeholder?: string;
  initial?: string;
  submitLabel?: string;
  compact?: boolean;
}) {
  const [content, setContent] = useState(initial);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(content.trim());
      setContent("");
    } catch (err: any) {
      setError(err?.message ?? "등록 실패");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className={compact ? "" : "mt-3"}>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={placeholder}
        rows={compact ? 2 : 3}
        maxLength={2000}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
      />
      {error && (
        <div className="mt-1 text-xs text-red-600">{error}</div>
      )}
      <div className="flex items-center justify-between mt-2">
        <span className="text-xs text-gray-400">{content.length}/2000</span>
        <div className="flex gap-2">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="px-3 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
            >
              취소
            </button>
          )}
          <button
            type="submit"
            disabled={submitting || !content.trim()}
            className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? "등록 중..." : submitLabel}
          </button>
        </div>
      </div>
    </form>
  );
}
