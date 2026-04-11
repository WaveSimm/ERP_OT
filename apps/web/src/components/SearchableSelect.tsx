"use client";

import { useState, useRef, useEffect } from "react";

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
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setQuery(value); }, [value]);

  const doSearch = async (q: string) => {
    setLoading(true);
    try {
      const res = await loadOptions(q);
      setOptions(res);
    } catch { setOptions([]); }
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
    <div className="relative" ref={containerRef}>
      <input
        type="text"
        value={query}
        onChange={(e) => handleInputChange(e.target.value)}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder={placeholder}
        className={className || "w-full border rounded-lg px-3 py-2 text-sm"}
      />
      {open && (options.length > 0 || loading) && (
        <div className="absolute z-20 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {loading && <div className="px-3 py-2 text-xs text-gray-400">검색 중...</div>}
          {options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSelect(opt)}
              className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b last:border-b-0"
            >
              <span className="font-medium">{opt.name}</span>
              {opt.sub && <span className="text-xs text-gray-400 ml-2">{opt.sub}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
