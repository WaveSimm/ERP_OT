"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { expenseApi } from "@/lib/api";
import { fmtDate } from "@/lib/datetime";
import { SettlementStatusBadge } from "./_components/settlement-status-badge";

interface Summary { unmatched: number; pendingApproval: number; awaitingPayment: number }

export default function ExpenseDashboardPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [recentSettlements, setRecentSettlements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      expenseApi.meSummary().catch(() => ({ unmatched: 0, pendingApproval: 0, awaitingPayment: 0 })),
      expenseApi.listSettlements({ limit: 5 }).catch(() => ({ items: [] as any[] })),
    ]).then(([sum, sts]) => {
      setSummary(sum as Summary);
      setRecentSettlements(sts.items);
      setLoading(false);
    });
  }, []);

  return (
    <div className="max-w-6xl mx-auto px-6 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">💳 경비 정산</h1>
      </div>

      {/* 요약 카드 3종 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SummaryCard label="미정산 거래" count={summary?.unmatched ?? 0} color="amber" href="/expense/transactions?status=PENDING" />
        <SummaryCard label="결재 진행 중" count={summary?.pendingApproval ?? 0} color="blue" href="/expense/settlements?status=SUBMITTED" />
        <SummaryCard label="입금 대기" count={summary?.awaitingPayment ?? 0} color="green" href="/expense/settlements?status=APPROVED" />
      </div>

      {/* 빠른 작업 */}
      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <h2 className="text-sm font-bold text-gray-700 mb-3">빠른 작업</h2>
        <div className="flex flex-wrap gap-2">
          <Link href="/expense/transactions" className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50">📋 거래 입력·관리</Link>
          <Link href="/expense/receipts" className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50">🧾 영수증 업로드</Link>
          <Link href="/expense/settlements" className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50">📦 정산목록관리</Link>
          <Link href="/expense/sources" className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50">💳 카드 관리</Link>
        </div>
      </div>

      {/* 최근 정산 */}
      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-gray-700">최근 정산</h2>
          <Link href="/expense/settlements" className="text-xs text-blue-600 dark:text-blue-400 hover:underline">모두 보기 →</Link>
        </div>
        {loading ? (
          <div className="py-8 text-center text-gray-400 text-sm">불러오는 중...</div>
        ) : recentSettlements.length === 0 ? (
          <div className="py-8 text-center text-gray-400 text-sm">아직 작성된 정산이 없습니다.</div>
        ) : (
          <div className="space-y-2">
            {recentSettlements.map((s) => (
              <Link key={s.id} href={`/expense/settlements/${s.id}`}
                className="flex items-center justify-between px-3 py-2 hover:bg-gray-50 rounded-md transition-colors">
                <div>
                  <div className="text-sm font-medium text-gray-900">{s.title}</div>
                  <div className="text-xs text-gray-500">
                    {fmtDate(s.periodStart)} ~ {fmtDate(s.periodEnd)} · {s.totalCount ?? 0}건
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold tabular-nums">
                    {Number(s.totalAmount ?? 0).toLocaleString()}원
                  </span>
                  <SettlementStatusBadge status={s.status} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ label, count, color, href }: { label: string; count: number; color: "amber" | "blue" | "green"; href: string }) {
  const colorMap = {
    amber: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:text-amber-300",
    blue: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:text-blue-300",
    green: "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:text-green-300",
  };
  return (
    <Link href={href} className={`block border rounded-lg p-5 hover:shadow-md transition-shadow ${colorMap[color]}`}>
      <div className="text-xs font-medium opacity-80">{label}</div>
      <div className="text-3xl font-bold mt-1 tabular-nums">{count}</div>
    </Link>
  );
}
