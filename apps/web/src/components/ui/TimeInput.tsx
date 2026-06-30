"use client";

import { forwardRef, type ChangeEvent, type InputHTMLAttributes } from "react";

/**
 * TimeInput — 시간 입력 공통 컴포넌트 (24h 커스텀)
 *
 * 모든 일반 시간 입력 필드는 이 컴포넌트를 사용해야 합니다.
 *
 * **구조**:
 * native `<input type="time">` 대신 **시 `<select>`(00~23) + 분 `<select>`** 를
 * 가로(flex)로 배치한 커스텀 컴포넌트. 오전/오후(AM/PM) 표기가 절대 없으며,
 * 브라우저/OS locale 과 무관하게 항상 24시간제로 표시됩니다.
 *
 * **드롭인 호환**:
 * 기존 `<input type="time">` 호출부를 수정 없이 그대로 사용할 수 있도록
 * - `value`는 "HH:MM" 문자열 (빈 값이면 두 select 모두 "--" placeholder)
 * - `onChange`는 synthetic 이벤트 `{ target: { value: "HH:MM" } }` 형태로 호출
 *   (호출부의 `(e) => setX(e.target.value)` 패턴 그대로 동작)
 * - `step`(초)으로 분 옵션 간격 제어: 분옵션 간격 = step/60 분
 *   - step=60(기본) → 1분 단위(00~59)
 *   - step=900 → 00,15,30,45
 *   - step=1800 → 00,30
 *   시(hour) 옵션은 항상 00~23.
 * - `className`은 **wrapper div**에 적용 (기존 단일 input 레이아웃 호환).
 *   두 select는 wrapper 안에서 투명 배경으로 배치됩니다.
 * - `forwardRef`는 첫 번째 select(시)로 전달됩니다.
 *
 * **사용법**:
 * ```tsx
 * import { TimeInput } from "@/components/ui/TimeInput";
 *
 * <TimeInput
 *   value={form.startTime}
 *   onChange={(e) => setForm({ ...form, startTime: e.target.value })}
 *   className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
 * />
 * ```
 *
 * **AttendanceView의 ClockTimeInput**: 출퇴근 시간 입력 H/M 분리 키보드 UX
 * (별도 — 이미 24h. 일반 시간 입력은 이 TimeInput).
 */
export type TimeInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export const TimeInput = forwardRef<HTMLSelectElement, TimeInputProps>(
  ({ value, onChange, className, step = 60, disabled, required, id, name }, ref) => {
    const strVal = typeof value === "string" ? value : "";
    const hasTime = strVal.includes(":");
    const curH = hasTime ? strVal.split(":")[0]! : "";
    const curM = hasTime ? strVal.split(":")[1]! : "";

    // 분 옵션: step(초)/60 분 간격. 현재 값이 옵션에 없으면 보존용으로 추가.
    const minuteStep = Math.max(1, Math.floor(Number(step) / 60));
    const minuteSet = new Set<string>();
    for (let mm = 0; mm < 60; mm += minuteStep) minuteSet.add(pad2(mm));
    if (curM) minuteSet.add(curM);
    const minuteOptions = [...minuteSet].sort();

    const emit = (h: string, m: string) => {
      if (!onChange) return;
      const next = h !== "" && m !== "" ? `${h}:${m}` : "";
      onChange({ target: { value: next } } as ChangeEvent<HTMLInputElement>);
    };

    const handleHour = (e: ChangeEvent<HTMLSelectElement>) => {
      const h = e.target.value;
      // 시만 선택했는데 분이 비어있으면 분을 첫 옵션(보통 00)으로 보정
      const m = curM !== "" ? curM : h !== "" ? (minuteOptions[0] ?? "00") : "";
      emit(h, m);
    };
    const handleMinute = (e: ChangeEvent<HTMLSelectElement>) => {
      const m = e.target.value;
      const h = curH !== "" ? curH : m !== "" ? "00" : "";
      emit(h, m);
    };

    const selectCls =
      "flex-1 min-w-0 bg-transparent text-sm outline-none cursor-pointer disabled:cursor-not-allowed disabled:text-gray-400";

    return (
      <div className={["flex items-center gap-1", className].filter(Boolean).join(" ")}>
        <select
          ref={ref}
          value={curH}
          onChange={handleHour}
          disabled={disabled}
          required={required}
          id={id}
          name={name}
          aria-label="시"
          className={selectCls}
        >
          <option value="">--</option>
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={pad2(h)}>
              {pad2(h)}
            </option>
          ))}
        </select>
        <span className="text-gray-400 select-none">:</span>
        <select
          value={curM}
          onChange={handleMinute}
          disabled={disabled}
          required={required}
          aria-label="분"
          className={selectCls}
        >
          <option value="">--</option>
          {minuteOptions.map((mm) => (
            <option key={mm} value={mm}>
              {mm}
            </option>
          ))}
        </select>
      </div>
    );
  },
);

TimeInput.displayName = "TimeInput";
