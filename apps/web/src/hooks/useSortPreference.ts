"use client";

import { useState, useCallback, useEffect } from "react";

export type SortOrder = "asc" | "desc";

/**
 * 사용자 정렬 선택을 localStorage에 기억한다.
 *
 * - 같은 PC·브라우저에서만 유지됨 (다른 기기는 reset)
 * - SSR 시점에는 기본값으로 시작, hydration 후 localStorage 로드
 * - 페이지별 다른 storageKey 사용 (예: "inventory", "customers")
 *
 * @param storageKey 페이지 식별자 (localStorage prefix). 예: "inventory"
 * @param defaultSortBy 기본 정렬 컬럼 (빈 문자열 = 서버 기본값 사용)
 * @param defaultOrder 기본 정렬 방향
 *
 * 사용:
 *   const { sortBy, sortOrder, handleSort } = useSortPreference("inventory");
 *
 *   <SortableHeader sortKey="name" currentSort={sortBy} order={sortOrder} onSort={handleSort}>이름</SortableHeader>
 */
export function useSortPreference(
  storageKey: string,
  defaultSortBy: string = "",
  defaultOrder: SortOrder = "asc",
) {
  const [sortBy, setSortBy] = useState<string>(defaultSortBy);
  const [sortOrder, setSortOrder] = useState<SortOrder>(defaultOrder);

  // hydration 후 localStorage에서 복원
  useEffect(() => {
    try {
      const savedBy = localStorage.getItem(`sort-${storageKey}-sortBy`);
      const savedOrder = localStorage.getItem(`sort-${storageKey}-sortOrder`);
      if (savedBy !== null) setSortBy(savedBy);
      if (savedOrder === "asc" || savedOrder === "desc") setSortOrder(savedOrder);
    } catch {
      // localStorage 접근 실패 시 무시 (private 모드 등)
    }
  }, [storageKey]);

  const handleSort = useCallback(
    (k: string, o: SortOrder) => {
      setSortBy(k);
      setSortOrder(o);
      try {
        localStorage.setItem(`sort-${storageKey}-sortBy`, k);
        localStorage.setItem(`sort-${storageKey}-sortOrder`, o);
      } catch {
        // ignore
      }
    },
    [storageKey],
  );

  const resetSort = useCallback(() => {
    setSortBy(defaultSortBy);
    setSortOrder(defaultOrder);
    try {
      localStorage.removeItem(`sort-${storageKey}-sortBy`);
      localStorage.removeItem(`sort-${storageKey}-sortOrder`);
    } catch {
      // ignore
    }
  }, [storageKey, defaultSortBy, defaultOrder]);

  return { sortBy, sortOrder, handleSort, resetSort };
}
