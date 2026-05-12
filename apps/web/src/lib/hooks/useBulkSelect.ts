"use client";

import { useState, useRef } from "react";

/**
 * 테이블 일괄 선택 — 단일 토글 + Shift+클릭 range 선택 + 전체 선택.
 *
 * 사용법:
 *   const sel = useBulkSelect(sortedItems, (item) => item.id);
 *   sel.selected (Set<string>)
 *   sel.isSelected(id), sel.toggle(id)
 *   <input type="checkbox" checked={sel.isSelected(id)}
 *     onMouseDown={sel.handleMouseDown}
 *     onChange={() => sel.handleChange(id)} />
 *
 * 헤더(전체 선택):
 *   <input type="checkbox" ref={sel.headerRef}
 *     checked={sel.isAllSelected()} onChange={sel.toggleAll} />
 */
export function useBulkSelect<T>(items: T[], idOf: (item: T) => string) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);
  const shiftRef = useRef(false);

  const isSelected = (id: string) => selected.has(id);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setLastClickedId(id);
  };

  const clear = () => setSelected(new Set());

  const handleMouseDown = (e: React.MouseEvent) => {
    shiftRef.current = e.shiftKey;
  };

  const handleChange = (id: string) => {
    const wasShift = shiftRef.current;
    shiftRef.current = false;

    if (wasShift && lastClickedId && lastClickedId !== id) {
      const list = items.map(idOf);
      const anchorIdx = list.indexOf(lastClickedId);
      const currentIdx = list.indexOf(id);
      if (anchorIdx !== -1 && currentIdx !== -1) {
        const [from, to] = anchorIdx < currentIdx ? [anchorIdx, currentIdx] : [currentIdx, anchorIdx];
        const rangeIds = list.slice(from, to + 1);
        const targetState = selected.has(lastClickedId);
        setSelected((prev) => {
          const next = new Set(prev);
          for (const rid of rangeIds) {
            if (targetState) next.add(rid);
            else next.delete(rid);
          }
          return next;
        });
        return;
      }
    }
    toggle(id);
  };

  const isAllSelected = () => items.length > 0 && selected.size === items.length;
  const isPartiallySelected = () => selected.size > 0 && selected.size < items.length;

  const toggleAll = () => {
    if (isAllSelected()) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map(idOf)));
    }
  };

  // 헤더 체크박스 indeterminate 자동 적용
  const headerRef = (el: HTMLInputElement | null) => {
    if (el) el.indeterminate = isPartiallySelected();
  };

  return {
    selected,
    isSelected,
    toggle,
    clear,
    handleMouseDown,
    handleChange,
    isAllSelected,
    isPartiallySelected,
    toggleAll,
    headerRef,
    count: selected.size,
    ids: [...selected],
  };
}
