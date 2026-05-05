"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import MonthCalendar, { type CalendarEntry, TYPE_TEXT_COLORS } from "@/components/calendar/MonthCalendar";
import EntryModal from "@/components/calendar/EntryModal";
import SyncHolidaysButton from "@/components/calendar/SyncHolidaysButton";
import { calendarApi, getUser } from "@/lib/api";

const TYPE_LABEL: Record<string, string> = {
  PUBLIC_HOLIDAY: "공휴일",
  COMPANY_HOLIDAY: "자체 휴일",
  EVENT: "회사 행사",
  WORKDAY: "특별 근무일",
};

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function AdminCalendarPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState(0); // 0-based, set on mount
  const [typeFilter, setTypeFilter] = useState<string>("");

  const [entries, setEntries] = useState<CalendarEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const [showModal, setShowModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState<CalendarEntry | null>(null);
  const [defaultDate, setDefaultDate] = useState<string>("");

  // 마운트 후 클라이언트 전용 초기화
  useEffect(() => {
    const token = localStorage.getItem("erp_user");
    if (!token) {
      router.push("/login");
      return;
    }
    const me = getUser();
    const admin = me?.role === "ADMIN";
    setIsAdmin(admin);
    if (!admin) {
      router.push("/home");
      return;
    }
    const today = new Date();
    setYear(today.getFullYear());
    setMonth(today.getMonth());
    setMounted(true);
  }, [router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const from = isoDate(new Date(year, month, 1));
      const to = isoDate(new Date(year, month + 1, 0));
      const params: any = { from, to };
      if (typeFilter) params.type = typeFilter;
      const data = await calendarApi.list(params);
      setEntries((data ?? []) as CalendarEntry[]);
    } catch (e: any) {
      console.error("[calendar] load error:", e);
    } finally {
      setLoading(false);
    }
  }, [year, month, typeFilter]);

  useEffect(() => {
    if (mounted && isAdmin) load();
  }, [load, mounted, isAdmin]);

  const goPrev = () => {
    if (month === 0) {
      setYear(year - 1);
      setMonth(11);
    } else {
      setMonth(month - 1);
    }
  };
  const goNext = () => {
    if (month === 11) {
      setYear(year + 1);
      setMonth(0);
    } else {
      setMonth(month + 1);
    }
  };
  const goToday = () => {
    const t = new Date();
    setYear(t.getFullYear());
    setMonth(t.getMonth());
  };

  const handleAdd = () => {
    setEditingEntry(null);
    setDefaultDate(isoDate(new Date()));
    setShowModal(true);
  };
  const handleDayClick = (date: string) => {
    setEditingEntry(null);
    setDefaultDate(date);
    setShowModal(true);
  };
  const handleEntryClick = (entry: CalendarEntry) => {
    setEditingEntry(entry);
    setShowModal(true);
  };
  const handleSaved = () => {
    setShowModal(false);
    setEditingEntry(null);
    load();
  };

  if (!mounted) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-12 text-center text-gray-500">
        관리자 전용 페이지입니다.
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900">📅 회사 달력</h2>
          <div className="flex items-center gap-2">
            <SyncHolidaysButton onSynced={load} />
            <button
              onClick={handleAdd}
              className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
            >
              + 항목 추가
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-4">
          <button onClick={goPrev} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">
            ◀
          </button>
          <h3 className="text-lg font-semibold text-gray-900 min-w-[140px] text-center">
            {year}년 {month + 1}월
          </h3>
          <button onClick={goNext} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">
            ▶
          </button>
          <button onClick={goToday} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">
            오늘
          </button>
          <span className="ml-4 text-sm text-gray-500">필터:</span>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-2 py-1.5 text-sm border border-gray-300 rounded"
          >
            <option value="">전체</option>
            <option value="PUBLIC_HOLIDAY">공휴일</option>
            <option value="COMPANY_HOLIDAY">자체 휴일</option>
            <option value="EVENT">행사</option>
            <option value="WORKDAY">특별 근무일</option>
          </select>
        </div>

        <div className="flex gap-4">
          {/* 좌측 사이드: 당월 항목 목록 */}
          <aside className="w-60 shrink-0">
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
                <h3 className="text-sm font-semibold text-gray-700">{month + 1}월 항목</h3>
                <p className="text-xs text-gray-400 mt-0.5">{entries.length}개</p>
              </div>
              <ul className="max-h-[600px] overflow-y-auto divide-y divide-gray-100">
                {entries.length === 0 ? (
                  <li className="px-4 py-6 text-center text-xs text-gray-400">
                    {loading ? "로드 중..." : "항목 없음"}
                  </li>
                ) : (
                  entries.map((e) => {
                    const start = new Date(e.startDate);
                    const end = new Date(e.endDate);
                    const dateRange = start.toISOString().slice(5, 10) === end.toISOString().slice(5, 10)
                      ? start.toISOString().slice(5, 10)
                      : `${start.toISOString().slice(5, 10)} ~ ${end.toISOString().slice(5, 10)}`;
                    const typeStyle = TYPE_TEXT_COLORS[e.type] ?? "text-gray-700 bg-gray-100";
                    return (
                      <li key={e.id}>
                        <button
                          onClick={() => handleEntryClick(e)}
                          className="block w-full text-left px-4 py-2 hover:bg-gray-50"
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <span
                              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${typeStyle}`}
                              style={e.color ? { backgroundColor: e.color + "22", color: e.color } : undefined}
                            >
                              {TYPE_LABEL[e.type] ?? e.type}
                            </span>
                          </div>
                          <div className="text-sm text-gray-800 truncate">{e.title}</div>
                          <div className="text-xs text-gray-400 mt-0.5">{dateRange}</div>
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            </div>
          </aside>

          {/* 우측: 월간 캘린더 */}
          <div className="flex-1 min-w-0">
            {loading ? (
              <div className="bg-white border border-gray-200 rounded-xl py-16 text-center">
                <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto" />
              </div>
            ) : (
              <MonthCalendar
                year={year}
                month={month}
                entries={entries}
                onDayClick={handleDayClick}
                onEntryClick={handleEntryClick}
              />
            )}
          </div>
        </div>

      {showModal && (
        <EntryModal
          entry={editingEntry}
          defaultDate={defaultDate}
          onClose={() => {
            setShowModal(false);
            setEditingEntry(null);
          }}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
