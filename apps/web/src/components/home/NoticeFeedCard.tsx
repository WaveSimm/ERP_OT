"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import HomeCard from "./HomeCard";
import { postApi } from "@/lib/api";

interface FeedItem {
  id: string;
  title: string;
  isPinned: boolean;
  priority: number;
  publishedAt: string;
  isRead: boolean;
  boardCode: string;
  boardName: string;
  authorName: string;
}

export default function NoticeFeedCard() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    postApi
      .feed({ categoryCode: "notice", limit: 5 })
      .then((res) => {
        if (!cancelled) setItems((res.items ?? []) as FeedItem[]);
      })
      .catch((e) => console.error("[NoticeFeed]", e))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const unreadCount = items.filter((i) => !i.isRead).length;

  return (
    <HomeCard
      icon="📢"
      title="공지사항"
      href="/board/notice"
      hrefLabel="공지함"
      badge={
        unreadCount > 0 ? (
          <span className="bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 min-w-[16px] text-center">
            {unreadCount}
          </span>
        ) : null
      }
      loading={loading}
      empty={!loading && items.length === 0}
    >
      <ul className="divide-y divide-gray-100 -mx-2">
        {items.map((p) => {
          const dt = new Date(p.publishedAt);
          const dateStr = `${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
          return (
            <li key={p.id}>
              <Link
                href={`/board/notice/${p.boardCode}/${p.id}`}
                className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 text-sm"
              >
                <span className="text-xs text-gray-500 w-16 shrink-0 truncate">{p.boardName}</span>
                {p.isPinned && <span className="text-blue-600 dark:text-blue-400 text-xs shrink-0">📌</span>}
                {p.priority === 2 && (
                  <span className="text-[10px] font-semibold px-1 py-0.5 rounded bg-red-100 text-red-700 shrink-0">긴급</span>
                )}
                {p.priority === 1 && (
                  <span className="text-[10px] font-semibold px-1 py-0.5 rounded bg-amber-100 text-amber-700 shrink-0">중요</span>
                )}
                <span className={`flex-1 truncate ${p.isRead ? "text-gray-600" : "text-gray-900 font-medium"}`}>
                  {p.title}
                </span>
                {!p.isRead && <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />}
                <span className="text-xs text-gray-400 shrink-0">{dateStr}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </HomeCard>
  );
}
