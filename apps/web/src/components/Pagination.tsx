"use client";

import { useEffect, useState } from "react";

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  /** 옵션: "총 N건 (M 페이지)" 표시용 */
  total?: number;
  /** 좌측 라벨 커스터마이징 (default: "총 {total}건 ({totalPages} 페이지)") */
  leftLabel?: React.ReactNode;
  className?: string;
}

/**
 * 공통 페이지네이션
 * 형태: 1 ... ❮ [현재] ❯ ... totalPages
 *  - 양 끝 숫자(1, totalPages) 클릭 → 첫/끝 페이지 점프
 *  - 가운데 input 직접 입력 (Enter 또는 blur 시 이동)
 *  - 화살표 ❮ ❯ 로 이전/다음
 */
export default function Pagination({
  page,
  totalPages,
  onPageChange,
  total,
  leftLabel,
  className = "",
}: PaginationProps) {
  const [pageInput, setPageInput] = useState(String(page));

  useEffect(() => {
    setPageInput(String(page));
  }, [page]);

  if (totalPages <= 1) return null;

  const goToPage = (n: number) => {
    const clamped = Math.max(1, Math.min(totalPages, n));
    if (clamped !== page) onPageChange(clamped);
  };

  const submitPageInput = () => {
    const n = parseInt(pageInput, 10);
    if (!Number.isNaN(n)) goToPage(n);
    else setPageInput(String(page));
  };

  const left =
    leftLabel ??
    (total !== undefined
      ? `총 ${total}건 (${totalPages} 페이지)`
      : `${totalPages} 페이지`);

  return (
    <div
      className={`px-4 py-3 border-t border-gray-200 flex items-center justify-between text-xs text-gray-500 ${className}`}
    >
      <span>{left}</span>
      <div className="flex items-center gap-1">
        {/* 첫 페이지 */}
        {page > 1 && (
          <button
            onClick={() => goToPage(1)}
            className="px-2 py-1 rounded border border-gray-200 hover:bg-gray-50"
          >
            1
          </button>
        )}
        {page > 2 && <span className="px-1 text-gray-400">...</span>}

        {/* 이전 */}
        <button
          disabled={page === 1}
          onClick={() => goToPage(page - 1)}
          aria-label="이전 페이지"
          className="px-2 text-xl font-bold leading-none text-gray-600 disabled:opacity-30 hover:text-blue-600"
        >
          ❮
        </button>

        {/* 현재 페이지 (편집 가능) */}
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={pageInput}
          onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submitPageInput();
              (e.target as HTMLInputElement).blur();
            }
          }}
          onBlur={submitPageInput}
          className="w-10 text-center px-0.5 py-1 border border-blue-300 dark:border-blue-800 rounded text-blue-600 dark:text-blue-400 font-semibold focus:outline-none focus:ring-1 focus:ring-blue-500"
        />

        {/* 다음 */}
        <button
          disabled={page === totalPages}
          onClick={() => goToPage(page + 1)}
          aria-label="다음 페이지"
          className="px-2 text-xl font-bold leading-none text-gray-600 disabled:opacity-30 hover:text-blue-600"
        >
          ❯
        </button>

        {/* 마지막 페이지 */}
        {page < totalPages - 1 && <span className="px-1 text-gray-400">...</span>}
        {page < totalPages && (
          <button
            onClick={() => goToPage(totalPages)}
            className="px-2 py-1 rounded border border-gray-200 hover:bg-gray-50"
          >
            {totalPages}
          </button>
        )}
      </div>
    </div>
  );
}
