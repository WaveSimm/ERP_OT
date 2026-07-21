"use client";

import { useMemo } from "react";
import type { EquipmentResource, ReservationInstance } from "@/lib/api";

// 공용자산예약 (2026-05-05) — 자원별 가로 타임라인 (주 뷰)
//
// - 헤더: "M/D" 한 줄, 휴일 빨강 / 주말 회색
// - 자원당 1행, 인스턴스 막대 (트랙 분리)
// - 시간 윈도우: 일 뷰와 통일 (08:00~20:00). 윈도우 밖 인스턴스는 표시 안 됨
// - 셀 클릭 → onCellClick(resourceId, dateIso)
// - 인스턴스 클릭 → onInstanceClick(instance)

// 일 뷰와 동일한 시간 윈도우
const DAY_WINDOW_START_HOUR = 8;
const DAY_WINDOW_END_HOUR = 20;
const DAY_WINDOW_HOURS = DAY_WINDOW_END_HOUR - DAY_WINDOW_START_HOUR; // 12

export interface DayCell {
  iso: string;     // YYYY-MM-DD
  label: string;   // "5/12"
  dow: number;     // 0=일 ~ 6=토
  isWeekend: boolean;
  isHoliday: boolean;
  holidayName?: string;
}

interface Props {
  days: DayCell[];
  resources: EquipmentResource[];
  instances: ReservationInstance[];
  currentUserId?: string;
  onCellClick?: (resourceId: string, dateIso: string) => void;
  onInstanceClick?: (instance: ReservationInstance) => void;
}

const TYPE_ICON: Record<string, string> = { VEHICLE: "🚗", FACILITY: "🏭" };

