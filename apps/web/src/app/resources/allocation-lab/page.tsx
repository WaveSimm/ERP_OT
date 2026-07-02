"use client";

// ─────────────────────────────────────────────────────────────────────────────
//  [시험용] 일별 투입율 편집 프로토타입 — /resources/allocation-lab
//    개념: 태스크에 "총 공수(예산)"를 주고, 직원의 하루 세로열(다른 태스크들)을
//          보면서 일별로 투입율을 배치/조절. 긴 태스크라도 필요한 날에만 투입.
//    ※ 실데이터를 읽어오지만 편집은 로컬 상태(저장 안 됨). UX 검증용.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useState } from "react";
import { notFound } from "next/navigation";
import AppLayout from "@/components/AppLayout";
import { DateInput } from "@/components/ui/DateInput";
import { resourceApi } from "@/lib/api";

function toDateStr(d: Date) { return d.toISOString().slice(0, 10); }
function weekRange(offsetWeeks: number): { start: string; end: string } {
  const today = new Date();
  const dow = today.getDay();
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(today);
  mon.setDate(today.getDate() + diffToMon + offsetWeeks * 7);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  return { start: toDateStr(mon), end: toDateStr(sun) };
}
function monthRange(offsetMonths: number): { start: string; end: string } {
  const d = new Date(); d.setMonth(d.getMonth() + offsetMonths);
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { start: toDateStr(start), end: toDateStr(end) };
}
const WD = ["일", "월", "화", "수", "목", "금", "토"];
function weekday(date: string) { return WD[new Date(date + "T00:00:00").getDay()]; }

interface DayCell { date: string; percent: number; isWeekend?: boolean; isHoliday?: boolean; holidayName?: string; leaveLabel?: string; }
interface AssignmentRow {
  projectId: string; projectName: string; taskId: string; taskName: string;
  segmentId: string; segmentName: string; startDate: string; endDate: string;
  effectivePercent: number;
}
interface Row {
  resourceId: string; resourceName: string; dailyCapacityHours: number;
  totalAllocationPercent: number; isOverloaded: boolean;
  dayBreakdown: DayCell[]; assignments?: AssignmentRow[];
}

