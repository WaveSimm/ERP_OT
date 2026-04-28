"use client";

import Link from "next/link";
import { type SearchResultItem } from "@/lib/api";

const TYPE_LABEL: Record<string, { icon: string; label: string; bg: string }> = {
  post: { icon: "📄", label: "게시글", bg: "bg-blue-50 text-blue-700" },
  worklog: { icon: "📝", label: "작업비고", bg: "bg-indigo-50 text-indigo-700" },
};

function formatDate(iso: string) {
  if (!iso) return "";
  // ISO8601 (post.publishedAt) 또는 YYYY-MM-DD (worklog.workedAt) 모두 처리
  if (iso.length === 10) return iso;
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function SearchResultCard({ item }: { item: SearchResultItem }) {
  const typeStyle = TYPE_LABEL[item.type] ?? TYPE_LABEL.post!;
  const scorePercent = Math.round(item.score * 100);

  return (
    <Link
      href={item.url}
      className="block bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md hover:border-blue-300 transition-all"
    >
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${typeStyle.bg}`}>
          {typeStyle.icon} {typeStyle.label}
        </span>
        {item.boardName && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
            {item.boardName}
          </span>
        )}
        {item.projectName && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-50 text-purple-700">
            {item.projectName}
          </span>
        )}
        {item.taskName && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
            {item.taskName}
          </span>
        )}
        <span className="ml-auto text-xs text-gray-400">유사도 {scorePercent}%</span>
      </div>

      <h3 className="text-base font-semibold text-gray-900 mb-1 line-clamp-1">
        {item.title || "(제목 없음)"}
      </h3>

      {item.snippet && (
        <p className="text-sm text-gray-600 line-clamp-2 mb-2">{item.snippet}</p>
      )}

      <div className="text-xs text-gray-400">
        {item.author} · {formatDate(item.publishedAt)}
      </div>
    </Link>
  );
}
