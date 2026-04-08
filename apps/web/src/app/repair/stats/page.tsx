"use client";

import { useState, useEffect } from "react";
import { repairApi } from "@/lib/api";

const COST_LABELS: Record<string, string> = {
  DIRECT_EXPENSE: "직접경비", LABOR: "공수", OVERSEAS_SHIPPING: "해외발송비", PARTS: "부품비", OTHER: "기타",
};

export default function RepairStatsPage() {
  const [summary, setSummary] = useState<any>(null);
  const [monthly, setMonthly] = useState<any[]>([]);
  const [costs, setCosts] = useState<any>(null);
  const [partsUsage, setPartsUsage] = useState<any[]>([]);
  const [byEquipment, setByEquipment] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      repairApi.getRepairStatsSummary(),
      repairApi.getRepairStatsMonthly(12),
      repairApi.getRepairStatsCosts(),
      repairApi.getRepairStatsPartsUsage(),
      repairApi.getRepairStatsByEquipment(),
    ]).then(([s, m, c, p, e]) => {
      setSummary(s);
      setMonthly(m);
      setCosts(c);
      setPartsUsage(p);
      setByEquipment(e);
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="py-12 text-center text-gray-400">통계 불러오는 중...</div>;

  return (
    <div className="space-y-4">
      {/* 요약 카드 */}
      {summary && (
        <div className="grid grid-cols-5 gap-3">
          <StatCard label="전체 AS" value={summary.total} />
          <StatCard label="진행 중" value={summary.inProgress} color="text-orange-600" />
          <StatCard label="완료" value={summary.completed + summary.closed} color="text-green-600" />
          <StatCard label="취소" value={summary.cancelled} color="text-red-600" />
          <StatCard label="평균 수리일" value={`${summary.avgRepairDays}일`} color="text-blue-600" />
        </div>
      )}

      {/* 상세 현황 */}
      {summary && (
        <div className="bg-white border border-gray-200 rounded-lg p-5">
          <h3 className="font-semibold text-sm text-gray-800 mb-3">상태별 현황</h3>
          <div className="grid grid-cols-4 gap-3">
            <MiniStat label="접수" value={summary.received} />
            <MiniStat label="점검중" value={summary.inspecting} />
            <MiniStat label="수리중" value={summary.repairing} />
            <MiniStat label="제조사" value={summary.manufacturer} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        {/* 월별 추이 */}
        <div className="bg-white border border-gray-200 rounded-lg p-5">
          <h3 className="font-semibold text-sm text-gray-800 mb-3">월별 AS 접수/완료</h3>
          {monthly.length > 0 ? (
            <div className="space-y-1">
              {monthly.map((m) => {
                const max = Math.max(...monthly.map((x) => Math.max(x.received, x.completed)), 1);
                return (
                  <div key={m.month} className="flex items-center gap-2 text-xs">
                    <span className="w-16 text-gray-500">{m.month}</span>
                    <div className="flex-1 flex gap-1">
                      <div className="h-4 bg-blue-400 rounded-sm" style={{ width: `${(m.received / max) * 100}%`, minWidth: m.received > 0 ? 4 : 0 }} />
                      <div className="h-4 bg-green-400 rounded-sm" style={{ width: `${(m.completed / max) * 100}%`, minWidth: m.completed > 0 ? 4 : 0 }} />
                    </div>
                    <span className="w-16 text-right text-gray-600">{m.received}/{m.completed}</span>
                  </div>
                );
              })}
              <div className="flex items-center gap-3 mt-2 text-[10px] text-gray-500">
                <span className="flex items-center gap-1"><span className="w-3 h-2 bg-blue-400 rounded-sm inline-block" />접수</span>
                <span className="flex items-center gap-1"><span className="w-3 h-2 bg-green-400 rounded-sm inline-block" />완료</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-400">데이터가 없습니다.</p>
          )}
        </div>

        {/* 비용 분석 */}
        <div className="bg-white border border-gray-200 rounded-lg p-5">
          <h3 className="font-semibold text-sm text-gray-800 mb-3">비용 분석</h3>
          {costs && costs.byType?.length > 0 ? (
            <>
              <div className="space-y-2 mb-3">
                {costs.byType.map((c: any) => (
                  <div key={c.costType} className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">{COST_LABELS[c.costType] || c.costType} ({c.count}건)</span>
                    <span className="font-medium">{c.totalAmount.toLocaleString()} KRW</span>
                  </div>
                ))}
              </div>
              <div className="border-t border-gray-200 pt-2 flex justify-between text-sm font-bold">
                <span>합계</span>
                <span className="text-blue-600">{costs.totalAmount.toLocaleString()} KRW</span>
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-400">비용 데이터가 없습니다.</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* 장비별 고장 건수 */}
        <div className="bg-white border border-gray-200 rounded-lg p-5">
          <h3 className="font-semibold text-sm text-gray-800 mb-3">장비별 AS 건수</h3>
          {byEquipment.length > 0 ? (
            <div className="space-y-2">
              {byEquipment.slice(0, 10).map((e, i) => {
                const max = byEquipment[0]?.count || 1;
                return (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-32 text-xs text-gray-600 truncate">{e.asset?.name || "알 수 없음"}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-4">
                      <div className="h-4 bg-red-400 rounded-full text-[9px] text-white flex items-center justify-end pr-1"
                        style={{ width: `${(e.count / max) * 100}%`, minWidth: 20 }}>
                        {e.count}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-gray-400">데이터가 없습니다.</p>
          )}
        </div>

        {/* 부품 소모 TOP */}
        <div className="bg-white border border-gray-200 rounded-lg p-5">
          <h3 className="font-semibold text-sm text-gray-800 mb-3">부품 소모 TOP 10</h3>
          {partsUsage.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="py-1.5 text-left text-xs text-gray-500">부품번호</th>
                  <th className="py-1.5 text-left text-xs text-gray-500">이름</th>
                  <th className="py-1.5 text-right text-xs text-gray-500">소모량</th>
                  <th className="py-1.5 text-right text-xs text-gray-500">현 재고</th>
                </tr>
              </thead>
              <tbody>
                {partsUsage.map((p, i) => (
                  <tr key={i} className="border-t border-gray-100">
                    <td className="py-1.5 text-gray-700">{p.part?.partNumber || "-"}</td>
                    <td className="py-1.5">{p.part?.name || "-"}</td>
                    <td className="py-1.5 text-right font-medium text-red-600">{p.usedQuantity}</td>
                    <td className={`py-1.5 text-right font-medium ${
                      p.part && p.part.stockQuantity <= p.part.minStockLevel ? "text-red-600" : "text-gray-700"
                    }`}>{p.part?.stockQuantity ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-gray-400">부품 소모 데이터가 없습니다.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 text-center">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color || "text-gray-800"}`}>{value}</p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center p-2 bg-gray-50 rounded">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-lg font-semibold text-gray-700">{value}</p>
    </div>
  );
}
