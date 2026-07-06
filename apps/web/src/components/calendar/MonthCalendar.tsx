"use client";

import { useEffect, useMemo, useState } from "react";

const TYPE_COLORS: Record<string, string> = {
  PUBLIC_HOLIDAY: "bg-red-500",
  COMPANY_HOLIDAY: "bg-orange-400",
  EVENT: "bg-blue-500",
  WORKDAY: "bg-gray-400",
};
const TYPE_TEXT_COLORS: Record<string, string> = {
  PUBLIC_HOLIDAY: "text-red-700 bg-red-50",
  COMPANY_HOLIDAY: "text-orange-700 bg-orange-50",
  EVENT: "text-blue-700 bg-blue-50",
  WORKDAY: "text-gray-700 bg-gray-100",
};

export interface CalendarEntry {
  id: string;
  type: string;
  title: string;
  description: string | null;
  startDate: string; // ISO date string
  endDate: string;
  color: string | null;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function isSameDate(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function buildMonthGrid(year: number, month: number): Date[] {
  // month: 0-based
  const first = new Date(year, month, 1);
  const startDay = first.getDay(); // 0=일
  const start = new Date(year, month, 1 - startDay);
  const grid: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    grid.push(d);
  }
  return grid;
}

interface Props {
  year: number;
  month: number; // 0-based
  entries: CalendarEntry[];
  onDayClick?: (date: string) => void;
  onEntryClick?: (entry: CalendarEntry) => void;
}

export default function MonthCalendar({ year, month, entries, onDayClick, onEntryClick }: Props) {
  const [today, setToday] = useState<Date | null>(null);
  useEffect(() => {
    setToday(new Date());
  }, []);
  const grid = useMemo(() => buildMonthGrid(year, month), [year, month]);

  // 항목별 시작/끝 날짜 파싱
  const parsed = useMemo(() => {
    return entries.map((e) => ({
      ...e,
      _start: new Date(e.startDate),
      _end: new Date(e.endDate),
    }));
  }, [entries]);

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      {/* 요일 헤더 */}
      <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50">
        {WEEKDAYS.map((w, i) => (
          <div
            key={w}
            className={`px-2 py-2 text-center text-xs font-semibold ${
              i === 0 ? "text-red-600 dark:text-red-400" : i === 6 ? "text-blue-600 dark:text-blue-400" : "text-gray-700"
            }`}
          >
            {w}
          </div>
        ))}
      </div>

      {/* 날짜 그리드 */}
      <div className="grid grid-cols-7" style={{ gridAutoRows: "minmax(100px, auto)" }}>
        {grid.map((d, idx) => {
          const isCurrentMonth = d.getMonth() === month;
          const isToday = today ? isSameDate(d, today) : false;
          const dow = d.getDay();
          const dateStr = isoDate(d);

          // 이 날짜에 속한 항목들
          const dayEntries = parsed.filter((e) => {
            const dt = new Date(d.getFullYear(), d.getMonth(), d.getDate());
            const start = new Date(e._start.getUTCFullYear(), e._start.getUTCMonth(), e._start.getUTCDate());
            const end = new Date(e._end.getUTCFullYear(), e._end.getUTCMonth(), e._end.getUTCDate());
            return dt >= start && dt <= end;
          });

          return (
            <div
              key={idx}
              onClick={() => onDayClick?.(dateStr)}
              className={`border-r border-b border-gray-100 last:border-r-0 px-1.5 py-1 cursor-pointer hover:bg-blue-50/40 dark:hover:bg-blue-500/10 ${
                !isCurrentMonth ? "bg-gray-50/50 dark:bg-gray-500/10" : ""
              }`}
            >
              <div
                className={`text-xs font-medium mb-1 ${
                  !isCurrentMonth ? "text-gray-400" :
                  isToday ? "text-white bg-blue-600 rounded-full w-5 h-5 flex items-center justify-center" :
                  dow === 0 ? "text-red-600 dark:text-red-400" :
                  dow === 6 ? "text-blue-600 dark:text-blue-400" :
                  "text-gray-700"
                }`}
              >
                {d.getDate()}
              </div>

              <div className="space-y-0.5">
                {dayEntries.slice(0, 3).map((e) => {
                  const typeStyle = TYPE_TEXT_COLORS[e.type] ?? "text-gray-700 bg-gray-100";
                  return (
                    <div
                      key={e.id}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onEntryClick?.(e);
                      }}
                      className={`text-[10px] px-1.5 py-0.5 rounded truncate cursor-pointer hover:opacity-80 ${typeStyle}`}
                      style={e.color ? { backgroundColor: e.color + "22", color: e.color } : undefined}
                      title={e.title}
                    >
                      {e.title}
                    </div>
                  );
                })}
                {dayEntries.length > 3 && (
                  <div className="text-[10px] text-gray-400 px-1.5">+{dayEntries.length - 3}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { TYPE_COLORS, TYPE_TEXT_COLORS };
