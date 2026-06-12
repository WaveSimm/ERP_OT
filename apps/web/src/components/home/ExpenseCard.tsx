"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { expenseApi } from "@/lib/api";

interface Summary { unclassified: number; unsettled: number; unapproved: number; settled: number; paid: number }

export default function ExpenseCard() {
  const [s, setS] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    expenseApi.meSummary()
      .then((r: any) => setS(r))
      .catch(() => setS({ unclassified: 0, unsettled: 0, unapproved: 0, settled: 0, paid: 0 }))
      .finally(() => setLoading(false));
  }, []);

  const link = "/me/dashboard?tab=expense";

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-gray-700">💳 경비</h3>
        <Link href={link} className="text-xs text-blue-600 hover:underline">경비정산 →</Link>
      </div>
      {loading ? (
        <div className="text-xs text-gray-400">불러오는 중...</div>
      ) : (
        <div className="space-y-1.5">
          <Row label="미정산분류" count={s?.unclassified ?? 0} href={link} />
          <Row label="미결재"     count={s?.unapproved ?? 0}  href={link} />
          <Row label="정산됨"     count={s?.settled ?? 0}     href={link} />
          <Row label="입금완료"   count={s?.paid ?? 0}        href={link} />
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
