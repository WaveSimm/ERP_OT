"use client";

import Link from "next/link";

const PRIORITY_LABELS: Record<number, { label: string; color: string }> = {
  0: { label: "", color: "" },
  1: { label: "중요", color: "bg-amber-100 text-amber-700" },
  2: { label: "긴급", color: "bg-red-100 text-red-700" },
};

// 게시판 design v2.0 (2026-05-22): 기능 요구 status 라벨
const FR_STATUS_LABEL: Record<string, { label: string; color: string }> = {
  SUBMITTED:    { label: "접수",    color: "bg-gray-100 text-gray-700" },
  UNDER_REVIEW: { label: "검토중",  color: "bg-blue-100 text-blue-700" },
  APPROVED:     { label: "승인",    color: "bg-emerald-100 text-emerald-700" },
  IN_PROGRESS:  { label: "진행중",  color: "bg-amber-100 text-amber-700" },
  COMPLETED:    { label: "완료",    color: "bg-green-200 text-green-800" },
  REJECTED:     { label: "반려",    color: "bg-red-100 text-red-700" },
  ON_HOLD:      { label: "보류",    color: "bg-stone-200 text-stone-700" },
};

export interface PostListItemData {
  id: string;
  title: string;
  summary: string;
  isPinned: boolean;
  priority: number;
  publishedAt: string;
  viewCount: number;
  commentCount: number;
  attachmentCount: number;
  isRead: boolean;
  author: { id: string; name: string };
  publishingDepartment: { id: string; name: string } | null;
  board: { code: string; name: string };
  // 기능 요구 카테고리 전용 (다른 카테고리는 null)
  requestStatus?: string | null;
  requestType?: string | null;
}

export default function PostListItem({ post, catCode }: { post: PostListItemData; catCode: string }) {
  const date = new Date(post.publishedAt);
  const dateStr = `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const pri = PRIORITY_LABELS[post.priority];

  return (
    <Link
      href={`/board/${catCode}/${post.board.code}/${post.id}`}
      className={`block px-4 py-3 hover:bg-gray-50 border-b border-gray-100 last:border-b-0 ${
        post.isPinned ? "bg-blue-50/40 dark:bg-blue-500/10" : ""
      }`}
    >
      <div className="flex items-start gap-2">
        {post.isPinned && <span className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">📌</span>}
        {pri.label && (
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${pri.color} mt-0.5`}>
            {pri.label}
          </span>
        )}
        {post.requestStatus && FR_STATUS_LABEL[post.requestStatus] && (
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${FR_STATUS_LABEL[post.requestStatus].color} mt-0.5`}>
            {FR_STATUS_LABEL[post.requestStatus].label}
          </span>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-sm ${post.isRead ? "text-gray-600" : "text-gray-900 font-semibold"} truncate`}>
              {post.title}
            </span>
            {post.commentCount > 0 && (
              <span className="text-xs text-blue-600 dark:text-blue-400 shrink-0">💬 {post.commentCount}</span>
            )}
            {post.attachmentCount > 0 && (
              <span className="text-xs text-gray-400 shrink-0">📎 {post.attachmentCount}</span>
            )}
            {!post.isRead && <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />}
          </div>
          {post.summary && (
            <p className="text-xs text-gray-400 truncate mt-0.5">{post.summary}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-0.5 shrink-0 text-xs text-gray-400 whitespace-nowrap">
          <div>
            <span className="font-medium text-gray-600">{post.author.name}</span>
            {post.publishingDepartment && (
              <span className="text-gray-400 ml-1">· {post.publishingDepartment.name}</span>
            )}
          </div>
          <div>
            {dateStr} · 👁 {post.viewCount}
          </div>
        </div>
      </div>
    </Link>
  );
}
