"use client";

import { useEffect, useState } from "react";
import { equipmentReservationApi, type ReservationInstance } from "@/lib/api";

// 공용자산예약 (2026-05-05) — 내 다가오는 예약 목록 (사이드)

interface Props {
  /** refresh 트리거용 키 (등록·수정 후 변경하면 재조회) */
  refreshKey?: number;
  onItemClick?: (instance: ReservationInstance) => void;
}

function fmtShort(iso: string): string {
  const d = new Date(iso);
  const date = `${d.getMonth() + 1}/${d.getDate()}`;
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${date} ${time}`;
}

function dayOfWeek(iso: string): string {
  return ["일", "월", "화", "수", "목", "금", "토"][new Date(iso).getDay()] ?? "";
}

const TYPE_ICON: Record<string, string> = { VEHICLE: "🚗", FACILITY: "🏭" };

export default function MyReservationsList({ refreshKey = 0, onItemClick }: Props) {
  const [items, setItems] = useState<ReservationInstance[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await equipmentReservationApi.mine({ upcoming: true, limit: 30 });
        if (!cancelled) setItems(data);
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return (
    <aside className="w-64 shrink-0">
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700">내 다가오는 예약</h3>
          <p className="text-xs text-gray-400 mt-0.5">{items.length}건</p>
        </div>
        <ul className="max-h-[600px] overflow-y-auto divide-y divide-gray-100">
          {loading ? (
            <li className="px-4 py-6 text-center text-xs text-gray-400">로드 중...</li>
          ) : items.length === 0 ? (
            <li className="px-4 py-6 text-center text-xs text-gray-400">예약 없음</li>
          ) : (
            items.map((inst) => (
              <li key={`${inst.id}-${inst.startAt}`}>
                <button
                  type="button"
                  onClick={() => onItemClick?.(inst)}
                  className="block w-full text-left px-4 py-2 hover:bg-gray-50"
                >
                  <div className="flex items-center gap-1 text-[10px] text-gray-500 mb-0.5">
                    <span>{fmtShort(inst.startAt)}</span>
                    <span>({dayOfWeek(inst.startAt)})</span>
                    {inst.isRecurring && (
                      <span className="ml-auto text-blue-500">🔁</span>
                    )}
                  </div>
                  <div className="text-sm text-gray-800 truncate font-medium">{inst.title}</div>
                  <div className="text-xs text-gray-400 mt-0.5 truncate">
                    <span className="mr-1">{TYPE_ICON[(inst as any).resourceType ?? ""] ?? ""}</span>
                    {inst.resourceName}
                  </div>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </aside>
  );
}
