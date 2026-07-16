"use client";

/**
 * 통일 표(Table) 디자인 시스템
 * ------------------------------------------------------------------
 * 각 페이지가 raw <table> + 인라인 Tailwind 로 표를 그리던 것을
 * 하나의 시각 규칙으로 통일하기 위한 공용 컴포넌트 모음.
 *
 * 계층(디자인 토큰):
 *   - 표제목 (TableTitle)  : 표 위 캡션 + 우측 액션/건수 슬롯
 *   - 중제목 (THead/Th)    : 컬럼 헤더 (sticky, 회색 배경)
 *   - 표내용 (TBody/Tr/Td) : 본문 셀 (hover, divide 라인)
 *   - 상태   (StatusBadge) : 셀 안 상태 뱃지 (색상 팔레트 고정)
 *
 * 사용 예:
 *   <TableCard title="발주 목록" count={total} actions={<button.../>}>
 *     <Table>
 *       <THead>
 *         <Th>번호</Th>
 *         <Th align="right">금액</Th>
 *         <Th align="center">상태</Th>
 *       </THead>
 *       <TBody>
 *         {rows.map(r => (
 *           <Tr key={r.id} onClick={...}>
 *             <Td>{r.no}</Td>
 *             <Td align="right" mono>{r.amount}</Td>
 *             <Td align="center"><StatusBadge color="green">승인</StatusBadge></Td>
 *           </Tr>
 *         ))}
 *       </TBody>
 *     </Table>
 *   </TableCard>
 *
 * 마이그레이션 팁: 기존 raw <table> 을 그대로 <Table> 로 바꾸고
 * <thead>→<THead>, <th>→<Th>, <tbody>→<TBody>, <tr>→<Tr>, <td>→<Td> 로
 * 치환하면 시각 통일이 끝납니다. (className 은 필요 시 override 가능)
 */

import type { ReactNode, Ref, HTMLAttributes, ButtonHTMLAttributes, ThHTMLAttributes, TdHTMLAttributes } from "react";

/* 내부 유틸: 조건부 className 결합 */
function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

const ALIGN: Record<"left" | "center" | "right", string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

/* ── 표제목 + 컨테이너 ───────────────────────────────────────── */

interface TableCardProps {
  /** 표제목 (표 위 캡션). 생략 시 캡션 줄 자체를 렌더하지 않음 */
  title?: ReactNode;
  /** 제목 옆 부가 설명 */
  subtitle?: ReactNode;
  /** 건수 표시 (예: 128 → "128건") */
  count?: number;
  /** 제목 줄 우측 액션 슬롯 (검색창, 등록 버튼 등) */
  actions?: ReactNode;
  /** 표 세로 스크롤 최대 높이 (useFillHeight 의 maxHeight 등) */
  maxHeight?: number | string;
  /** 스크롤 영역 ref (useFillHeight 의 ref 등 — 이 요소 top 기준으로 높이 계산) */
  scrollRef?: Ref<HTMLDivElement>;
  /** 스크롤 영역 아래 고정 푸터 (페이지네이션 등 — 스크롤과 무관하게 항상 보임) */
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}

/**
 * 표 컨테이너 + 표제목 줄.
 * 흰 배경 · 라운드 · 테두리 · 세로 스크롤을 통일 제공.
 */
