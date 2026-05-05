"use client";

import { forwardRef, type InputHTMLAttributes } from "react";

/**
 * TimeInput — 시간 입력 공통 컴포넌트
 *
 * 모든 시간 입력 필드는 이 컴포넌트를 사용해야 합니다.
 *
 * **이유**:
 * - 표시 형식 통일 (HH:mm, OS/브라우저 locale 영향 최소화 시도)
 * - 1분 단위 step default
 * - 스타일·접근성 통일
 *
 * **24h 표시 강제 시도**:
 * `lang="en-GB"`로 영국 영어 locale 힌트 (Chrome은 일부 무시 가능).
 * 완전 24h 강제는 native input 한계 — 필요 시 select 기반 커스텀 별도 검토.
 *
 * **사용법**:
 * ```tsx
 * import { TimeInput } from "@/components/ui/TimeInput";
 *
 * <TimeInput
 *   value={form.startTime}
 *   onChange={(e) => setForm({...form, startTime: e.target.value})}
 *   className="w-full ..."
 * />
 * ```
 *
 * **AttendanceView의 ClockTimeInput**: 출퇴근 시간 입력 H/M 분리 키보드 UX
 * (별도 — 일반 시간 입력은 이 TimeInput).
 */
export type TimeInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

export const TimeInput = forwardRef<HTMLInputElement, TimeInputProps>(
  ({ step = 60, lang = "en-GB", ...rest }, ref) => (
    <input ref={ref} type="time" step={step} lang={lang} {...rest} />
  ),
);

TimeInput.displayName = "TimeInput";
