"use client";

import { useState, useEffect } from "react";
import { teamApi, getUser } from "@/lib/api";
import { useRouter } from "next/navigation";

const APPROVAL_STATUS: Record<string, { label: string; color: string }> = {
  PENDING:   { label: "대기",  color: "text-amber-600 bg-amber-50" },
  APPROVED:  { label: "승인",  color: "text-green-600 bg-green-50" },
  REJECTED:  { label: "반려",  color: "text-red-600 bg-red-50" },
  CANCELLED: { label: "취소",  color: "text-gray-500 bg-gray-50" },
  DONE:      { label: "완료",  color: "text-blue-600 bg-blue-50" },
};

const LEAVE_TYPES: Record<string, string> = {
  ANNUAL: "연차", SICK: "병가", HALF_AM: "반차(오전)", HALF_PM: "반차(오후)",
  SPECIAL: "특별휴가", UNPAID: "무급",
};

function fmtMinutes(mins: number) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}분`;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}

function RejectModal({ onConfirm, onClose }: { onConfirm: (reason: string) => void; onClose: () => void }) {
  const [reason, setReason] = useState("");
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl p-5 w-80" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-gray-900 mb-3 text-sm">반려 사유</h3>
        <input
          type="text" value={reason} placeholder="반려 사유를 입력하세요"
          onChange={(e) => setReason(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 mb-3"
          autoFocus
        />
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">취소</button>
          <button
            onClick={() => reason.trim() && onConfirm(reason)}
            disabled={!reason.trim()}
            className="flex-1 bg-red-600 text-white px-3 py-2 rounded-lg text-sm font-semibold hover:bg-red-700 disabled:opacity-50"
          >
            반려
          </button>
        </div>
      </div>
    </div>
  );
}

function PendingApprovals() {
  const [leaveItems, setLeaveItems] = useState<any[]>([]);
  const [otItems, setOtItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [rejectTarget, setRejectTarget] = useState<{ type: "leave" | "ot"; id: string } | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([teamApi.getPendingLeave(), teamApi.getPendingOT()])
      .then(([l, o]) => { setLeaveItems(l); setOtItems(o); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const approveLeave = async (id: string) => {
    await teamApi.approveLeave(id);
    setLeaveItems((prev) => prev.filter((i) => i.id !== id));
  };

  const rejectLeave = async (id: string, reason: string) => {
    await teamApi.rejectLeave(id, reason);
    setLeaveItems((prev) => prev.filter((i) => i.id !== id));
    setRejectTarget(null);
  };

  const approveOT = async (id: string) => {
    await teamApi.approveOT(id);
    setOtItems((prev) => prev.filter((i) => i.id !== id));
  };

  const rejectOT = async (id: string, reason: string) => {
    await teamApi.rejectOT(id, reason);
    setOtItems((prev) => prev.filter((i) => i.id !== id));
    setRejectTarget(null);
  };

  if (loading) return <div className="text-sm text-gray-400 py-4 text-center">불러오는 중...</div>;

  const total = leaveItems.length + otItems.length;

  return (
    <div className="space-y-3">
      {total === 0 && <div className="text-sm text-gray-400 text-center py-6">승인 대기 항목이 없습니다.</div>}

      {leaveItems.map((item) => (
        <div key={item.id} className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-sm font-semibold text-gray-900">{item.user?.name ?? "사용자"}</span>
              <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">{LEAVE_TYPES[item.leaveType] ?? item.leaveType}</span>
            </div>
            <div className="text-xs text-gray-500">{item.startDate?.slice(0, 10)} ~ {item.endDate?.slice(0, 10)} · {item.reason}</div>
          </div>
          <div className="flex gap-1.5 shrink-0">
            <button
              onClick={() => approveLeave(item.id)}
              className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700"
            >
              승인
            </button>
            <button
              onClick={() => setRejectTarget({ type: "leave", id: item.id })}
              className="px-3 py-1.5 bg-red-50 text-red-600 border border-red-200 rounded-lg text-xs font-medium hover:bg-red-100"
            >
              반려
            </button>
          </div>
        </div>
      ))}

      {otItems.map((item) => (
        <div key={item.id} className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-sm font-semibold text-gray-900">{item.user?.name ?? "사용자"}</span>
              <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">OT</span>
            </div>
            <div className="text-xs text-gray-500">{item.date?.slice(0, 10)} · {item.plannedHours}h 예정 · {item.reason}</div>
          </div>
          <div className="flex gap-1.5 shrink-0">
            <button
              onClick={() => approveOT(item.id)}
              className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700"
            >
              승인
            </button>
            <button
              onClick={() => setRejectTarget({ type: "ot", id: item.id })}
              className="px-3 py-1.5 bg-red-50 text-red-600 border border-red-200 rounded-lg text-xs font-medium hover:bg-red-100"
            >
              반려
            </button>
          </div>
        </div>
      ))}

      {rejectTarget && (
        <RejectModal
          onClose={() => setRejectTarget(null)}
          onConfirm={(reason) => {
            if (rejectTarget.type === "leave") rejectLeave(rejectTarget.id, reason);
            else rejectOT(rejectTarget.id, reason);
          }}
        />
      )}
    </div>
  );
}

function TeamAttendanceTable() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    teamApi.getAttendance(year, month)
      .then(setMembers)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [year, month]);

  const navigateMonth = (dir: -1 | 1) => {
    let m = month + dir;
    let y = year;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    setYear(y);
    setMonth(m);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-900">팀원 월간 근태</h2>
        <div className="flex items-center gap-2">
          <button onClick={() => navigateMonth(-1)} className="p-1 text-gray-400 hover:text-gray-700 border border-gray-200 rounded">‹</button>
          <span className="text-sm text-gray-700">{year}년 {month}월</span>
          <button onClick={() => navigateMonth(1)} className="p-1 text-gray-400 hover:text-gray-700 border border-gray-200 rounded">›</button>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-gray-400 text-center py-6">불러오는 중...</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">이름</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500">출근</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-orange-500">지각</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-red-500">결근</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-blue-500">휴가</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500">총 근무</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-purple-500">OT</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {members.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-400 text-xs">팀원 데이터가 없습니다.</td>
                </tr>
              )}
              {members.map((m: any) => (
                <tr key={m.userId} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{m.name}</td>
                  <td className="px-4 py-3 text-center text-gray-700">{m.normalCount ?? 0}</td>
                  <td className="px-4 py-3 text-center text-orange-600">{m.lateCount ?? 0}</td>
                  <td className="px-4 py-3 text-center text-red-600">{m.absentCount ?? 0}</td>
                  <td className="px-4 py-3 text-center text-blue-600">{m.leaveCount ?? 0}</td>
                  <td className="px-4 py-3 text-center text-gray-700">{fmtMinutes(m.totalWorkMinutes ?? 0)}</td>
                  <td className="px-4 py-3 text-center text-purple-600">{(m.totalOtHours ?? 0).toFixed(1)}h</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function TeamPage() {
  const router = useRouter();
  const user = getUser();
  const [activeTab, setActiveTab] = useState<"pending" | "attendance">("pending");

  if (!user || !["ADMIN", "MANAGER"].includes(user.role)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3">
        <div className="text-gray-400">접근 권한이 없습니다.</div>
        <button onClick={() => router.push("/me/dashboard")} className="text-sm text-blue-600 hover:underline">
          대시보드로 이동
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <h1 className="text-xl font-bold text-gray-900">팀 관리</h1>

      <div className="flex items-center gap-1">
        <button
          onClick={() => setActiveTab("pending")}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === "pending" ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"}`}
        >
          승인 대기
        </button>
        <button
          onClick={() => setActiveTab("attendance")}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === "attendance" ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"}`}
        >
          팀원 근태
        </button>
      </div>

      {activeTab === "pending" && <PendingApprovals />}
      {activeTab === "attendance" && <TeamAttendanceTable />}
    </div>
  );
}
