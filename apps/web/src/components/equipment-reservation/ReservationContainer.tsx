"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  equipmentReservationApi,
  equipmentResourceApi,
  type EquipmentResource,
  type ReservationInstance,
  getUser,
} from "@/lib/api";
import { useHolidaysMap } from "@/hooks/useHolidaysMap";
import ReservationCalendar from "./ReservationCalendar";
import ReservationDayView from "./ReservationDayView";
import ReservationModal from "./ReservationModal";
import ReservationDetailPopover from "./ReservationDetailPopover";
import MyReservationsList from "./MyReservationsList";

type ViewMode = "week" | "day";

// 공용자산예약 (2026-05-05) — 자원관리 탭 통합 컨테이너

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function ReservationContainer() {
  const me = getUser();
  const myUserId = me?.id;
  const myRole = (me?.role ?? "VIEWER") as "ADMIN" | "MANAGER" | "OPERATOR" | "VIEWER";
  const canCreate = myRole === "ADMIN" || myRole === "MANAGER" || myRole === "OPERATOR";

  // 뷰 모드: week (이번주 1주) / day (하루)
  const [viewMode, setViewMode] = useState<ViewMode>("week");

  // weekOffset: week 모드에선 주 단위, day 모드에선 일 단위
  const [weekOffset, setWeekOffset] = useState(0); // week 전용 (1주씩)
  const [dayOffset, setDayOffset] = useState(0);   // day 전용 (1일씩)

  const holidays = useHolidaysMap();

  const days = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let start: Date;
    let length: number;
    if (viewMode === "week") {
      const dow = today.getDay();
      const mondayDelta = dow === 0 ? -6 : 1 - dow;
      start = new Date(today);
      start.setDate(today.getDate() + mondayDelta + weekOffset * 7);
      length = 7;
    } else {
      start = new Date(today);
      start.setDate(today.getDate() + dayOffset);
      length = 1;
    }
    const list: { iso: string; label: string; dow: number; isWeekend: boolean; isHoliday: boolean; holidayName?: string }[] = [];
    for (let i = 0; i < length; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const holidayName = holidays.get(iso);
      list.push({
        iso,
        label: `${d.getMonth() + 1}/${d.getDate()}`,
        dow: d.getDay(),
        isWeekend: d.getDay() === 0 || d.getDay() === 6,
        isHoliday: !!holidayName,
        ...(holidayName ? { holidayName } : {}),
      });
    }
    return list;
  }, [viewMode, weekOffset, dayOffset, holidays]);

  const rangeLabel = useMemo(() => {
    if (days.length === 0) return "";
    if (viewMode === "day") {
      const d = days[0]!;
      const dowLabel = ["일", "월", "화", "수", "목", "금", "토"][d.dow] ?? "";
      const suffix = dayOffset === 0 ? " (오늘)" : dayOffset === -1 ? " (어제)" : dayOffset === 1 ? " (내일)" : "";
      return `${d.label} (${dowLabel})${suffix}${d.holidayName ? ` · ${d.holidayName}` : ""}`;
    }
    const first = days[0]!;
    const last = days[6]!;
    const suffix = weekOffset === 0 ? " (이번주)" : weekOffset === -1 ? " (지난주)" : weekOffset === 1 ? " (다음주)" : "";
    return `${first.label} ~ ${last.label}${suffix}`;
  }, [days, viewMode, weekOffset, dayOffset]);

  const [resources, setResources] = useState<EquipmentResource[]>([]);
  const [instances, setInstances] = useState<ReservationInstance[]>([]);
  const [loading, setLoading] = useState(true);

  const [showModal, setShowModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState<ReservationInstance | null>(null);
  const [defaultDate, setDefaultDate] = useState<string>("");
  const [defaultResourceId, setDefaultResourceId] = useState<string | undefined>(undefined);
  const [defaultStartTime, setDefaultStartTime] = useState<string | undefined>(undefined);

  const [detailEntry, setDetailEntry] = useState<ReservationInstance | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const fromIso = days[0]?.iso ?? "";
  const toIso = days[days.length - 1]?.iso ?? "";

  const loadResources = useCallback(async () => {
    try {
      const data = await equipmentResourceApi.list({ isActive: true });
      setResources(data);
    } catch (e: any) {
      console.error("[reservation] resources load error:", e);
    }
  }, []);

  const loadReservations = useCallback(async () => {
    if (!fromIso || !toIso) return;
    setLoading(true);
    try {
      const data = await equipmentReservationApi.list({ from: fromIso, to: toIso });
      setInstances(data);
    } catch (e: any) {
      console.error("[reservation] list error:", e);
    } finally {
      setLoading(false);
    }
  }, [fromIso, toIso]);

  useEffect(() => {
    loadResources();
  }, [loadResources]);

  useEffect(() => {
    loadReservations();
  }, [loadReservations, refreshKey]);

  const goPrev = () => {
    if (viewMode === "week") setWeekOffset((w) => w - 1);
    else setDayOffset((d) => d - 1);
  };
  const goNext = () => {
    if (viewMode === "week") setWeekOffset((w) => w + 1);
    else setDayOffset((d) => d + 1);
  };
  const goToday = () => {
    setWeekOffset(0);
    setDayOffset(0);
  };

  const handleAdd = () => {
    setEditingEntry(null);
    setDefaultResourceId(undefined);
    setDefaultDate(isoDate(new Date()));
    setShowModal(true);
  };

  const handleCellClick = (resourceId: string, dateIso: string) => {
    if (!canCreate) return;
    setEditingEntry(null);
    setDefaultResourceId(resourceId);
    setDefaultDate(dateIso);
    setDefaultStartTime(undefined);
    setShowModal(true);
  };

  /** 일 뷰의 빈 시간 슬롯 클릭 — 시작 시각도 함께 전달 */
  const handleSlotClick = (resourceId: string, dateIso: string, startTime: string) => {
    if (!canCreate) return;
    setEditingEntry(null);
    setDefaultResourceId(resourceId);
    setDefaultDate(dateIso);
    setDefaultStartTime(startTime);
    setShowModal(true);
  };

  const handleInstanceClick = (instance: ReservationInstance) => {
    setDetailEntry(instance);
  };

  const handleSaved = () => {
    setShowModal(false);
    setEditingEntry(null);
    setRefreshKey((k) => k + 1);
  };

  const handleEdit = () => {
    if (!detailEntry) return;
    setEditingEntry(detailEntry);
    setDetailEntry(null);
    setShowModal(true);
  };

  const canModifyDetail = (() => {
    if (!detailEntry) return false;
    if (myRole === "ADMIN" || myRole === "MANAGER") return true;
    return detailEntry.userId === myUserId;
  })();

  return (
    <div>
      {/* 툴바 */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button onClick={goPrev} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50" title={viewMode === "week" ? "이전 주" : "어제"}>◀</button>
        <h3 className="text-base font-semibold text-gray-900 min-w-[200px] text-center">
          {rangeLabel}
        </h3>
        <button onClick={goNext} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50" title={viewMode === "week" ? "다음 주" : "내일"}>▶</button>
        <button onClick={goToday} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50" title="오늘로 이동">오늘</button>
        {/* 뷰 토글 */}
        <div className="ml-2 inline-flex border border-gray-300 rounded-lg overflow-hidden">
          <button
            onClick={() => setViewMode("week")}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${viewMode === "week" ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
          >
            주간
          </button>
          <button
            onClick={() => setViewMode("day")}
            className={`px-3 py-1.5 text-sm font-medium transition-colors border-l border-gray-300 ${viewMode === "day" ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
          >
            일간
          </button>
        </div>
        <div className="flex-1" />
        {canCreate && resources.length > 0 && (
          <button
            onClick={handleAdd}
            className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            + 예약 추가
          </button>
        )}
      </div>

      <div className="flex gap-4">
        <div className="flex-1 min-w-0">
          {loading ? (
            <div className="bg-white border border-gray-200 rounded-xl py-16 text-center">
              <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto" />
            </div>
          ) : viewMode === "day" ? (
            <ReservationDayView
              dateIso={days[0]?.iso ?? ""}
              resources={resources}
              instances={instances}
              currentUserId={myUserId ?? ""}
              onSlotClick={handleSlotClick}
              onInstanceClick={handleInstanceClick}
            />
          ) : (
            <ReservationCalendar
              days={days}
              resources={resources}
              instances={instances}
              currentUserId={myUserId ?? ""}
              onCellClick={handleCellClick}
              onInstanceClick={handleInstanceClick}
            />
          )}
          <div className="mt-3 flex items-center gap-3 text-[11px] text-gray-500 flex-wrap px-2">
            <span className="flex items-center gap-1">
              <span className="inline-block w-4 h-3 bg-blue-500 rounded-sm" /> 대여 내 예약
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-4 h-3 bg-blue-100 rounded-sm" /> 대여 다른 사람
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-4 h-3 bg-purple-500 rounded-sm" /> 정비 내 예약
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-4 h-3 bg-purple-100 rounded-sm" /> 정비 다른 사람
            </span>
            <span className="flex items-center gap-1"><span className="font-bold">↻</span> 반복 시리즈</span>
          </div>
        </div>

        <MyReservationsList refreshKey={refreshKey} onItemClick={handleInstanceClick} />
      </div>

      {showModal && (
        <ReservationModal
          entry={editingEntry}
          {...(defaultResourceId ? { defaultResourceId } : {})}
          {...(defaultDate ? { defaultDate } : {})}
          {...(defaultStartTime ? { defaultStartTime } : {})}
          resources={resources}
          onClose={() => { setShowModal(false); setEditingEntry(null); }}
          onSaved={handleSaved}
        />
      )}

      {detailEntry && (
        <ReservationDetailPopover
          instance={detailEntry}
          canModify={canModifyDetail}
          onClose={() => setDetailEntry(null)}
          onEdit={handleEdit}
          onChanged={() => setRefreshKey((k) => k + 1)}
          wide
        />
      )}
    </div>
  );
}
