"use client";

import { useState, useMemo } from "react";

export type SortDir = "asc" | "desc";

export interface UseTableSortOptions<T, K extends string> {
  initialKey: K;
  initialDir?: SortDir;
  /** 키별 비교 가능한 값 추출자 — string | number | Date | null/undefined 반환 */
  keyExtractor: (item: T, key: K) => string | number | Date | null | undefined;
}

export function useTableSort<T, K extends string>(
  items: T[],
  options: UseTableSortOptions<T, K>,
) {
  const [sortKey, setSortKey] = useState<K>(options.initialKey);
  const [sortDir, setSortDir] = useState<SortDir>(options.initialDir ?? "desc");

  const handleSort = (key: K) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sortIndicator = (key: K) =>
    sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  const sortedItems = useMemo(() => {
    const arr = [...items];
    const dir = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      const av = options.keyExtractor(a, sortKey);
      const bv = options.keyExtractor(b, sortKey);
      // null/undefined → 항상 끝으로 (정렬 방향 무관)
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av instanceof Date && bv instanceof Date) {
        return (av.getTime() - bv.getTime()) * dir;
      }
      if (typeof av === "string" && typeof bv === "string") {
        return av.localeCompare(bv) * dir;
      }
      if (typeof av === "number" && typeof bv === "number") {
        return (av - bv) * dir;
      }
      // mixed types — string으로 비교
      return String(av).localeCompare(String(bv)) * dir;
    });
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, sortKey, sortDir]);

  return { sortKey, sortDir, sortedItems, handleSort, sortIndicator };
}