function fmtTimeRange(startIso: string, endIso: string, isAllDay: boolean): string {
  if (isAllDay) return "종일";
  const s = new Date(startIso);
  const e = new Date(endIso);
  const f = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${f(s)}~${f(e)}`;
}

export default function ReservationCalendar({
  days,
  resources,
  instances,
  currentUserId,
  onCellClick,
  onInstanceClick,
}: Props) {
  // 윈도우 시작/끝 (밀리초)
  const windowStartMs = useMemo(() => {
    if (days.length === 0) return 0;
    const [y, m, d] = days[0]!.iso.split("-").map(Number);
    return new Date(y!, m! - 1, d!, 0, 0, 0, 0).getTime();
  }, [days]);

  const windowEndMs = useMemo(() => {
    if (days.length === 0) return 0;
    const [y, m, d] = days[days.length - 1]!.iso.split("-").map(Number);
    return new Date(y!, m! - 1, d!, 23, 59, 59, 999).getTime();
  }, [days]);

  const totalDays = days.length;
  const dayMs = 24 * 60 * 60 * 1000;

  // 자원별 인스턴스 그룹화 (CONFIRMED만)
  const instancesByResource = useMemo(() => {
    const map = new Map<string, ReservationInstance[]>();
    for (const inst of instances) {
      if (inst.status === "CANCELED") continue;
      const list = map.get(inst.resourceId) ?? [];
      list.push(inst);
      map.set(inst.resourceId, list);
    }
    return map;
  }, [instances]);

  function renderResourceRow(resource: EquipmentResource) {
    const list = instancesByResource.get(resource.id) ?? [];
    // 윈도우와 겹치는 인스턴스만
    const filtered = list.filter((inst) => {
      const s = new Date(inst.startAt).getTime();
      const e = new Date(inst.endAt).getTime();
      return e >= windowStartMs && s <= windowEndMs;
    });

    // 트랙 분리 (단순 알고리즘: 시작 정렬 후 첫 빈 트랙)
    type Track = { endTime: number };
    const tracks: Track[] = [];
    const positions = new Map<string, number>();
    const sorted = [...filtered].sort((a, b) => a.startAt.localeCompare(b.startAt));
    for (const inst of sorted) {
      const startMs = new Date(inst.startAt).getTime();
      const endMs = new Date(inst.endAt).getTime();
      let placed = false;
      for (let i = 0; i < tracks.length; i++) {
        if (tracks[i]!.endTime <= startMs) {
          tracks[i]!.endTime = endMs;
          positions.set(inst.instanceKey, i);
          placed = true;
          break;
        }
      }
      if (!placed) {
        tracks.push({ endTime: endMs });
        positions.set(inst.instanceKey, tracks.length - 1);
      }
    }
    const trackCount = Math.max(1, tracks.length);
    const rowHeight = trackCount * 30 + 16;

    return (
      <tr key={resource.id} className="border-b border-gray-100 dark:border-gray-800">
        <td className="px-3 py-3 text-xs font-medium text-gray-800 dark:text-gray-100 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 truncate" title={resource.name}>
          <span className="mr-1">{TYPE_ICON[resource.type] ?? "🔧"}</span>
          {resource.name}
        </td>
        <td colSpan={totalDays} className="p-0 relative" style={{ height: rowHeight }}>
          <div className="absolute inset-0 flex">
            {days.map((d) => (
              <button
                key={d.iso}
                type="button"
                onClick={() => onCellClick?.(resource.id, d.iso)}
                className={`flex-1 border-r border-gray-100 dark:border-gray-800 hover:bg-blue-50/50 dark:hover:bg-blue-950/30 transition-colors ${
                  d.isHoliday ? "bg-red-50/40 dark:bg-red-950/20" : d.isWeekend ? "bg-gray-50/50 dark:bg-gray-800/40" : ""
                }`}
                title={`${d.iso}${d.holidayName ? ` (${d.holidayName})` : ""} — 클릭하여 예약 추가`}
              />
            ))}
          </div>
          {sorted.map((inst) => {
            // 일 뷰와 동일한 시간 윈도우(08~20시) 비율로 막대 위치 계산
            const start = new Date(inst.startAt);
            const end = new Date(inst.endAt);
            const dayIdxStart = Math.floor((start.getTime() - windowStartMs) / dayMs);
            const dayIdxEnd = Math.floor((end.getTime() - windowStartMs) / dayMs);
            const startHour = start.getHours() + start.getMinutes() / 60;
            const endHour = end.getHours() + end.getMinutes() / 60;
            const startRatio = Math.max(0, Math.min(1, (startHour - DAY_WINDOW_START_HOUR) / DAY_WINDOW_HOURS));
            const endRatio = Math.max(0, Math.min(1, (endHour - DAY_WINDOW_START_HOUR) / DAY_WINDOW_HOURS));
            const leftPos = dayIdxStart + startRatio;
            const rightPos = dayIdxEnd + endRatio;
            // 이번 주 밖으로 이어지는 예약은 표 안(0~totalDays)으로 잘라서 그림 + 계속됨 표시
            const startsBefore = leftPos < 0;
            const endsAfter = rightPos > totalDays;
            const cLeftPos = Math.max(0, leftPos);
            const cRightPos = Math.min(totalDays, rightPos);
            const left = (cLeftPos / totalDays) * 100;
            const widthPctRaw = (cRightPos - cLeftPos) * 100 / totalDays;
            // 단일 일자 + 윈도우 밖 시각이면 width≈0 → 렌더 스킵
            if (widthPctRaw < 0.1) return null;
            const width = Math.max(0.5, widthPctRaw);
            const trackIdx = positions.get(inst.instanceKey) ?? 0;
            const isMine = currentUserId && inst.userId === currentUserId;
            return (
              <button
                type="button"
                key={inst.instanceKey}
                onClick={(e) => {
                  e.stopPropagation();
                  onInstanceClick?.(inst);
                }}
                className={`absolute rounded-md text-[10px] truncate text-left px-2 transition ${
                  startsBefore ? "rounded-l-none" : ""
                } ${endsAfter ? "rounded-r-none" : ""} ${
                  isMine ? "bg-blue-600 text-white hover:brightness-110" : "bg-blue-100 text-blue-900 hover:bg-blue-300"
                } ${inst.isException ? "border border-amber-400" : ""}`}
                style={{
                  left: `${left}%`,
                  width: `${width}%`,
                  top: 7 + trackIdx * 30,
                  height: 24,
                  zIndex: 5,
                }}
                title={`${inst.title} — ${fmtTimeRange(inst.startAt, inst.endAt, inst.isAllDay)} (${inst.userName ?? "—"})${inst.isRecurring ? ` / ${inst.recurrenceSummary}` : ""}`}
              >
                {startsBefore && <span className="mr-0.5">◂</span>}
                <span className="font-medium">{inst.title}</span>
                <span className="opacity-75 ml-1">{inst.userName ?? ""}</span>
                {endsAfter && <span className="ml-0.5">▸</span>}
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
        등록된 활성 자원이 없습니다. <a href="/management/equipment-resources" className="text-blue-600 dark:text-blue-400 underline">공용자산 관리</a>에서 추가하세요.
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
      <table className="w-full text-xs border-collapse table-fixed">
        <colgroup>
          <col style={{ width: 320 }} />
          {days.map((d) => (
            <col key={d.iso} />
          ))}
        </colgroup>
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
            <th className="text-center px-3 py-2 bg-gray-50 dark:bg-gray-800 font-medium text-gray-600 dark:text-gray-300 border-r border-gray-200 dark:border-gray-700">
              자원
            </th>
            {days.map((d) => {
              const colorCls = d.isHoliday
                ? "text-red-500 dark:text-red-400 font-medium"
                : d.isWeekend
                ? "text-gray-400"
                : "text-gray-500";
              return (
                <th
                  key={d.iso}
                  className={`text-center px-1 py-2 font-normal text-[11px] whitespace-nowrap ${colorCls} ${d.isHoliday ? "bg-red-100/40" : ""}`}
                  title={d.holidayName ?? undefined}
                >
                  {d.label} ({["일", "월", "화", "수", "목", "금", "토"][d.dow] ?? ""})
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>{resources.map(renderResourceRow)}</tbody>
      </table>
    </div>
  );
}
