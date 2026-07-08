"use client";

import Link from "next/link";
import { ReactNode } from "react";

export default function HomeCard({
  icon,
  title,
  href,
  hrefLabel,
  badge,
  loading,
  empty,
  children,
}: {
  icon: string;
  title: string;
  href?: string;
  hrefLabel?: string;
  badge?: ReactNode;
  loading?: boolean;
  empty?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden flex flex-col">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base">{icon}</span>
          <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
          {badge}
        </div>
        {href && (
          <Link
            href={href}
            className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline"
          >
            {hrefLabel ?? "더보기"} →
          </Link>
        )}
      </div>
      <div className="px-4 py-3 flex-1 min-h-[140px]">
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <div className="animate-spin w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full" />
          </div>
        ) : empty ? (
          <div className="flex items-center justify-center py-6 text-sm text-gray-400">
            표시할 항목 없음
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
