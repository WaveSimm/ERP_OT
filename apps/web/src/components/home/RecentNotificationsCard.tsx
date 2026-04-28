"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import HomeCard from "./HomeCard";
import { notificationApi } from "@/lib/api";

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  return `${d}일 전`;
}

export default function RecentNotificationsCard() {
  const [items, setItems] = useState<any[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      notificationApi.list({ unreadOnly: true, page: 1, pageSize: 5 }).catch(() => ({ items: [], total: 0 })),
      notificationApi.unreadCount().catch(() => ({ count: 0 })),
    ])
      .then(([list, cnt]: any) => {
        if (!cancelled) {
          setItems(list.items ?? []);
          setUnread(cnt.count ?? 0);
        }
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <HomeCard
      icon="🔔"
      title="최근 알림"
      href="/me/notifications"
      hrefLabel="알림함"
      badge={
        unread > 0 ? (
          <span className="bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 min-w-[16px] text-center">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null
      }
      loading={loading}
      empty={!loading && items.length === 0}
    >
      <ul className="space-y-2">
        {items.slice(0, 4).map((n: any) => (
          <li key={n.id}>
            <Link
              href={n.linkUrl ?? "/me/notifications"}
              className="block text-sm hover:bg-gray-50 -mx-2 px-2 py-1 rounded"
            >
              <div className="flex items-start gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0 mt-1.5" />
                <div className="flex-1 min-w-0">
                  <div className="truncate text-gray-800 font-medium">{n.title}</div>
                  <div className="text-xs text-gray-400">{timeAgo(n.createdAt)}</div>
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </HomeCard>
  );
}
