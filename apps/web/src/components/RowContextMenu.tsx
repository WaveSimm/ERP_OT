"use client";

// ERP 공용 행 컨텍스트 메뉴 헬퍼 (선언형 API)
// 사용 예:
//   <RowContextMenu items={[
//     { label: "복사", icon: "📋", onClick: () => copyTask(task) },
//     { label: "편집", icon: "✏️", onClick: () => editTask(task) },
//     { separator: true },
//     { label: "삭제", icon: "🗑", onClick: () => deleteTask(task), destructive: true, visible: isManager },
//   ]}>
//     <tr>...</tr>
//   </RowContextMenu>

import { ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "./ui/ContextMenu";

export interface MenuAction {
  /** 메뉴 표시 텍스트. separator일 때는 무시 */
  label?: string;
  /** 좌측 아이콘 (이모지 또는 컴포넌트) */
  icon?: ReactNode;
  /** 클릭 시 실행 — 메뉴는 자동 닫힘 */
  onClick?: () => void;
  /** 빨간색 강조 (삭제·취소 등) */
  destructive?: boolean;
  /** false일 때 메뉴에서 숨김 (권한별 노출 제어) */
  visible?: boolean;
  /** true면 disabled 표시 */
  disabled?: boolean;
  /** 우측 단축키 표시 (예: "Ctrl+C") */
  shortcut?: string;
  /** true면 항목 대신 구분선 렌더링 */
  separator?: boolean;
}

export interface RowContextMenuProps {
  /** trigger가 되는 자식 — `<tr>` `<div>` 등. asChild로 래핑됨 */
  children: ReactNode;
  /** 메뉴 항목 (visible !== false 인 것만 표시) */
  items: MenuAction[];
  /** 메뉴 항목이 모두 비어있을 때 default browser context menu 허용 */
  fallbackToBrowser?: boolean;
}

export function RowContextMenu({ children, items, fallbackToBrowser = false }: RowContextMenuProps) {
  const visibleItems = items.filter((i) => i.visible !== false);

  // 표시할 항목이 없으면 trigger 없이 자식만 렌더 (브라우저 기본 메뉴 동작)
  if (fallbackToBrowser && visibleItems.length === 0) {
    return <>{children}</>;
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        {visibleItems.map((item, idx) =>
          item.separator ? (
            <ContextMenuSeparator key={`sep-${idx}`} />
          ) : (
            <ContextMenuItem
              key={`${item.label}-${idx}`}
              destructive={item.destructive}
              disabled={item.disabled}
              onSelect={(e) => {
                e.preventDefault();
                item.onClick?.();
              }}
            >
              {item.icon && <span className="shrink-0">{item.icon}</span>}
              <span className="flex-1">{item.label}</span>
              {item.shortcut && (
                <span className="ml-auto text-xs tracking-widest text-gray-400">
                  {item.shortcut}
                </span>
              )}
            </ContextMenuItem>
          ),
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
