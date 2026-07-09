"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { expenseApi } from "@/lib/api";
import HomeCard from "./HomeCard";

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
    <HomeCard icon="💳" title="경비" href={link} hrefLabel="경비정산" loading={loading}>
      <div className="space-y-1.5">
        <Row label="미정산분류" count={s?.unclassified ?? 0} href={link} />
        <Row label="미결재"     count={s?.unapproved ?? 0}  href={link} />
        <Row label="정산됨"     count={s?.settled ?? 0}     href={link} />
        <Row label="입금완료"   count={s?.paid ?? 0}        href={link} />
      </div>
    </HomeCard>
  );
}

function Row({ label, count, href }: { label: string; count: number; href: string }) {
  return (
    <Link href={href} className="flex items-center justify-between text-sm hover:bg-gray-50 dark:hover:bg-gray-500/10 px-2 py-1 rounded -mx-2">
      <span className="text-gray-600">{label}</span>
      <span className={`tabular-nums font-semibold ${count > 0 ? "text-blue-600 dark:text-blue-400" : "text-gray-400"}`}>{count}</span>
    </Link>
  );
}
