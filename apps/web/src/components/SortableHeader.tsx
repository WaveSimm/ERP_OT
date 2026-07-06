"use client";

/**
 * SortableHeader — 테이블 헤더 정렬 토글 (v1.6, 2026-05-13)
 *
 * 부모에서 sortBy/sortOrder state 관리. 헤더 클릭 시 onSort 호출:
 *   - 같은 컬럼 다시 클릭 → asc ↔ desc 토글
 *   - 다른 컬럼 클릭 → 새 컬럼으로 변경 (기본 asc)
 *
 * 사용 예:
 *   <SortableHeader sortKey="name" currentSort={sortBy} order={sortOrder} onSort={handleSort}>
 *     품명
 *   </SortableHeader>
 */
export type SortOrder = "asc" | "desc";

interface SortableHeaderProps {
  sortKey: string;
  currentSort: string;     // 현재 정렬 컬럼
  order: SortOrder;        // 현재 정렬 방향
  onSort: (key: string, order: SortOrder) => void;
  className?: string;
  align?: "left" | "center" | "right";
  children: React.ReactNode;
}

export default function SortableHeader({
  sortKey,
  currentSort,
  order,
  onSort,
  className,
  align = "left",
  children,
}: SortableHeaderProps) {
  const isActive = currentSort === sortKey;
  const handleClick = () => {
    if (!isActive) {
      onSort(sortKey, "asc");
    } else {
      onSort(sortKey, order === "asc" ? "desc" : "asc");
    }
  };

  const alignClass = align === "center" ? "justify-center" : align === "right" ? "justify-end" : "justify-start";

  const indicator = isActive ? (order === "asc" ? "▲" : "▼") : "↕";

  return (
    <th className={className}>
      <button
        type="button"
        onClick={handleClick}
        title={isActive ? (order === "asc" ? "오름차순" : "내림차순") : "클릭하여 정렬"}
        className={`flex items-center gap-1 w-full whitespace-nowrap ${alignClass} hover:text-blue-600 transition-colors ${isActive ? "text-blue-600 dark:text-blue-400 font-semibold" : "text-inherit"}`}
      >
        <span className="truncate">{children}</span>
        <span className={`text-[10px] ${isActive ? "text-blue-600 dark:text-blue-400" : "text-gray-300"}`}>{indicator}</span>
      </button>
    </th>
  );
}
