"use client";

import { useState, useEffect, useCallback } from "react";
import { notificationApi } from "@/lib/api";

const NOTIFICATION_ICONS: Record<string, string> = {
  PROGRESS_STALE: "⏰",
  TASK_DUE_SOON:  "📅",
  TASK_ASSIGNED:  "📌",
  COMMENT_MENTION:"💬",
  OT_APPROVED:    "✅",
  OT_REJECTED:    "❌",
  LEAVE_APPROVED: "✅",
  LEAVE_REJECTED: "❌",
  RISK_DELAY:     "⚠",
  RISK_OVERLOAD:  "🔴",
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "방금";
  if (mins < 60) return `${mins}분 전`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

export default function NotificationsPage() {
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);

  const PAGE_SIZE = 20;

  const load = useCallback(async (p = 1, uo = unreadOnly, reset = false) => {
    setLoading(true);
    try {
      const res = await notificationApi.list({ unreadOnly: uo, page: p, pageSize: PAGE_SIZE });
      setItems((prev) => reset ? res.items : [...prev, ...res.items]);
      setTotal(res.total);
      setPage(p);
    } catch {}
    setLoading(false);
  }, [unreadOnly]);

  useEffect(() => {
    load(1, unreadOnly, true);
  }, [unreadOnly]);

  const markRead = async (id: string) => {
    await notificationApi.markRead(id);
    setItems((prev) => prev.map((n) => n.id === id ? { ...n, isRead: true } : n));
  };

  const markAllRead = async () => {
    setMarkingAll(true);
    await notificationApi.markAllRead();
    setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setMarkingAll(false);
  };

  const unreadCount = items.filter((n) => !n.isRead).length;

  return (
    <div className="p-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">알림</h1>
          {unreadCount > 0 && (
            <p className="text-sm text-gray-500 mt-0.5">읽지 않은 알림 {unreadCount}개</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(e) => setUnreadOnly(e.target.checked)}
              className="rounded"
            />
            읽지 않음만
          </label>
          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              disabled={markingAll}
              className="text-sm text-blue-600 hover:underline disabled:opacity-50"
            >
              전체 읽음
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div className="space-y-1">
        {items.length === 0 && !loading && (
          <div className="text-center py-16 text-gray-400">
            <div className="text-4xl mb-3">🔔</div>
            <div className="text-sm">알림이 없습니다.</div>
          </div>
        )}
        {items.map((n) => (
          <div
            key={n.id}
            className={`flex items-start gap-3 px-4 py-3 rounded-xl cursor-pointer transition-colors ${
              n.isRead ? "bg-white hover:bg-gray-50 border border-gray-100" : "bg-blue-50 border border-blue-100"
            }`}
            onClick={() => {
              if (!n.isRead) markRead(n.id);
              if (n.linkUrl) window.location.href = n.linkUrl;
            }}
          >
            <div className="text-xl shrink-0 mt-0.5">
              {NOTIFICATION_ICONS[n.type] ?? "🔔"}
            </div>
            <div className="flex-1 min-w-0">
              <div className={`text-sm font-medium ${n.isRead ? "text-gray-700" : "text-gray-900"}`}>
                {n.title}
              </div>
              <div className={`text-xs mt-0.5 ${n.isRead ? "text-gray-400" : "text-gray-600"}`}>
                {n.body}
              </div>
              <div className="text-xs text-gray-400 mt-1">{timeAgo(n.createdAt)}</div>
            </div>
            {!n.isRead && (
              <div className="w-2 h-2 rounded-full bg-blue-500 shrink-0 mt-2" />
            )}
          </div>
        ))}

        {loading && (
          <div className="text-center py-6 text-sm text-gray-400">불러오는 중...</div>
        )}
      </div>

      {/* Load more */}
      {!loading && items.length < total && (
        <div className="mt-4 text-center">
          <button
            onClick={() => load(page + 1, unreadOnly, false)}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
          >
            더 보기 ({items.length}/{total})
          </button>
        </div>
      )}
    </div>
  );
}
