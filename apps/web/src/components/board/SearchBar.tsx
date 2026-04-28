"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";

interface Props {
  initialQuery?: string;
  placeholder?: string;
  size?: "default" | "compact";
}

const PLACEHOLDER_DEFAULT = "예: 디버깅 메모리, 영업팀 회식, 4월 안전점검";

export default function SearchBar({ initialQuery = "", placeholder, size = "default" }: Props) {
  const router = useRouter();
  const [q, setQ] = useState(initialQuery);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = q.trim();
    if (trimmed.length < 2) return;
    router.push(`/board/search?q=${encodeURIComponent(trimmed)}`);
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 w-full">
      <div className="flex-1 relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder ?? PLACEHOLDER_DEFAULT}
          className={`w-full border border-gray-300 rounded-lg ${
            size === "compact" ? "py-1.5 text-sm" : "py-2.5 text-base"
          } pl-9 pr-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent`}
        />
      </div>
      <button
        type="submit"
        disabled={q.trim().length < 2}
        className={`bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed ${
          size === "compact" ? "px-4 py-1.5 text-sm" : "px-5 py-2.5 text-base"
        }`}
      >
        검색
      </button>
    </form>
  );
}
