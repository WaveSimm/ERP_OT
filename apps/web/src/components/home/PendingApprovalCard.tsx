"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import HomeCard from "./HomeCard";
import { approvalApi } from "@/lib/api";

export default function PendingApprovalCard() {
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    approvalApi
      .getPendingDocuments(1, 5)
      .then((res: any) => {
        if (!cancelled) {
          setItems(res.items ?? res.documents ?? []);
          setTotal(res.total ?? (res.items?.length ?? 0));
        }
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <HomeCard
      icon="📝"
      title="결재 대기"
      href="/approval"
      hrefLabel="결재함"
      badge={
        total > 0 ? (
          <span className="bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 min-w-[16px] text-center">
            {total > 99 ? "99+" : total}
          </span>
        ) : null
      }
      loading={loading}
      empty={!loading && items.length === 0}
    >
      <ul className="space-y-2">
        {items.slice(0, 4).map((doc: any) => (
          <li key={doc.id}>
            <Link
              href={`/approval/${doc.id}`}
              className="block text-sm hover:bg-gray-50 -mx-2 px-2 py-1 rounded"
            >
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 shrink-0">
                  {doc.template?.name ?? doc.templateName ?? "결재"}
                </span>
                <span className="flex-1 truncate text-gray-800">{doc.title ?? "(제목 없음)"}</span>
              </div>
              <div className="text-xs text-gray-400 mt-0.5 ml-1">
                {doc.drafter?.name ?? doc.drafterName ?? "기안자"}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </HomeCard>
  );
}
