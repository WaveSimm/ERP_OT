"use client";

import { useState, useEffect } from "react";
import { calendarApi } from "@/lib/api";
import { DateInput } from "@/components/ui/DateInput";

const TYPE_OPTIONS = [
  { value: "PUBLIC_HOLIDAY", label: "🔴 공휴일", defaultColor: "#ef4444" },
  { value: "COMPANY_HOLIDAY", label: "🟠 자체 휴일", defaultColor: "#fb923c" },
  { value: "EVENT", label: "🔵 회사 행사", defaultColor: "#3b82f6" },
  { value: "WORKDAY", label: "⚪ 특별 근무일", defaultColor: "#9ca3af" },
];

interface Props {
  entry?: any | null;          // 수정 시 entry 전달
  defaultDate?: string;         // 새 등록 시 기본 시작/종료일
  onClose: () => void;
  onSaved: () => void;
}

function toIsoDate(s?: string | null): string {
  if (!s) return "";
  const d = new Date(s);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export default function EntryModal({ entry, defaultDate, onClose, onSaved }: Props) {
  const [type, setType] = useState<string>(entry?.type ?? "COMPANY_HOLIDAY");
  const [title, setTitle] = useState<string>(entry?.title ?? "");
  const [description, setDescription] = useState<string>(entry?.description ?? "");
  const [startDate, setStartDate] = useState<string>(
    entry ? toIsoDate(entry.startDate) : defaultDate ?? "",
  );
  const [endDate, setEndDate] = useState<string>(
    entry ? toIsoDate(entry.endDate) : defaultDate ?? "",
  );
  const [color, setColor] = useState<string>(entry?.color ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // v1.2 — KASI 자동 갱신 항목은 직접 수정·삭제 불가 (백엔드 409 가드와 일치)
  const isKasiReadonly = entry?.source === "KASI";

  // 시작일 변경 시 종료일이 비어 있으면 동기화
  useEffect(() => {
    if (!entry && startDate && !endDate) {
      setEndDate(startDate);
    }
  }, [startDate, endDate, entry]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!title.trim()) {
      setError("제목을 입력해주세요.");
      return;
    }
    if (!startDate || !endDate) {
      setError("날짜를 입력해주세요.");
      return;
    }
    if (endDate < startDate) {
      setError("종료일은 시작일보다 빠를 수 없습니다.");
      return;
    }
    setSaving(true);
    try {
      const payload: any = {
        type,
        title: title.trim(),
        description: description.trim() || null,
        startDate,
        endDate,
        color: color || null,
      };
      if (entry) {
        await calendarApi.update(entry.id, payload);
      } else {
        await calendarApi.create(payload);
      }
      onSaved();
    } catch (err: any) {
      setError(err?.message ?? "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!entry) return;
    if (!confirm(`"${entry.title}" 항목을 삭제하시겠습니까?`)) return;
    setSaving(true);
    try {
      await calendarApi.remove(entry.id);
      onSaved();
    } catch (err: any) {
      setError(err?.message ?? "삭제 실패");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">
            {isKasiReadonly ? "항목 보기 (자동 갱신)" : entry ? "항목 수정" : "+ 항목 추가"}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {isKasiReadonly && (
            <div className="px-3 py-2 bg-blue-50 border border-blue-200 rounded text-xs text-blue-800">
              🔄 한국 공휴일 자동 갱신 항목입니다. 직접 수정·삭제할 수 없으며, "한국 공휴일 갱신" 버튼으로만 변경됩니다.
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">타입</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              disabled={isKasiReadonly}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500"
            >
              {TYPE_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">제목</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder="예: 창립기념일"
              disabled={isKasiReadonly}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
              required
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">시작일</label>
              <DateInput

                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={isKasiReadonly}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500"
                required
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">종료일</label>
              <DateInput

                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                disabled={isKasiReadonly}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              색상 <span className="text-xs text-gray-400 ml-1">(선택, 미선택 시 타입별 기본)</span>
            </label>
            <div className="flex gap-2">
              <input
                type="color"
                value={color || TYPE_OPTIONS.find((t) => t.value === type)?.defaultColor || "#000000"}
                onChange={(e) => setColor(e.target.value)}
                className="h-9 w-14 rounded border border-gray-300 cursor-pointer"
              />
              <input
                type="text"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="#RRGGBB"
                pattern="^#[0-9a-fA-F]{6}$"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
              />
              {color && (
                <button type="button" onClick={() => setColor("")} className="px-2 text-xs text-gray-500 hover:text-gray-700">
                  기본값
                </button>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              설명 <span className="text-xs text-gray-400 ml-1">(선택)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={1000}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-y"
            />
          </div>

          {error && (
            <div className="px-3 py-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            {entry && !isKasiReadonly && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={saving}
                className="px-3 py-2 text-sm border border-red-300 text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-50"
              >
                삭제
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 border border-gray-300 rounded-lg py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {isKasiReadonly ? "닫기" : "취소"}
            </button>
            {!isKasiReadonly && (
              <button
                type="submit"
                disabled={saving}
                className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "저장 중..." : entry ? "저장" : "등록"}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
