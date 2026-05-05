"use client";

import { useState } from "react";
import { DateInput } from "@/components/ui/DateInput";

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface WorkLogFormValue {
  content: string;
  workedAt: string;
  segmentId?: string | null;
}

interface Props {
  segments?: Array<{ id: string; name: string }>;
  initial?: Partial<WorkLogFormValue>;
  onSubmit: (v: WorkLogFormValue) => Promise<void>;
  onCancel?: () => void;
  submitLabel?: string;
  showSegment?: boolean;
}

export default function WorkLogForm({
  segments,
  initial,
  onSubmit,
  onCancel,
  submitLabel = "등록",
  showSegment = true,
}: Props) {
  const [content, setContent] = useState(initial?.content ?? "");
  const [workedAt, setWorkedAt] = useState(initial?.workedAt ?? todayStr());
  const [segmentId, setSegmentId] = useState<string>(initial?.segmentId ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    setError(null);
    setSubmitting(true);
    try {
      const v: WorkLogFormValue = {
        content: content.trim(),
        workedAt,
      };
      if (segmentId) v.segmentId = segmentId;
      await onSubmit(v);
      if (!initial) {
        setContent("");
      }
    } catch (err: any) {
      setError(err?.message ?? "저장 실패");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-gray-50 border border-gray-200 rounded-lg p-3">
      <div className="flex items-center gap-2 mb-2">
        <label className="text-xs text-gray-500 shrink-0">작업일</label>
        <DateInput
          
          value={workedAt}
          onChange={(e) => setWorkedAt(e.target.value)}
          className="border border-gray-300 rounded px-2 py-1 text-xs"
          required
        />
        {showSegment && segments && segments.length > 0 && (
          <>
            <label className="text-xs text-gray-500 shrink-0 ml-2">구간</label>
            <select
              value={segmentId}
              onChange={(e) => setSegmentId(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-xs flex-1 min-w-0"
            >
              <option value="">전체 (구간 미지정)</option>
              {segments.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="오늘 한 작업 내용을 markdown으로..."
        rows={4}
        maxLength={51200}
        className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      {error && (
        <div className="mt-1 text-xs text-red-600">{error}</div>
      )}

      <div className="flex items-center justify-between mt-2">
        <span className="text-xs text-gray-400">{content.length}/51,200</span>
        <div className="flex gap-2">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="px-3 py-1 text-xs border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50"
            >
              취소
            </button>
          )}
          <button
            type="submit"
            disabled={submitting || !content.trim()}
            className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? "저장 중..." : submitLabel}
          </button>
        </div>
      </div>
    </form>
  );
}
