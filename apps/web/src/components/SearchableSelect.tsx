"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  onSelect?: (option: { id: string; name: string; sub?: string } | null) => void;
  loadOptions: (search: string) => Promise<{ id: string; name: string; sub?: string }[]>;
  placeholder?: string;
  className?: string;
  allowCustom?: boolean; // true면 목록에 없는 값도 직접 입력 가능
}

export default function SearchableSelect({ value, onChange, onSelect, loadOptions, placeholder, className, allowCustom }: SearchableSelectProps) {
  const [query, setQuery] = useState(value);
  const [options, setOptions] = useState<{ id: string; name: string; sub?: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => { setQuery(value); }, [value]);

  // 드롭다운 위치 추적 (모달 안에서 overflow에 가려지지 않도록 fixed로 띄움)
  const updatePosition = () => {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
  };

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const handler = () => updatePosition();
    window.addEventListener("scroll", handler, true);
    window.addEventListener("resize", handler);
    return () => {
      window.removeEventListener("scroll", handler, true);
      window.removeEventListener("resize", handler);
    };
  }, [open]);

  const doSearch = async (q: string) => {
    setLoading(true);
    try {
      const res = await loadOptions(q);
      setOptions(Array.isArray(res) ? res : []);
    } catch (e) {
      console.error("[SearchableSelect] loadOptions failed:", e);
      setOptions([]);
    }
    finally { setLoading(false); }
  };

  const handleInputChange = (v: string) => {
    setQuery(v);
    setOpen(true);
    if (allowCustom) onChange(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(v), 200);
  };

  const handleSelect = (opt: { id: string; name: string; sub?: string }) => {
    setQuery(opt.name);
    onChange(opt.name);
    onSelect?.(opt);
    setOpen(false);
  };

  const handleFocus = () => {
    setOpen(true);
    doSearch(query);
  };

  const handleBlur = () => {
    setTimeout(() => setOpen(false), 200);
  };

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => handleInputChange(e.target.value)}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder={placeholder}
        className={className || "w-full border rounded-lg px-3 py-2 text-sm"}
      />
      {open && mounted && pos && createPortal(
        <div
          className="bg-white border rounded-lg shadow-lg max-h-60 overflow-y-auto overflow-x-hidden"
          style={{
            position: "fixed",
            top: pos.top,
            left: pos.left,
            minWidth: pos.width,
            maxWidth: Math.max(pos.width, 560),
            zIndex: 9999,
          }}
        >
          {loading && <div className="px-3 py-2 text-xs text-gray-400">검색 중...</div>}
          {!loading && options.length === 0 && (
            <div className="px-3 py-2 text-xs text-gray-400">결과 없음</div>
          )}
          {options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSelect(opt)}
              className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b last:border-b-0 whitespace-nowrap overflow-hidden text-ellipsis"
              title={opt.sub ? `${opt.name}  ${opt.sub}` : opt.name}
            >
              <span className="font-medium">{opt.name}</span>
              {opt.sub && <span className="text-xs text-gray-400 ml-2">{opt.sub}</span>}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
