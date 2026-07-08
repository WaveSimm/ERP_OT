"use client";

import { useEffect, useState, useCallback } from "react";
import HomeCard from "./HomeCard";
import { attendanceApi } from "@/lib/api";

function fmtTime(iso?: string | null) {
  if (!iso) return "--:--";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type CheckState = "NOT_STARTED" | "CHECKED_IN" | "ON_BREAK" | "CHECKED_OUT";

const STATE_BADGE: Record<CheckState, { dot: string; label: string; color: string }> = {
  NOT_STARTED: { dot: "bg-gray-400", label: "미출근", color: "text-gray-500" },
  CHECKED_IN: { dot: "bg-green-500", label: "근무 중", color: "text-green-700" },
  ON_BREAK: { dot: "bg-orange-400", label: "외출 중", color: "text-orange-600" },
  CHECKED_OUT: { dot: "bg-gray-500", label: "퇴근 완료", color: "text-gray-700" },
};

export default function MyAttendanceCard() {
  const [today, setToday] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setToday(await attendanceApi.getToday());
    } catch {
      setToday(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    load().finally(() => !cancelled && setLoading(false));
    const handler = () => { void load(); };
    window.addEventListener("attendance-updated", handler);
    return () => {
      cancelled = true;
      window.removeEventListener("attendance-updated", handler);
    };
  }, [load]);

  const act = async (fn: () => Promise<any>, confirmMsg?: string) => {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setSaving(true);
    try {
      await fn();
      await load();
      window.dispatchEvent(new CustomEvent("attendance-updated"));
    } catch (e: any) {
      alert(e?.message ?? "처리 실패");
    } finally {
      setSaving(false);
    }
  };

  const state: CheckState = (today?.checkState as CheckState) ?? "NOT_STARTED";
  const badge = STATE_BADGE[state];

  return (
    <HomeCard icon="⏱" title="내 근태" href="/me/attendance" hrefLabel="근태관리" loading={loading}>
      <div className="space-y-3">
        {/* 상태 + 날짜 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${badge.dot}`} />
            <span className={`text-sm font-medium ${badge.color}`}>{badge.label}</span>
          </div>
          <span className="text-xs text-gray-400">{todayStr()}</span>
        </div>

        {/* 시간 정보 */}
        <div className="flex items-center gap-4 text-sm">
          <span className="text-gray-500">
            출근: <span className="font-semibold text-gray-900">{fmtTime(today?.checkIn)}</span>
          </span>
          <span className="text-gray-500">
            퇴근: <span className="font-semibold text-gray-900">{fmtTime(today?.checkOut)}</span>
          </span>
        </div>

        {/* 액션 버튼 */}
        <div className="flex gap-2">
          {state === "NOT_STARTED" && (
            <>
              <button
                onClick={() => act(() => attendanceApi.checkIn({ workType: "OFFICE" }), "출근 처리하시겠습니까?")}
                disabled={saving}
                className="flex-1 px-3 py-2 text-sm font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                🟢 출근
              </button>
              <button
                onClick={() => act(() => attendanceApi.checkIn({ workType: "FIELD" }), "외근 출근 처리하시겠습니까?")}
                disabled={saving}
                className="flex-1 px-3 py-2 text-sm font-semibold border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-950 disabled:opacity-50"
              >
                🔵 외근
              </button>
            </>
          )}
          {state === "CHECKED_IN" && (
            <>
              <button
                onClick={() => act(() => attendanceApi.breakOut(), "외출 처리하시겠습니까?")}
                disabled={saving}
                className="flex-1 px-3 py-2 text-sm font-semibold bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50"
              >
                🟡 외출
              </button>
              <button
                onClick={() => act(() => attendanceApi.checkOut(), "퇴근 처리하시겠습니까?\n퇴근 후에는 되돌릴 수 없습니다.")}
                disabled={saving}
                className="flex-1 px-3 py-2 text-sm font-semibold bg-gray-700 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
              >
                🔴 퇴근
              </button>
            </>
          )}
          {state === "ON_BREAK" && (
            <>
              <button
                onClick={() => act(() => attendanceApi.breakIn(), "복귀 처리하시겠습니까?")}
                disabled={saving}
                className="flex-1 px-3 py-2 text-sm font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                🟢 복귀
              </button>
              <button
                onClick={() => act(() => attendanceApi.checkOut(), "퇴근 처리하시겠습니까?")}
                disabled={saving}
                className="flex-1 px-3 py-2 text-sm font-semibold bg-gray-700 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
              >
                🔴 퇴근
              </button>
            </>
          )}
          {state === "CHECKED_OUT" && (
            <div className="flex-1 px-3 py-2 text-sm text-center text-gray-500 bg-gray-50 rounded-lg">
              오늘 근무 종료
            </div>
          )}
        </div>
      </div>
    </HomeCard>
  );
}
