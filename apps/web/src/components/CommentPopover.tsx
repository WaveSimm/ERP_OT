"use client";

import { useState, useRef, useCallback } from "react";
import { commentApi } from "@/lib/api";

interface Props {
  taskId: string;
  count: number;
}

export default function CommentPopover({ taskId, count }: Props) {
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchedRef = useRef(false);

  const handleMouseEnter = useCallback(async (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPos({ top: rect.bottom + 6, left: rect.left });
    setOpen(true);

    if (!fetchedRef.current) {
      setLoading(true);
      try {
        const data = await commentApi.list(taskId);
        setComments(data);
        fetchedRef.current = true;
      } catch {
        setComments([]);
      } finally {
        setLoading(false);
      }
    }
  }, [taskId]);

  const handleMouseLeave = useCallback(() => {
    timerRef.current = setTimeout(() => setOpen(false), 120);
  }, []);

  const handlePopoverEnter = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const handlePopoverLeave = useCallback(() => {
    setOpen(false);
  }, []);

  return (
    <>
      <span
        className="flex items-center gap-0.5 text-[10px] text-gray-400 hover:text-blue-500 cursor-pointer transition-colors"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
          <path d="M2 2h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5l-3 3V3a1 1 0 0 1 1-1z" />
        </svg>
        {count}
      </span>

      {open && (
        <div
          className="fixed z-[9999] w-72 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden"
          style={{ top: pos.top, left: pos.left }}
          onMouseEnter={handlePopoverEnter}
          onMouseLeave={handlePopoverLeave}
        >
          <div className="px-3 py-2 border-b border-gray-100 flex items-center gap-1.5">
            <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" className="text-gray-400">
              <path d="M2 2h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5l-3 3V3a1 1 0 0 1 1-1z" />
            </svg>
            <span className="text-xs font-semibold text-gray-600">댓글 {count}개</span>
          </div>

          <div className="max-h-64 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-6">
                <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : comments.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-4">댓글이 없습니다.</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {comments.map((c) => (
                  <div key={c.id} className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5 mb-1">
                      <div className="w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center text-[9px] font-bold text-blue-600 shrink-0">
                        {(c.authorId ?? "?").slice(-2).toUpperCase()}
                      </div>
                      <span className="text-[10px] text-gray-400">
                        {new Date(c.createdAt).toLocaleDateString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    <p className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap break-words">{c.content}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
