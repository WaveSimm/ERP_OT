"use client";

import { useState } from "react";
import { calendarApi } from "@/lib/api";

interface SyncResult {
  year: number;
  fetched: number;
  created: number;
  updated: number;
  deleted: number;
  durationMs: number;
}

interface Props {
  /** 갱신 완료 후 호출 (페이지 reload용) */
  onSynced?: () => void;
}

/**
 * 회사달력 v1.2 — 한국 공휴일 자동 갱신 트리거 버튼.
 * 올해 + 내년을 한 번에 sync.
 */
export default function SyncHolidaysButton({ onSynced }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function handleSync() {
    const ok = window.confirm(
      "한국 공휴일을 KASI에서 받아와 회사달력에 갱신합니다.\n" +
        "올해와 내년을 모두 갱신합니다. 진행할까요?\n\n" +
        "* 수동으로 등록한 항목은 영향받지 않습니다.",
    );
    if (!ok) return;

    setBusy(true);
    setMessage(null);
    try {
      const currentYear = new Date().getFullYear();
      const years = [currentYear, currentYear + 1];
      const results: SyncResult[] = [];
      for (const year of years) {
        const r = await calendarApi.syncHolidays(year);
        results.push(r);
      }
      const summary = results
        .map(
          (r) =>
            `${r.year}: 신규 ${r.created} · 갱신 ${r.updated} · 삭제 ${r.deleted}`,
        )
        .join("  /  ");
      setMessage({ kind: "ok", text: `✅ 완료 — ${summary}` });
      onSynced?.();
    } catch (err: any) {
      const msg =
        err?.body?.error?.message ??
        err?.message ??
        "알 수 없는 오류로 갱신에 실패했습니다.";
      setMessage({ kind: "err", text: `❌ 실패 — ${msg}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleSync}
        disabled={busy}
        className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
        title="공공데이터포털 KASI 특일 정보 API에서 한국 공휴일을 받아 회사달력에 자동 등록합니다."
      >
        {busy ? (
          <span className="animate-spin w-3.5 h-3.5 border-2 border-blue-600 border-t-transparent rounded-full" />
        ) : (
          "🔄"
        )}
        한국 공휴일 갱신
      </button>
      {message && (
        <span
          className={`text-xs px-2 py-1 rounded ${
            message.kind === "ok"
              ? "text-green-700 bg-green-50 border border-green-200"
              : "text-red-700 bg-red-50 border border-red-200"
          }`}
        >
          {message.text}
        </span>
      )}
    </div>
  );
}
