"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { expenseApi } from "@/lib/api";

export default function ExpenseCard() {
  const [s, setS] = useState<{ unmatched: number; pendingApproval: number; awaitingPayment: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    expenseApi.meSummary()
      .then((r) => setS(r))
      .catch(() => setS({ unmatched: 0, pendingApproval: 0, awaitingPayment: 0 }))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-gray-700">💳 경비</h3>
        <Link href="/expense" className="text-xs text-blue-600 hover:underline">경비정산 →</Link>
      </div>
      {loading ? (
        <div className="text-xs text-gray-400">불러오는 중...</div>
      ) : (
        <div className="space-y-1.5">
          <Row label="미정산 거래" count={s?.unmatched ?? 0} href="/expense/transactions?status=PENDING" />
          <Row label="결재 진행 중" count={s?.pendingApproval ?? 0} href="/expense/settlements?status=SUBMITTED" />
          <Row label="입금 대기" count={s?.awaitingPayment ?? 0} href="/expense/settlements?status=APPROVED" />
        </div>
      )}
    </div>
  );
}

function Row({ label, count, href }: { label: string; count: number; href: string }) {
  return (
    <Link href={href} className="flex items-center justify-between text-sm hover:bg-gray-50 px-2 py-1 rounded -mx-2">
      <span className="text-gray-600">{label}</span>
      <span className={`tabular-nums font-semibold ${count > 0 ? "text-blue-600" : "text-gray-400"}`}>{count}</span>
    </Link>
  );
}
