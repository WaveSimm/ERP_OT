"use client";

import { useMemo } from "react";
import type { EquipmentResource, ReservationInstance } from "@/lib/api";

// 공용자산예약 (2026-05-05) — 일 뷰
//
// 자원 행 × 30분 시간 슬롯 (08:00~20:00 = 24슬롯).
// 빈 슬롯 클릭 → 그 시각으로 예약 추가.
// 인스턴스는 시간 비율 기반 가로 막대.

const DAY_START_HOUR = 8;
const DAY_END_HOUR = 20;
const SLOT_MINUTES = 30;
const SLOTS_PER_HOUR = 60 / SLOT_MINUTES;
const TOTAL_SLOTS = (DAY_END_HOUR - DAY_START_HOUR) * SLOTS_PER_HOUR;

interface Props {
  /** YYYY-MM-DD */
  dateIso: string;
  resources: EquipmentResource[];
  instances: ReservationInstance[];
  currentUserId?: string;
  /** 빈 슬롯 클릭 → 등록 모달 (시작 시각 포함 ISO와 자원 ID 전달) */
  onSlotClick?: (resourceId: string, dateIso: string, startTime: string) => void;
  onInstanceClick?: (instance: ReservationInstance) => void;
}

const TYPE_ICON: Record<string, string> = { VEHICLE: "🚗", FACILITY: "🏭" };

function buildSlots() {
  const result: { startMinutes: number; label: string; isHourMark: boolean; time: string }[] = [];
  for (let i = 0; i < TOTAL_SLOTS; i++) {
    const totalMin = DAY_START_HOUR * 60 + i * SLOT_MINUTES;
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    const time = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    result.push({
      startMinutes: totalMin,
      label: m === 0 ? `${h}` : "",
      isHourMark: m === 0,
      time,
    });
  }
  return result;
}

export default function ReservationDayView({
  dateIso,
  resources,
  instances,
  currentUserId,
  onSlotClick,
  onInstanceClick,
}: Props) {
  const slots = useMemo(buildSlots, []);

  // 윈도우 시작/끝 (해당 날짜 08:00 ~ 20:00, ms)
  const windowStartMs = useMemo(() => {
    const [y, m, d] = dateIso.split("-").map(Number);
    return new Date(y!, m! - 1, d!, DAY_START_HOUR, 0, 0, 0).getTime();
  }, [dateIso]);

  const windowEndMs = useMemo(() => {
    const [y, m, d] = dateIso.split("-").map(Number);
    return new Date(y!, m! - 1, d!, DAY_END_HOUR, 0, 0, 0).getTime();
  }, [dateIso]);

  const totalMinutes = (DAY_END_HOUR - DAY_START_HOUR) * 60;

  // 자원별 인스턴스 (해당 날짜 + CONFIRMED + 윈도우 겹침)
  const instancesByResource = useMemo(() => {
    const map = new Map<string, ReservationInstance[]>();
    for (const inst of instances) {
      if (inst.status === "CANCELED") continue;
      const s = new Date(inst.startAt).getTime();
      const e = new Date(inst.endAt).getTime();
      // 일 뷰 윈도우와 겹침 체크
      if (e < windowStartMs || s > windowEndMs) continue;
      const list = map.get(inst.resourceId) ?? [];
      list.push(inst);
      map.set(inst.resourceId, list);
    }
    return map;
  }, [instances, windowStartMs, windowEndMs]);

  // 윈도우 밖에서 시작했지만 윈도우 안에서 끝나는 / 윈도우 안에서 시작했지만 윈도우 밖에서 끝나는 인스턴스도 표시 (클램프)

  function renderResourceRow(resource: EquipmentResource) {
    const list = instancesByResource.get(resource.id) ?? [];
    const sorted = [...list].sort((a, b) => a.startAt.localeCompare(b.startAt));

    return (
      <tr key={resource.id} className="border-b border-gray-100 dark:border-gray-800">
        <td className="px-3 py-3 text-xs font-medium text-gray-800 dark:text-gray-100 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 truncate" title={resource.name}>
          <span className="mr-1">{TYPE_ICON[resource.type] ?? "🔧"}</span>
          {resource.name}
        </td>
        <td colSpan={TOTAL_SLOTS} className="p-0 relative" style={{ height: 44 }}>
          {/* 빈 슬롯 (배경 + 클릭) */}
          <div className="absolute inset-0 flex">
            {slots.map((slot) => (
              <button
                key={slot.time}
                type="button"
                onClick={() => onSlotClick?.(resource.id, dateIso, slot.time)}
                className={`flex-1 hover:bg-blue-50/50 dark:hover:bg-blue-500/10 transition-colors ${
                  slot.isHourMark ? "border-l border-gray-200" : "border-l border-gray-50"
                }`}
                title={`${dateIso} ${slot.time} — 클릭하여 예약 추가`}
              />
            ))}
          </div>
          {/* 인스턴스 막대 */}
          {sorted.map((inst) => {
            const start = new Date(inst.startAt).getTime();
            const end = new Date(inst.endAt).getTime();
            const clampedStart = Math.max(start, windowStartMs);
            const clampedEnd = Math.min(end, windowEndMs);
            const startMin = (clampedStart - windowStartMs) / 60000;
            const endMin = (clampedEnd - windowStartMs) / 60000;
            const left = (startMin / totalMinutes) * 100;
            const width = Math.max(0.8, ((endMin - startMin) / totalMinutes) * 100);
            const isMine = currentUserId && inst.userId === currentUserId;
            const fmtTime = (iso: string) => {
              const d = new Date(iso);
              return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
            };
            return (
              <button
                type="button"
                key={inst.instanceKey}
                onClick={(e) => {
                  e.stopPropagation();
                  onInstanceClick?.(inst);
                }}
                className={`absolute rounded-md text-[10px] truncate text-left px-2 transition ${
                  isMine ? "bg-blue-600 text-white hover:brightness-110" : "bg-blue-100 text-blue-900 hover:bg-blue-300"
                } ${inst.isException ? "border border-amber-400" : ""}`}
                style={{ left: `${left}%`, width: `${width}%`, top: 6, height: 32, zIndex: 5 }}
                title={`${inst.title} — ${fmtTime(inst.startAt)}~${fmtTime(inst.endAt)} (${inst.userName ?? "—"})${inst.isRecurring ? ` / ${inst.recurrenceSummary}` : ""}`}
              >
                <span className="font-medium">{inst.title}</span>
                <span className="opacity-75 ml-1">{inst.userName ?? ""}</span>
              </button>
            );
          })}
        </td>
      </tr>
    );
  }

  if (resources.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400 text-sm">
        등록된 활성 자원이 없습니다.
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
      <table className="w-full text-xs border-collapse table-fixed">
        <colgroup>
          <col style={{ width: 320 }} />
          {slots.map((s) => (
            <col key={s.time} />
          ))}
        </colgroup>
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            <th className="text-center px-3 py-2 bg-gray-50 font-medium text-gray-600 border-r border-gray-200">
              자원
            </th>
            {slots.map((s) => (
              <th
                key={s.time}
                className={`text-center py-2 font-normal text-[10px] text-gray-500 ${
                  s.isHourMark ? "border-l border-gray-200" : ""
                }`}
              >
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{resources.map(renderResourceRow)}</tbody>
      </table>
      <div className="px-3 py-2 text-[10px] text-gray-400 border-t border-gray-100">
        업무시간 {DAY_START_HOUR}:00 ~ {DAY_END_HOUR}:00 (30분 슬롯). 시간 외 예약은 주 뷰에서 등록하거나 시간을 직접 조정하세요.
      </div>
    </div>
  );
}
