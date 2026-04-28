"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { postApi } from "@/lib/api";

const POLL_INTERVAL = 30_000;

export default function NoticeBadge() {
  const router = useRouter();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const load = async () => {
      try {
        const res = await postApi.unreadCount("notice");
        if (!cancelled) setUnread(res.total ?? 0);
      } catch {
        // 인증 만료 등은 조용히 무시
      }
    };

    load();
    timer = setInterval(load, POLL_INTERVAL);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, []);

  return (
    <button
      onClick={() => router.push("/board/notice")}
      className="relative p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
      title="공지사항"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="w-5 h-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.8}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z"
        />
      </svg>
      {unread > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-0.5">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </button>
  );
}