export function TableCard({
  title,
  subtitle,
  count,
  actions,
  maxHeight,
  scrollRef,
  footer,
  className,
  children,
}: TableCardProps) {
  return (
    <div
      className={cx(
        "flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white",
        "dark:border-gray-700 dark:bg-gray-900",
        className,
      )}
    >
      {(title || actions) && (
        // min-h-14(56px) 고정 + items-center → 제목만 있든 버튼이 있든 표제목 바 높이가 동일
        <div className="flex min-h-14 flex-wrap items-center gap-3 border-b border-gray-200 px-4 py-2 dark:border-gray-700">
          {title && (
            <div className="flex items-baseline gap-2">
              {/* 표제목 */}
              <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">{title}</h3>
              {subtitle && (
                <span className="text-xs text-gray-400">{subtitle}</span>
              )}
              {typeof count === "number" && (
                <span className="text-xs font-medium text-gray-400">{count.toLocaleString()}건</span>
              )}
            </div>
          )}
          {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div ref={scrollRef} className="overflow-auto" style={maxHeight != null ? { maxHeight } : undefined}>
        {children}
      </div>
      {footer}
    </div>
  );
}

/* ── 표 본체 ─────────────────────────────────────────────────── */

interface TableProps extends HTMLAttributes<HTMLTableElement> {
  /** 컬럼 폭 고정 (table-fixed). colgroup 과 함께 사용 */
  fixed?: boolean;
  /** 세로 구분선(컬럼 사이 경계선) 표시 */
  columnDividers?: boolean;
}

export function Table({ fixed, columnDividers, className, children, ...rest }: TableProps) {
  return (
    <table
      className={cx(
        "w-full border-collapse text-sm",
        fixed && "table-fixed",
        // 각 셀 오른쪽에 경계선(마지막 열 제외). 세로선은 행 높이에 영향을 주지 않음.
        // 다크모드: 본문 배경(gray-900) 위에서 gray-800 선은 거의 안 보이므로 gray-700 로 밝혀 통일.
        columnDividers &&
          "[&_td:not(:last-child)]:border-r [&_th:not(:last-child)]:border-r [&_td]:border-gray-100 [&_th]:border-gray-200 dark:[&_td]:border-gray-700 dark:[&_th]:border-gray-700",
        className,
      )}
      {...rest}
    >
      {children}
    </table>
  );
}

/* ── 중제목 (컬럼 헤더) ──────────────────────────────────────── */

interface THeadProps extends HTMLAttributes<HTMLTableSectionElement> {
  /** sticky 헤더 (기본 true). 상단 고정 위치는 top 으로 조정 */
  sticky?: boolean;
  /** sticky 시 top 오프셋 (툴바 아래 고정 등) */
  top?: number | string;
}

export function THead({ sticky = true, top = 0, className, children, ...rest }: THeadProps) {
  return (
    <thead
      className={cx(
        "bg-gray-50 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300",
        sticky && "sticky z-10",
        className,
      )}
      style={sticky ? { top } : undefined}
      {...rest}
    >
      {/* 헤더 하단선: border-b 대신 inset box-shadow 로 그림.
          border-collapse 표에서 sticky 헤더의 border-b 는 본문과 함께 스크롤돼 사라지지만,
          box-shadow 는 sticky 요소 박스에 그려져 스크롤해도 헤더에 계속 붙어 있음. */}
      <tr className="[&>th]:shadow-[inset_0_-1px_0_#e5e7eb] dark:[&>th]:shadow-[inset_0_-1px_0_#374151]">
        {children}
      </tr>
    </thead>
  );
}

interface ThProps extends ThHTMLAttributes<HTMLTableCellElement> {
  align?: "left" | "center" | "right";
}

export function Th({ align = "left", className, children, ...rest }: ThProps) {
  return (
    <th
      className={cx("whitespace-nowrap px-4 py-3 font-medium", ALIGN[align], className)}
      {...rest}
    >
      {children}
    </th>
  );
}

/* ── 표내용 (본문) ───────────────────────────────────────────── */

export function TBody({ className, children, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody
      className={cx("divide-y divide-gray-100 dark:divide-gray-800", className)}
      {...rest}
    >
      {children}
    </tbody>
  );
}

interface TrProps extends HTMLAttributes<HTMLTableRowElement> {
  /** 클릭 가능한 행 (hover 강조 + 커서) */
  interactive?: boolean;
  /** 선택된 행 강조 */
  selected?: boolean;
}

export function Tr({ interactive, selected, className, children, onClick, ...rest }: TrProps) {
  const clickable = interactive ?? Boolean(onClick);
  return (
    <tr
      onClick={onClick}
      className={cx(
        "transition-colors",
        clickable && "cursor-pointer",
        selected
          ? "bg-blue-50 dark:bg-blue-500/10"
          : clickable && "hover:bg-gray-50 dark:hover:bg-gray-800/60",
        className,
      )}
      {...rest}
    >
      {children}
    </tr>
  );
}

interface TdProps extends TdHTMLAttributes<HTMLTableCellElement> {
  align?: "left" | "center" | "right";
  /** 숫자/코드용 등폭 정렬 (tabular-nums) */
  mono?: boolean;
  /** 강조 셀 (링크/주요 값) */
  strong?: boolean;
  /** 넘칠 때 … 처리 */
  truncate?: boolean;
  /** 값이 비면(null/undefined/"") 가운데 정렬 "-" 표시. 값이 있으면 원래 정렬 유지 (숫자 0은 값으로 취급) */
  dash?: boolean;
  /** 보조 열: 본문 글자를 연하게(gray-500). 메인 열 대비 위계 표현용 */
  muted?: boolean;
}

export function Td({
  align = "left",
  mono,
  strong,
  truncate,
  dash,
  muted,
  className,
  children,
  ...rest
}: TdProps) {
  // dash: 값이 비었으면 가운데 정렬 "-", 있으면 원래 정렬 + 값
  const isEmpty = dash && (children === null || children === undefined || children === "");
  const effAlign = isEmpty ? "center" : align;
  // 글자색: 빈값=연회색 / strong=진하고 굵게(주요 열) / muted=연하게 / 기본
  const textColor = isEmpty
    ? "text-gray-400"
    : strong
      ? "font-medium text-gray-900 dark:text-gray-100"
      : muted
        ? "text-gray-500 dark:text-gray-400"
        : "text-gray-700 dark:text-gray-300";
  return (
    <td
      className={cx(
        // 행 높이 고정: h-11(44px)은 td 에서 '최소 높이'로 동작 → 버튼(28px)이든
        // 텍스트(20px)든 모든 행이 정확히 44px 로 통일됨. align-middle 로 세로 가운데 정렬,
        // py-1.5 는 2줄 이상 넘칠 때만 여백 확보용.
        "h-11 px-4 py-1.5 align-middle",
        textColor,
        ALIGN[effAlign],
        mono && "tabular-nums",
        // 빈 "-" 셀은 truncate 불필요
        truncate && !isEmpty && "max-w-0 truncate",
        className,
      )}
      {...rest}
    >
      {isEmpty ? "-" : children}
    </td>
  );
}

/* ── 셀 안 액션 버튼 ─────────────────────────────────────────── */

/**
 * 셀 안 액션 버튼 묶음.
 * 버튼이 들어가도 행 높이가 커지지 않도록, 컴팩트 규격(h-7·text-xs)의 버튼을 배치.
 * 기본 가운데 정렬(가운데 헤더와 맞음). <RowButton> 과 함께 사용 권장.
 */
export function TableActions({
  align = "center",
  className,
  children,
}: {
  align?: "center" | "end" | "start";
  className?: string;
  children: ReactNode;
}) {
  const justify = align === "end" ? "justify-end" : align === "start" ? "justify-start" : "justify-center";
  return <div className={cx("flex items-center gap-1.5", justify, className)}>{children}</div>;
}

interface RowButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 위험 액션(삭제 등): hover 시 빨강 */
  danger?: boolean;
  /** 보기/펼치기 등 비변경 액션: hover 시 회색 (수정=파랑, 삭제=빨강과 구분) */
  neutral?: boolean;
  /** 평상시부터 색을 채워 강조(방식 A). 기본은 평상시 회색 → hover 시 색(방식 B) */
  solid?: boolean;
}

/** 표 행 안에서 쓰는 컴팩트 버튼 (고정 높이 h-7 — 행 높이를 밀어 올리지 않음) */
export function RowButton({ danger, neutral, solid, className, children, ...rest }: RowButtonProps) {
  // hover: 색 채움 + 흰 글자 — 액션 유형별 색: 수정=파랑 / 삭제=빨강 / 보기·펼치기=회색.
  // 다크모드 hover 는 ! (important) 필수: globals.css 의 `.dark .text-gray-600 { !important }`
  // 같은 중립색 remap 규칙이 !important 라, !important 없는 hover 는 무시됨 → ! 로 흰 글자 강제.
  const hoverFill = danger
    ? "hover:border-red-700 hover:bg-red-700 hover:text-white dark:hover:!border-red-600 dark:hover:!bg-red-600 dark:hover:!text-white"
    : neutral
      ? "hover:border-gray-600 hover:bg-gray-600 hover:text-white dark:hover:!border-gray-500 dark:hover:!bg-gray-500 dark:hover:!text-white"
      : "hover:border-blue-700 hover:bg-blue-700 hover:text-white dark:hover:!border-blue-600 dark:hover:!bg-blue-600 dark:hover:!text-white";
  // 평상시 색: 기본=회색(중립, 방식 B), solid=고유 색(수정 파랑 / 삭제 빨강, 방식 A)
  const resting = solid && danger
    ? "border-red-200 text-red-600 dark:border-red-500/50 dark:text-red-400"
    : solid && !neutral
      ? "border-blue-200 text-blue-600 dark:border-blue-500/50 dark:text-blue-400"
      : "border-gray-200 text-gray-600 dark:border-gray-600 dark:text-gray-300";
  return (
    <button
      className={cx(
        // transition-colors 대신 배경·글자만 전환(테두리 색 번짐 제거) → hover 색이 A처럼 깔끔하게 딱 떨어짐
        "inline-flex h-7 items-center rounded-md border px-2 text-xs font-medium leading-none transition-[background-color,color]",
        resting,
        hoverFill,
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ── 빈 상태 / 로딩 행 ───────────────────────────────────────── */

export function TableEmpty({ colSpan, children }: { colSpan: number; children?: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-gray-400">
        {children ?? "데이터가 없습니다."}
      </td>
    </tr>
  );
}

/* ── 상태 뱃지 ───────────────────────────────────────────────── */

export type BadgeColor =
  | "gray"
  | "blue"
  | "green"
  | "amber"
  | "red"
  | "purple"
  | "indigo"
  | "cyan";

const BADGE: Record<BadgeColor, string> = {
  gray: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200",
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300",
  green: "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
  red: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300",
  purple: "bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300",
  indigo: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300",
  cyan: "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300",
};

export function StatusBadge({
  color = "gray",
  children,
}: {
  color?: BadgeColor;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium",
        BADGE[color],
      )}
    >
      {children}
    </span>
  );
}
