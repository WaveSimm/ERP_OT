"use client";

import { useEffect, useState } from "react";
import { equipmentStatsApi } from "@/lib/api";
import { DateInput } from "@/components/ui/DateInput";

const SEVERITY_LABELS: Record<string, { label: string; color: string }> = {
  EXPIRED: { label: "만료", color: "bg-red-100 text-red-700" },
  URGENT: { label: "긴급 (D-7)", color: "bg-orange-100 text-orange-700" },
  WARNING: { label: "주의 (D-30)", color: "bg-yellow-100 text-yellow-700" },
};

export default function EquipmentStatsPage() {
  const [summary, setSummary] = useState<any>(null);
  const [utilization, setUtilization] = useState<any[]>([]);
  const [costs, setCosts] = useState<any[]>([]);
  const [breakdowns, setBreakdowns] = useState<any[]>([]);
  const [calibrations, setCalibrations] = useState<any[]>([]);
  const [preventiveDue, setPreventiveDue] = useState<any[]>([]);
  const [period, setPeriod] = useState(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    return {
      startDate: start.toISOString().slice(0, 10),
      endDate: now.toISOString().slice(0, 10),
    };
  });

  useEffect(() => {
    equipmentStatsApi.summary().then(setSummary).catch(() => {});
    equipmentStatsApi.calibrationWarnings().then(setCalibrations).catch(() => {});
    equipmentStatsApi.breakdownFrequency().then(setBreakdowns).catch(() => {});
    equipmentStatsApi.preventiveDue().then(setPreventiveDue).catch(() => {});
  }, []);

  useEffect(() => {
    equipmentStatsApi.utilization(period.startDate, period.endDate).then(setUtilization).catch(() => {});
    equipmentStatsApi.maintenanceCosts(period.startDate, period.endDate).then(setCosts).catch(() => {});
  }, [period]);

  const eqTotal = summary ? Object.values(summary.equipment as Record<string, number>).reduce((a, b) => a + b, 0) : 0;
  const sTotal = summary ? Object.values(summary.sensors as Record<string, number>).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">장비/센서 통계</h1>

        {/* 요약 카드 */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Card label="장비 총 수" value={eqTotal} sub={`가용 ${summary.equipment.AVAILABLE ?? 0}`} color="blue" />
            <Card label="센서 총 수" value={sTotal} sub={`가용 ${summary.sensors.AVAILABLE ?? 0}`} color="green" />
            <Card label="투입 진행중" value={summary.activeDeployments} color="indigo" />
            <Card label="교정 경고" value={summary.calibrationWarnings} sub={`긴급 ${summary.urgentCalibrations}`} color={summary.urgentCalibrations > 0 ? "red" : "yellow"} />
            <Card label="고장 장비" value={(summary.equipment.BROKEN ?? 0) + (summary.sensors.BROKEN ?? 0)} color="red" />
          </div>
        )}

        {/* 기간 선택 */}
        <div className="flex items-center gap-3 bg-white border rounded-lg p-3">
          <span className="text-sm font-medium text-gray-600">기간:</span>
          <DateInput value={period.startDate} onChange={(e) => setPeriod({ ...period, startDate: e.target.value })}
            className="border rounded px-3 py-1.5 text-sm" />
          <span className="text-gray-400">~</span>
          <DateInput value={period.endDate} onChange={(e) => setPeriod({ ...period, endDate: e.target.value })}
            className="border rounded px-3 py-1.5 text-sm" />
        </div>

        {/* 가동률 */}
        <div className="bg-white border rounded-lg p-4">
          <h2 className="font-semibold mb-3">장비 가동률</h2>
          {utilization.length === 0 ? (
            <div className="text-center py-6 text-gray-400 text-sm">데이터 없음</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="p-2 text-left">장비명</th>
                  <th className="p-2 text-left">종류</th>
                  <th className="p-2 text-left">상태</th>
                  <th className="p-2 text-right">운용일수</th>
                  <th className="p-2 text-right">가동률</th>
                  <th className="p-2 text-left w-48">바</th>
                </tr>
              </thead>
              <tbody>
                {utilization.map((u) => (
                  <tr key={u.id} className="border-t">
                    <td className="p-2 font-medium">{u.name}</td>
                    <td className="p-2 text-gray-500">{u.category}</td>
                    <td className="p-2">{u.status}</td>
                    <td className="p-2 text-right">{u.operatingDays}일 / {u.totalDays}일</td>
                    <td className="p-2 text-right font-medium">{u.utilizationRate}%</td>
                    <td className="p-2">
                      <div className="w-full bg-gray-100 rounded-full h-4">
                        <div className={`h-4 rounded-full ${u.utilizationRate >= 70 ? "bg-blue-500" : u.utilizationRate >= 30 ? "bg-yellow-400" : "bg-gray-300"}`}
                          style={{ width: `${u.utilizationRate}%` }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* 정비 비용 */}
          <div className="bg-white border rounded-lg p-4">
            <h2 className="font-semibold mb-3">정비 비용 (기간 내)</h2>
            {costs.length === 0 ? (
              <div className="text-center py-6 text-gray-400 text-sm">데이터 없음</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr><th className="p-2 text-left">자산명</th><th className="p-2 text-left">구분</th><th className="p-2 text-right">건수</th><th className="p-2 text-right">비용</th></tr>
                </thead>
                <tbody>
                  {costs.map((c) => (
                    <tr key={c.id} className="border-t">
                      <td className="p-2 font-medium">{c.name}</td>
                      <td className="p-2 text-gray-500">{c.type === "EQUIPMENT" ? "장비" : "센서"}</td>
                      <td className="p-2 text-right">{c.count}건</td>
                      <td className="p-2 text-right font-medium">{c.totalCost.toLocaleString()}원</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* 고장 빈도 */}
          <div className="bg-white border rounded-lg p-4">
            <h2 className="font-semibold mb-3">고장 빈도 Top-10</h2>
            {breakdowns.length === 0 ? (
              <div className="text-center py-6 text-gray-400 text-sm">고장 이력 없음</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr><th className="p-2 text-left">자산명</th><th className="p-2 text-left">구분</th><th className="p-2 text-right">수리 횟수</th></tr>
                </thead>
                <tbody>
                  {breakdowns.map((b) => (
                    <tr key={b.id} className="border-t">
                      <td className="p-2 font-medium">{b.name}</td>
                      <td className="p-2 text-gray-500">{b.type === "EQUIPMENT" ? "장비" : "센서"}</td>
                      <td className="p-2 text-right font-medium text-red-600 dark:text-red-400">{b.count}회</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* 예방 정비 예정 */}
        {preventiveDue.length > 0 && (
          <div className="bg-white border rounded-lg p-4">
            <h2 className="font-semibold mb-3">예방 정비 예정 (D-30 이내)</h2>
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="p-2 text-left">장비명</th>
                  <th className="p-2 text-left">종류</th>
                  <th className="p-2 text-left">최근 정비</th>
                  <th className="p-2 text-right">주기</th>
                  <th className="p-2 text-left">다음 예정일</th>
                  <th className="p-2 text-right">잔여일</th>
                </tr>
              </thead>
              <tbody>
                {preventiveDue.map((p) => (
                  <tr key={p.id} className="border-t">
                    <td className="p-2 font-medium">{p.name}</td>
                    <td className="p-2 text-gray-500">{p.category}</td>
                    <td className="p-2">{p.lastPreventive ? new Date(p.lastPreventive).toLocaleDateString() : "미실시"}</td>
                    <td className="p-2 text-right">{p.intervalDays}일</td>
                    <td className="p-2">{new Date(p.nextDue).toLocaleDateString()}</td>
                    <td className="p-2 text-right">
                      <span className={p.daysUntilDue <= 0 ? "text-red-600 font-semibold dark:text-red-400" : p.daysUntilDue <= 7 ? "text-orange-600 font-semibold dark:text-orange-400" : ""}>
                        {p.daysUntilDue <= 0 ? "기한 초과" : `D-${p.daysUntilDue}`}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 교정 경고 */}
        <div className="bg-white border rounded-lg p-4">
          <h2 className="font-semibold mb-3">센서 교정 경고 (D-30 이내)</h2>
          {calibrations.length === 0 ? (
            <div className="text-center py-6 text-gray-400 text-sm">교정 예정 센서 없음</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="p-2 text-left">센서명</th>
                  <th className="p-2 text-left">종류</th>
                  <th className="p-2 text-left">상태</th>
                  <th className="p-2 text-left">교정 만료일</th>
                  <th className="p-2 text-right">잔여일</th>
                  <th className="p-2 text-center">긴급도</th>
                </tr>
              </thead>
              <tbody>
                {calibrations.map((c) => {
                  const sev = SEVERITY_LABELS[c.severity] ?? { label: c.severity, color: "bg-gray-100" };
                  return (
                    <tr key={c.id} className="border-t">
                      <td className="p-2 font-medium">{c.name}</td>
                      <td className="p-2 text-gray-500">{c.category}</td>
                      <td className="p-2">{c.status}</td>
                      <td className="p-2">{new Date(c.nextCalibrationDue).toLocaleDateString()}</td>
                      <td className="p-2 text-right font-medium">{c.daysRemaining <= 0 ? "만료" : `D-${c.daysRemaining}`}</td>
                      <td className="p-2 text-center"><span className={`text-xs px-2 py-0.5 rounded-full ${sev.color}`}>{sev.label}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
    </div>
  );
}

function Card({ label, value, sub, color }: { label: string; value: number; sub?: string; color: string }) {
  const colorMap: Record<string, string> = {
    blue: "bg-blue-50 border-blue-200",
    green: "bg-green-50 border-green-200",
    indigo: "bg-indigo-50 border-indigo-200 dark:bg-indigo-950 dark:border-indigo-900",
    yellow: "bg-yellow-50 border-yellow-200",
    red: "bg-red-50 border-red-200",
  };
  return (
    <div className={`border rounded-lg p-4 ${colorMap[color] ?? "bg-gray-50"}`}>
      <div className="text-sm text-gray-500">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  );
}