export default function AllocationLabPage() {
  // 실험 페이지 가드: 프로덕션 빌드에선 404 — 미리보기 dev 서버(:3009) 전용.
  //   NODE_ENV는 빌드타임 상수라 운영 번들에선 항상 notFound. 정식 반영 시 이 가드만 제거.
  if (process.env.NODE_ENV === "production") notFound();
  const init = useMemo(() => { const a = weekRange(0); const b = weekRange(1); return { start: a.start, end: b.end }; }, []);
  const [startDate, setStartDate] = useState(init.start);
  const [endDate, setEndDate] = useState(init.end);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [personId, setPersonId] = useState<string>("");
  // 편집값: key = `${segmentId}|${date}` → percent. 없으면 baseline 사용.
  const [edits, setEdits] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await resourceApi.dashboard(startDate, endDate) as Row[];
      setRows(data);
      setPersonId((prev) => prev && data.some((r) => r.resourceId === prev) ? prev : (data[0]?.resourceId ?? ""));
    } catch (e: any) { alert(e.message ?? "로드 실패"); }
    finally { setLoading(false); }
  }, [startDate, endDate]);
  useEffect(() => { load(); }, [load]);

  const applyRange = (s: string, e: string) => { setStartDate(s); setEndDate(e); };
  const shiftRange = (dir: -1 | 1) => {
    const s = new Date(startDate), e = new Date(endDate);
    const days = Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
    s.setDate(s.getDate() + dir * days); e.setDate(e.getDate() + dir * days);
    applyRange(toDateStr(s), toDateStr(e));
  };

  const person = rows.find((r) => r.resourceId === personId);
  const days = person?.dayBreakdown ?? [];
  const assignments = person?.assignments ?? [];

  const baseline = (a: AssignmentRow, date: string) => (date >= a.startDate && date <= a.endDate ? a.effectivePercent : 0);
  const cell = (a: AssignmentRow, date: string) => edits[`${a.segmentId}|${date}`] ?? baseline(a, date);
  const setCell = (segId: string, date: string, v: number) =>
    setEdits((p) => ({ ...p, [`${segId}|${date}`]: Math.max(0, Math.min(200, v)) }));

  const dayTotal = (date: string) => assignments.reduce((s, a) => s + cell(a, date), 0);
  const inRangeDays = (a: AssignmentRow) => days.filter((d) => d.date >= a.startDate && d.date <= a.endDate);
  // 현재 평균 투입율(%) = 태스크 기간 내 일별값 평균
  const currentAvg = (a: AssignmentRow) => {
    const ir = inRangeDays(a);
    if (!ir.length) return 0;
    return Math.round(ir.reduce((s, d) => s + cell(a, d.date), 0) / ir.length);
  };
  // 평균 투입율 설정 → 기간 내 매일 그 %로 균등 채움
  const setAvg = (a: AssignmentRow, pct: number) => {
    const v = Math.max(0, Math.min(200, pct || 0));
    setEdits((p) => {
      const next = { ...p };
      days.forEach((d) => { next[`${a.segmentId}|${d.date}`] = d.date >= a.startDate && d.date <= a.endDate ? v : 0; });
      return next;
    });
  };
  const resetTask = (segId: string) =>
    setEdits((p) => Object.fromEntries(Object.entries(p).filter(([k]) => !k.startsWith(`${segId}|`))));

  return (
    <AppLayout>
      <div className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <h1 className="text-lg font-bold text-gray-800">일별 투입율 편집</h1>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">시험용 · 저장 안 됨</span>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          태스크별 <b>평균 투입율(%)</b>을 넣으면 기간 내내 매일 그 %로 채워집니다(100%=매일 100%). 거기서 같은 날 다른 태스크를 보며 <b>필요한 날에만</b> 일별로 조절하세요.
          맨 아래 <b>일 합계</b>가 100%를 넘으면 과부하(빨강). 셀=% 값, 빈칸=0.
        </p>

        {/* 컨트롤: 직원 선택 + 기간 (간트 방식) */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <select value={personId} onChange={(e) => setPersonId(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            {rows.map((r) => <option key={r.resourceId} value={r.resourceId}>{r.resourceName}</option>)}
          </select>
          <div className="h-4 w-px bg-gray-200 mx-1" />
          {[
            { label: "지난주", range: () => weekRange(-1) },
            { label: "이번주", range: () => weekRange(0) },
            { label: "다음주", range: () => weekRange(1) },
            { label: "이번주+다음주", range: () => { const a = weekRange(0); const b = weekRange(1); return { start: a.start, end: b.end }; } },
            { label: "이번달", range: () => monthRange(0) },
          ].map(({ label, range }) => (
            <button key={label} onClick={() => { const r = range(); applyRange(r.start, r.end); }}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-600 transition-colors whitespace-nowrap">{label}</button>
          ))}
          <span className="text-xs text-gray-400 ml-1">범위</span>
          <button onClick={() => shiftRange(-1)} className="w-8 h-8 flex items-center justify-center rounded-lg border border-blue-300 bg-blue-50 text-blue-600 font-bold hover:bg-blue-100 transition-colors">◀</button>
          <DateInput value={startDate} onChange={(e) => setStartDate(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
          <span className="text-gray-400 text-sm">~</span>
          <DateInput value={endDate} onChange={(e) => setEndDate(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
          <button onClick={() => shiftRange(1)} className="w-8 h-8 flex items-center justify-center rounded-lg border border-blue-300 bg-blue-50 text-blue-600 font-bold hover:bg-blue-100 transition-colors">▶</button>
        </div>

        {loading ? (
          <div className="py-16 text-center text-gray-400">불러오는 중…</div>
        ) : !person ? (
          <div className="py-16 text-center text-gray-400">직원을 선택하세요.</div>
        ) : assignments.length === 0 ? (
          <div className="py-16 text-center text-gray-400">이 기간에 <b>{person.resourceName}</b> 님의 배정된 태스크가 없습니다.</div>
        ) : (
          <div className="overflow-x-auto border border-gray-200 rounded-xl">
            <table className="text-xs border-collapse">
              <thead>
                <tr className="bg-gray-50">
                  <th className="sticky left-0 z-10 bg-gray-50 border-b border-r border-gray-200 px-3 py-2 text-left w-[140px] min-w-[140px] max-w-[140px]">프로젝트</th>
                  <th className="sticky left-[140px] z-10 bg-gray-50 border-b border-r border-gray-200 px-3 py-2 text-left min-w-[280px]">태스크 · 평균 투입율(%)</th>
                  {days.map((d) => (
                    <th key={d.date} className={`border-b border-gray-200 px-1 py-1 text-center min-w-[42px] ${d.isWeekend || d.isHoliday ? "bg-gray-100 text-gray-400" : "text-gray-500"}`}
                      title={d.holidayName || d.leaveLabel || ""}>
                      <div>{d.date.slice(5)}</div>
                      <div className="text-[10px]">{weekday(d.date)}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {assignments.map((a) => {
                  return (
                    <tr key={a.segmentId} className="hover:bg-blue-50/30">
                      <td className="sticky left-0 z-10 bg-white border-b border-r border-gray-200 px-3 py-1 w-[140px] min-w-[140px] max-w-[140px]">
                        <div className="truncate text-gray-500" title={a.projectName}>{a.projectName}</div>
                      </td>
                      <td className="sticky left-[140px] z-10 bg-white border-b border-r border-gray-200 px-3 py-1 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-700 truncate max-w-[150px]" title={`${a.projectName} · ${a.taskName}`}>{a.taskName}</span>
                          <input type="number" value={currentAvg(a)} onChange={(e) => setAvg(a, Number(e.target.value))}
                            title="평균 투입율(%) — 기간 내내 매일 이 %로 채움"
                            className="w-12 border border-gray-200 rounded px-1 py-0.5 text-[11px] text-right" />
                          <span className="text-[10px] text-gray-400">%</span>
                          <button onClick={() => resetTask(a.segmentId)} title="초기화(균등으로 되돌리기)"
                            className="text-[11px] px-1 rounded border border-gray-200 text-gray-400 hover:bg-gray-50">↺</button>
                        </div>
                      </td>
                      {days.map((d) => {
                        const inRange = d.date >= a.startDate && d.date <= a.endDate;
                        const v = cell(a, d.date);
                        return (
                          <td key={d.date} className={`border-b border-gray-100 p-0 text-center ${d.isWeekend || d.isHoliday ? "bg-gray-50" : ""}`}>
                            <input type="number" value={v || ""} placeholder={inRange ? "" : "·"}
                              onChange={(e) => setCell(a.segmentId, d.date, Number(e.target.value))}
                              className={`w-[42px] py-1 text-center text-[11px] outline-none bg-transparent focus:bg-blue-100 ${v > 0 ? "text-blue-700 font-medium bg-blue-50/60" : "text-gray-300"}`} />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 font-medium">
                  <td colSpan={2} className="sticky left-0 z-10 bg-gray-50 border-t border-r border-gray-200 px-3 py-2 text-gray-600">일 합계 (%)</td>
                  {days.map((d) => {
                    const t = Math.round(dayTotal(d.date) * 10) / 10;
                    return (
                      <td key={d.date} className={`border-t border-gray-200 px-1 py-2 text-center ${t > 100 ? "bg-red-100 text-red-600" : t > 0 ? "text-gray-700" : "text-gray-300"} ${d.isWeekend || d.isHoliday ? "bg-gray-100" : ""}`}>
                        {t || ""}
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
