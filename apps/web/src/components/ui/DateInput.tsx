"use client";

import { forwardRef, type InputHTMLAttributes } from "react";

/**
 * DateInput — 날짜 입력 공통 컴포넌트
 *
 * 모든 날짜 입력 필드는 이 컴포넌트를 사용해야 합니다.
 *
 * **이유**:
 * - HTML5 `<input type="date">`는 max 속성이 없으면 Chrome에서 연도가 6자리까지
 *   입력될 수 있음 (사용자 혼란). min/max 강제로 4자리 yyyy 표준화.
 * - 스타일·검증·접근성 통일.
 *
 * **사용법**:
 * ```tsx
 * import { DateInput } from "@/components/ui/DateInput";
 *
 * <DateInput
 *   value={form.date}
 *   onChange={(e) => setForm({...form, date: e.target.value})}
 *   className="w-full ..."
 * />
 * ```
 *
 * **기본 범위**: 1900-01-01 ~ 2100-12-31 (대부분 비즈니스 시나리오 충분)
 *
 * **범위 좁히기**:
 * ```tsx
 * // 미래만 허용
 * <DateInput min={new Date().toISOString().slice(0,10)} ... />
 *
 * // 특정 범위
 * <DateInput min="2024-01-01" max="2026-12-31" ... />
 * ```
 */
export type DateInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

export const DateInput = forwardRef<HTMLInputElement, DateInputProps>(
  ({ min = "1900-01-01", max = "2100-12-31", ...rest }, ref) => (
    <input ref={ref} type="date" min={min} max={max} {...rest} />
  ),
);

DateInput.displayName = "DateInput";
