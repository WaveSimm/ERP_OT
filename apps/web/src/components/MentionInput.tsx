"use client";

// 공용 @멘션 입력 — @ 입력 시 직원 드롭다운, 선택하면 "@이름" 삽입.
// 멘션된 userId는 본문 텍스트에서 직원 이름 매칭으로 도출한다(extractMentionIds).
// 댓글·작업일지·이슈 등 여러 입력창에서 재사용.

import { useEffect, useMemo, useRef, useState } from "react";
import { userManagementApi } from "@/lib/api";

export type MentionMember = { id: string; name: string };

// 직원 목록은 세션 내 1회만 로드해 공유(캐시)
let _cache: MentionMember[] | null = null;
let _promise: Promise<MentionMember[]> | null = null;
export async function loadMentionMembers(): Promise<MentionMember[]> {
  if (_cache) return _cache;
  if (!_promise) {
    _promise = userManagementApi
      .members(true)
      .then((m: MentionMember[]) => (_cache = m ?? []))
      .catch(() => [] as MentionMember[]);
  }
  return _promise;
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 본문에서 "@이름" 매칭으로 멘션된 userId 목록 추출 (긴 이름 우선)
export async function extractMentionIds(text: string): Promise<string[]> {
  const members = await loadMentionMembers();
  const ids = new Set<string>();
  for (const m of [...members].sort((a, b) => b.name.length - a.name.length)) {
    if (!m.name) continue;
    const re = new RegExp(`@${escapeRe(m.name)}(?![0-9A-Za-z가-힣])`);
    if (re.test(text)) ids.add(m.id);
  }
  return [...ids];
}

// "@이름" 하이라이트 렌더
export function MentionText({ text, className }: { text: string; className?: string }) {
  const [members, setMembers] = useState<MentionMember[]>([]);
  useEffect(() => {
    loadMentionMembers().then(setMembers);
  }, []);

  const names = useMemo(
    () => members.map((m) => m.name).filter(Boolean).sort((a, b) => b.length - a.length),
    [members],
  );
  if (names.length === 0) return <span className={className}>{text}</span>;

  const re = new RegExp(`@(?:${names.map(escapeRe).join("|")})(?![0-9A-Za-z가-힣])`, "g");
  const parts: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(
      <span key={key++} className="text-blue-600 dark:text-blue-400 font-medium">{m[0]}</span>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <span className={className}>{parts}</span>;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void; // Enter(무 shift) 제출
  placeholder?: string;
  className?: string; // textarea에 적용
  rows?: number;
  autoFocus?: boolean;
}

export default function MentionInput({ value, onChange, onSubmit, placeholder, className, rows = 1, autoFocus }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const anchorRef = useRef<number>(0); // '@' 위치
  const [members, setMembers] = useState<MentionMember[]>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  useEffect(() => {
    loadMentionMembers().then(setMembers);
  }, []);

  const suggestions = useMemo(() => {
    if (!open) return [];
    const q = query.toLowerCase();
    return members.filter((m) => m.name && m.name.toLowerCase().includes(q)).slice(0, 8);
  }, [open, query, members]);

  function detect(el: HTMLTextAreaElement) {
    const pos = el.selectionStart ?? 0;
    const before = el.value.slice(0, pos);
    const at = before.lastIndexOf("@");
    if (at === -1) return setOpen(false);
    const between = before.slice(at + 1);
    if (/\s/.test(between) || between.length > 20) return setOpen(false);
    const charBefore = at > 0 ? before[at - 1] : " ";
    if (/[0-9A-Za-z가-힣]/.test(charBefore)) return setOpen(false); // 이메일 등 무시
    anchorRef.current = at;
    setQuery(between);
    setActive(0);
    setOpen(true);
  }

  function pick(m: MentionMember) {
    const el = ref.current;
    if (!el) return;
    const pos = el.selectionStart ?? value.length;
    const at = anchorRef.current;
    const next = value.slice(0, at) + `@${m.name} ` + value.slice(pos);
    onChange(next);
    setOpen(false);
    requestAnimationFrame(() => {
      const caret = at + m.name.length + 2;
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }

  return (
    <div className="relative flex-1">
      <textarea
        ref={ref}
        value={value}
        rows={rows}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          detect(e.target);
        }}
        onKeyDown={(e) => {
          if (open && suggestions.length > 0) {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % suggestions.length); return; }
            if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + suggestions.length) % suggestions.length); return; }
            if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(suggestions[active]); return; }
            if (e.key === "Escape") { e.preventDefault(); setOpen(false); return; }
          }
          if (e.key === "Enter" && !e.shiftKey && onSubmit) { e.preventDefault(); onSubmit(); }
        }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        className={className}
      />
      {open && suggestions.length > 0 && (
        <ul className="absolute z-30 left-0 bottom-full mb-1 w-56 max-h-56 overflow-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg text-sm py-1">
          {suggestions.map((m, i) => (
            <li key={m.id}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); pick(m); }}
                className={`w-full text-left px-3 py-1.5 ${i === active ? "bg-blue-50 dark:bg-blue-900/40" : "hover:bg-gray-50 dark:hover:bg-gray-700"}`}
              >
                <span className="text-gray-800 dark:text-gray-200">{m.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
