"use client";

// 관리>근태현황 — 전 직원 휴가·휴일근무의 ecount(외부 전자결재) 결재 확인 + 전사근태 조회.
//   체크 권한/목록 조회는 attendance-admin API(관리부서 게이트)가 담당.
import { useCallback, useEffect, useState } from "react";
import { attendanceAdminApi, type ApprovalCheckRow } from "@/lib/api";
import { useHolidaysMap } from "@/hooks/useHolidaysMap";
import AttendanceOverview from "@/components/AttendanceOverview";
import { fmtDateTime24 } from "@/lib/datetime";

const TYPE_LABELS: Record<string, string> = {
  ANNUAL: "연차", HALF: "반차", QUARTER: "1/4연차",
  FAMILY_DAY: "가정의날(1h)", FAMILY_DAY_2H: "가정의날(2h)",
  BEREAVEMENT: "경조사", SICK: "병가", SPECIAL: "공가",
  SUBSTITUTE: "연차대체", HOLIDAY_WORK: "휴일근무",
};
const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  PENDING:     { label: "대기",   cls: "bg-gray-100 text-gray-600" },
  PENDING_2ND: { label: "2차대기", cls: "bg-gray-100 text-gray-600" },
  PENDING_3RD: { label: "3차대기", cls: "bg-gray-100 text-gray-600" },
  APPROVED:    { label: "승인",   cls: "bg-blue-100 text-blue-700" },
  COMPLETED:   { label: "완료",   cls: "bg-blue-100 text-blue-700" },
  REJECTED:    { label: "반려",   cls: "bg-red-100 text-red-600" },
  CANCELLED:   { label: "취소",   cls: "bg-gray-100 text-gray-400" },
};

export default function ManagementAttendancePage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [rows, setRows] = useState<ApprovalCheckRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uncheckedOnly, setUncheckedOnly] = useState(false);
  const [saving, setSaving] = useState<string | null>(null); // 저장 중인 row id
  const holidays = useHolidaysMap();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await attendanceAdminApi.listApprovalChecks(year, month);
      setRows(data.rows);
    } catch (e) { alert(e instanceof Error ? e.message : "로드 실패"); }
    finally { setLoading(false); }
  }, [year, month]);
  useEffect(() => { load(); }, [load]);

  const shiftMonth = (dir: -1 | 1) => {
    const d = new Date(year, month - 1 + dir, 1);
    setYear(d.getFullYear()); setMonth(d.getMonth() + 1);
  };

  const toggle = async (r: ApprovalCheckRow) => {
    const next = !r.ecountCheckedAt;
    setSaving(r.id);
    try {
      const res = await attendanceAdminApi.setEcountCheck(r.kind, r.id, next);
      setRows((prev) => prev.map((x) => x.id === r.id && x.kind === r.kind
        ? { ...x, ecountCheckedAt: res.ecountCheckedAt, ecountCheckedById: res.ecountCheckedById, ecountCheckedByName: next ? "나" : null }
        : x));
    } catch (e) { alert(e instanceof Error ? e.message : "저장 실패"); }
    finally { setSaving(null); }
  };

  const visible = uncheckedOnly ? rows.filter((r) => !r.ecountCheckedAt) : rows;
  const uncheckedCount = rows.filter((r) => !r.ecountCheckedAt).length;
  const period = (r: ApprovalCheckRow) =>
    r.startDate === r.endDate ? r.startDate : `${r.startDate} ~ ${r.endDate}`;

  return (
    <div className="pb-10">
      {/* 월 선택 + 요약 */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <button onClick={() => shiftMonth(-1)} className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50">◀</button>
        <span className="text-lg font-semibold text-gray-800 min-w-[110px] text-center">{year}년 {month}월</span>
        <button onClick={() => shiftMonth(1)} className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50">▶</button>
        <span className="text-sm text-gray-500">휴가·휴일근무 <b>{rows.length}</b>건 · ecount 미확인 <b className={uncheckedCount ? "text-red-600" : "text-gray-700"}>{uncheckedCount}</b>건</span>
        <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer ml-2">
          <input type="checkbox" checked={uncheckedOnly} onChange={(e) => setUncheckedOnly(e.target.checked)} className="rounded" />
          미확인만 보기
        </label>
      </div>

      {/* ecount 결재 확인 테이블 */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto mb-8">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-gray-500 text-xs [&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:border-b [&>th]:border-gray-200">
              <th className="w-24">ecount 확인</th>
              <th>부서</th>
              <th>이름</th>
              <th>구분</th>
              <th>기간</th>
              <th className="text-right">일수</th>
              <th>ERP 결재</th>
              <th>확인자 · 확인일시</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="py-12 text-center text-gray-400">불러오는 중…</td></tr>
            ) : visible.length === 0 ? (
              <tr><td colSpan={8} className="py-12 text-center text-gray-400">{uncheckedOnly ? "미확인 건이 없습니다 🎉" : "해당 월에 휴가·휴일근무 신청이 없습니다."}</td></tr>
            ) : visible.map((r) => {
              const st = STATUS_LABELS[r.status] ?? { label: r.status, cls: "bg-gray-100 text-gray-500" };
              const checked = !!r.ecountCheckedAt;
              return (
                <tr key={`${r.kind}:${r.id}`} className={`border-b border-gray-50 hover:bg-blue-50/30 ${checked ? "" : "bg-amber-50/40"}`}>
                  <td className="px-3 py-2">
                    <label className="flex items-center gap-1.5 cursor-pointer select-none">
                      <input type="checkbox" checked={checked} disabled={saving === r.id}
                        onChange={() => toggle(r)} className="w-4 h-4 rounded accent-blue-600" />
                      <span className={`text-xs ${checked ? "text-blue-600 font-medium" : "text-gray-400"}`}>{checked ? "확인" : "미확인"}</span>
                    </label>
                  </td>
                  <td className="px-3 py-2 text-gray-500">{r.departmentName ?? "—"}</td>
                  <td className="px-3 py-2 font-medium text-gray-800">{r.userName}</td>
                  <td className="px-3 py-2">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${r.kind === "HOLIDAY_WORK" ? "bg-purple-100 text-purple-700" : "bg-amber-100 text-amber-700"}`}>
                      {TYPE_LABELS[r.type] ?? r.type}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{period(r)}{r.startTime ? ` ${r.startTime}~` : ""}</td>
                  <td className="px-3 py-2 text-right text-gray-600">{r.days ?? "—"}</td>
                  <td className="px-3 py-2"><span className={`text-xs px-1.5 py-0.5 rounded ${st.cls}`}>{st.label}</span></td>
                  <td className="px-3 py-2 text-xs text-gray-400">
                    {r.ecountCheckedAt ? `${r.ecountCheckedByName ?? ""} · ${fmtDateTime24(r.ecountCheckedAt, { short: true })}` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 전사근태 (월간 현황) */}
      <h2 className="text-base font-semibold text-gray-800 mb-3">전사근태</h2>
      <AttendanceOverview holidays={holidays} />
    </div>
  );
}
