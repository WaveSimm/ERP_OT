"use client";

import { useRef, useState, useEffect } from "react";

interface DateInputProps {
  value: string; // "" or "YYYY-MM-DD"
  onChange: (value: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
  className?: string;
}

export default function DateInput({ value, onChange, onBlur, disabled, className }: DateInputProps) {
  const monthRef = useRef<HTMLInputElement>(null);
  const dayRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 편집 중 여부 추적 — true이면 외부 value 변경으로 내부 state를 덮어쓰지 않음
  const isFocusedRef = useRef(false);

  const [year, setYear]   = useState(value ? value.slice(0, 4) : "");
  const [month, setMonth] = useState(value ? value.slice(5, 7) : "");
  const [day, setDay]     = useState(value ? value.slice(8, 10) : "");

  // 외부 value 변경 동기화 (초기화 버튼 등) — 편집 중에는 무시
  useEffect(() => {
    if (isFocusedRef.current) return;
    setYear(value ? value.slice(0, 4) : "");
    setMonth(value ? value.slice(5, 7) : "");
    setDay(value ? value.slice(8, 10) : "");
  }, [value]);

  const emit = (y: string, m: string, d: string) => {
    if (y.length === 4 && m.length >= 1 && d.length >= 1) {
      onChange(`${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`);
    }
  };

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    isFocusedRef.current = true;
    e.target.select();
  };

  // 포커스가 컴포넌트 밖으로 나갈 때만 onBlur 호출
  const handleContainerBlur = (e: React.FocusEvent) => {
    if (!containerRef.current?.contains(e.relatedTarget as Node)) {
      isFocusedRef.current = false;
      onBlur?.();
    }
  };

  return (
    <div
      ref={containerRef}
      className={`inline-flex items-center border border-gray-200 rounded px-1.5 py-0.5 bg-white focus-within:ring-1 focus-within:ring-blue-500 focus-within:border-blue-500 ${className ?? ""}`}
    >
      <input
        type="text"
        inputMode="numeric"
        maxLength={4}
        placeholder="YYYY"
        value={year}
        disabled={disabled}
        onFocus={handleFocus}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, "").slice(0, 4);
          setYear(v);
          if (v.length === 4) {
            emit(v, month, day);
            monthRef.current?.focus();
          }
        }}
        onBlur={handleContainerBlur}
        className="w-10 text-center outline-none bg-transparent text-xs disabled:opacity-50"
      />
      <span className="text-gray-300 text-xs mx-px select-none">-</span>
      <input
        ref={monthRef}
        type="text"
        inputMode="numeric"
        maxLength={2}
        placeholder="MM"
        value={month}
        disabled={disabled}
        onFocus={handleFocus}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, "").slice(0, 2);
          setMonth(v);
          if (v.length === 2) {
            emit(year, v, day);
            dayRef.current?.focus();
          }
        }}
        onBlur={handleContainerBlur}
        className="w-6 text-center outline-none bg-transparent text-xs disabled:opacity-50"
      />
      <span className="text-gray-300 text-xs mx-px select-none">-</span>
      <input
        ref={dayRef}
        type="text"
        inputMode="numeric"
        maxLength={2}
        placeholder="DD"
        value={day}
        disabled={disabled}
        onFocus={handleFocus}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, "").slice(0, 2);
          setDay(v);
          emit(year, month, v);
        }}
        onBlur={handleContainerBlur}
        className="w-6 text-center outline-none bg-transparent text-xs disabled:opacity-50"
      />
    </div>
  );
}
