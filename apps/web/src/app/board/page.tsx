"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppLayout from "@/components/AppLayout";
import UnifiedBoardSidebar from "@/components/board/UnifiedBoardSidebar";
import SearchBar from "@/components/board/SearchBar";
import { postApi, workLogApi } from "@/lib/api";

interface FeedItem {
  id: string;
  title: string;
  summary: string;
  isPinned: boolean;
  priority: number;
  publishedAt: string;
  isRead: boolean;
  boardCode: string;
  boardName: string;
  authorName: string;
}

interface WorkLogFeedItem {
  id: string;
  taskId: string;
  taskName: string;
  segmentId: string | null;
  segmentName: string | null;
  projectId: string;
  projectName: string;
  authorId: string;
  authorName: string;
  content: string;
  workedAt: string;
  createdAt: string;
}

const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"];

function fmtDate(iso: string) {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function BoardLandingPage() {
  const router = useRouter();
  const [noticeItems, setNoticeItems] = useState<FeedItem[]>([]);
  const [wikiItems, setWikiItems] = useState<FeedItem[]>([]);
  const [workLogItems, setWorkLogItems] = useState<WorkLogFeedItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("erp_user");
    if (!token) {
      router.push("/login");
      return;
    }
    let cancelled = false;
    Promise.all([
      postApi.feed({ categoryCode: "notice", limit: 5 }).catch(() => ({ items: [] })),
      postApi.feed({ categoryCode: "wiki", limit: 5 }).catch(() => ({ items: [] })),
      workLogApi.feed({ limit: 10 }).catch(() => []),
    ])
      .then(([notice, wiki, workLogs]: any) => {
        if (cancelled) return;
        setNoticeItems((notice.items ?? []) as FeedItem[]);
        setWikiItems((wiki.items ?? []) as FeedItem[]);
        setWorkLogItems((workLogs ?? []) as WorkLogFeedItem[]);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto px-6 py-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">📋 게시판</h2>

        <div className="mb-5">
          <SearchBar />
        </div>

        <div className="flex gap-6">
          <UnifiedBoardSidebar />

          <div className="flex-1 min-w-0">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
              </div>
            ) : (
              <div className="space-y-5">
                <FeedSection
                  title="📢 공지사항"
                  items={noticeItems}
                  catCode="notice"
                  emptyText="등록된 공지가 없습니다."
                />
                <FeedSection
                  title="📚 게시판"
                  items={wikiItems}
                  catCode="wiki"
                  emptyText="등록된 자료가 없습니다."
                />
                <ProjectBoardSection items={workLogItems} />
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

function FeedSection({
  title,
  items,
  catCode,
  emptyText,
}: {
  title: string;
  items: FeedItem[];
  catCode: string;
  emptyText: string;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
        <Link
          href={`/board/${catCode}`}
          className="text-xs text-blue-600 hover:text-blue-700 hover:underline"
        >
          전체 →
        </Link>
      </div>
      {items.length === 0 ? (
        <div className="py-8 text-center text-sm text-gray-400">{emptyText}</div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {items.map((p) => (
            <li key={p.id}>
              <Link
                href={`/board/${catCode}/${p.boardCode}/${p.id}`}
                className="flex items-center gap-3 px-4 py-2 hover:bg-gray-50 text-sm"
              >
                <span className="text-xs text-gray-500 w-20 shrink-0 truncate">{p.boardName}</span>
                <span className="text-xs text-gray-600 w-16 shrink-0 truncate">{p.authorName}</span>
                <span className="text-xs text-gray-400 w-12 shrink-0">{fmtDate(p.publishedAt)}</span>
                {p.isPinned && <span className="text-blue-600 shrink-0 text-xs">📌</span>}
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
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function summarize(content: string, maxLen: number) {
  const text = content
    .replace(/```[\s\S]*?```/g, "")
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/[#>*_`~-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
}

function ProjectBoardSection({ items }: { items: WorkLogFeedItem[] }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800">📝 프로젝트 게시판</h3>
        <Link
          href="/work-logs"
          className="text-xs text-blue-600 hover:text-blue-700 hover:underline"
        >
          전체 →
        </Link>
      </div>
      {items.length === 0 ? (
        <div className="py-8 text-center text-sm text-gray-400">등록된 비고가 없습니다.</div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {items.map((w) => (
            <li key={w.id}>
              <div className="flex items-center gap-3 px-4 py-2 hover:bg-gray-50 text-sm">
                {/* 프로젝트명 → 해당 프로젝트, 태스크명 → 해당 태스크(drawer 자동 오픈) */}
                <Link
                  href={`/projects/${w.projectId}`}
                  className="text-xs text-gray-500 hover:text-blue-600 hover:underline w-28 shrink-0 truncate"
                  title={w.projectName}
                >
                  {w.projectName}
                </Link>
                <Link
                  href={`/projects/${w.projectId}?taskId=${w.taskId}`}
                  className="text-xs text-gray-700 hover:text-blue-600 hover:underline w-20 shrink-0 truncate"
                  title={w.taskName}
                >
                  {w.taskName}
                </Link>
                <span className="text-xs text-gray-600 w-16 shrink-0 truncate">{w.authorName}</span>
                <span className="text-xs text-gray-400 w-12 shrink-0">{w.workedAt.slice(5)}</span>
                <Link
                  href={`/work-logs/${w.projectId}`}
                  className="flex-1 truncate text-gray-700 hover:text-gray-900"
                >
                  {summarize(w.content, 100)}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
