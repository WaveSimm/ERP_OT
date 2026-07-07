"use client";

/**
 * 게시판 design v2.0 (2026-05-22): 기능 요구 관리 (ADMIN 전용)
 * - 통계: 상태별·유형별·모듈별 카운트
 * - 빠른 액세스: 진행 중·검토 중 항목 바로가기
 * - 등록 게시판 링크
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { postApi, getUser } from "@/lib/api";
import { fmtDate } from "@/lib/datetime";

const STATUS_LABEL: Record<string, { text: string; color: string }> = {
  SUBMITTED:    { text: "접수",    color: "bg-gray-100 text-gray-700 border-gray-300" },
  UNDER_REVIEW: { text: "검토중",  color: "bg-blue-100 text-blue-700 border-blue-300" },
  APPROVED:     { text: "승인",    color: "bg-emerald-100 text-emerald-700 border-emerald-300" },
  IN_PROGRESS:  { text: "진행중",  color: "bg-amber-100 text-amber-700 border-amber-300" },
  COMPLETED:    { text: "완료",    color: "bg-green-200 text-green-800 border-green-400" },
  REJECTED:     { text: "반려",    color: "bg-red-100 text-red-700 border-red-300" },
  ON_HOLD:      { text: "보류",    color: "bg-stone-200 text-stone-700 border-stone-400" },
};

const TYPE_LABEL: Record<string, string> = {
  BUG: "🐛 버그",
  NEW_FEATURE: "✨ 신규 기능",
  IMPROVEMENT: "📈 개선",
  UI_UX: "🎨 UI/UX",
  DOCS: "📄 매뉴얼·문서",
  OTHER: "📌 기타",
};

export default function FeatureRequestsAdminPage() {
  const router = useRouter();
  const [stats, setStats] = useState<{
    total: number;
    byStatus: Record<string, number>;
    byType: Record<string, number>;
    byModule: Record<string, number>;
  } | null>(null);
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");

  useEffect(() => {
    const me = getUser();
    if (!me) {
      router.push("/login");
      return;
    }
    if (me.role !== "ADMIN") {
      setError("관리자만 접근할 수 있습니다.");
      setLoading(false);
      return;
    }
    Promise.all([
      postApi.featureRequestStats(),
      postApi.list("feature-request-all", { pageSize: 50 }),
    ])
      .then(([s, l]) => {
        setStats(s);
        setPosts(l.items ?? []);
      })
      .catch((e) => setError(e.message ?? "조회 실패"))
      .finally(() => setLoading(false));
  }, [router]);

  const filteredPosts = statusFilter
    ? posts.filter((p) => (p.requestStatus ?? "") === statusFilter)
    : posts;

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-12 flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-12 text-center text-gray-500">
        <p>{error}</p>
      </div>
    );
  }

  const total = stats?.total ?? 0;
  const inProgressCount = (stats?.byStatus.IN_PROGRESS ?? 0) + (stats?.byStatus.UNDER_REVIEW ?? 0) + (stats?.byStatus.APPROVED ?? 0);
  const completedCount = stats?.byStatus.COMPLETED ?? 0;
  const pendingCount = stats?.byStatus.SUBMITTED ?? 0;

  return (
    <div className="max-w-5xl mx-auto px-6 py-6">
      <div className="flex items-center justify-between mb-5">
          <h1 className="text-xl font-bold text-gray-900">💡 기능 요구 관리</h1>
          <Link
            href="/board/feature-request/feature-request-all"
            className="text-sm px-3 py-1.5 rounded-lg border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950"
          >
            전체 목록 →
          </Link>
        </div>

        <div className="grid grid-cols-4 gap-3 mb-6">
          <SummaryCard label="전체" value={total} accent="text-gray-900" />
          <SummaryCard label="접수 대기" value={pendingCount} accent="text-gray-700" />
          <SummaryCard label="진행 중" value={inProgressCount} accent="text-amber-700 dark:text-amber-300" />
          <SummaryCard label="완료" value={completedCount} accent="text-green-700 dark:text-green-300" />
        </div>

        <Section title="상태별 분포">
          <div className="flex flex-wrap gap-2">
            {Object.keys(STATUS_LABEL).map((s) => {
              const count = stats?.byStatus[s] ?? 0;
              const sl = STATUS_LABEL[s];
              return (
                <div
                  key={s}
                  className={`px-3 py-2 rounded-lg border text-sm flex items-center gap-2 ${sl.color}`}
                >
                  <span className="font-medium">{sl.text}</span>
                  <span className="text-base font-bold">{count}</span>
                </div>
              );
            })}
          </div>
        </Section>

        <Section title="유형별 분포">
          <div className="flex flex-wrap gap-2">
            {Object.keys(TYPE_LABEL).map((t) => {
              const count = stats?.byType[t] ?? 0;
              return (
                <div
                  key={t}
                  className="px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm flex items-center gap-2"
                >
                  <span className="text-gray-700">{TYPE_LABEL[t]}</span>
                  <span className="text-base font-bold text-gray-900">{count}</span>
                </div>
              );
            })}
          </div>
        </Section>

        <Section title="모듈별 분포">
          {stats && Object.keys(stats.byModule).length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {Object.entries(stats.byModule)
                .sort(([, a], [, b]) => (b as number) - (a as number))
                .map(([m, count]) => (
                  <div
                    key={m}
                    className="px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm flex items-center gap-2"
                  >
                    <span className="text-gray-700">{m}</span>
                    <span className="text-base font-bold text-gray-900">{count as number}</span>
                  </div>
                ))}
            </div>
          ) : (
            <div className="text-sm text-gray-400 italic">아직 등록된 항목이 없습니다.</div>
          )}
        </Section>

        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-gray-700">전체 글 목록 ({filteredPosts.length}건)</h2>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-gray-500">상태 필터:</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="border border-gray-300 rounded px-2 py-1 bg-white"
              >
                <option value="">전체</option>
                {Object.keys(STATUS_LABEL).map((s) => (
                  <option key={s} value={s}>{STATUS_LABEL[s].text}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            {filteredPosts.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-gray-400">등록된 항목이 없습니다.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium w-24">상태</th>
                    <th className="text-left px-3 py-2 font-medium w-28">유형</th>
                    <th className="text-left px-3 py-2 font-medium">제목</th>
                    <th className="text-left px-3 py-2 font-medium w-28">모듈</th>
                    <th className="text-left px-3 py-2 font-medium w-24">작성자</th>
                    <th className="text-left px-3 py-2 font-medium w-24">작성일</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPosts.map((p) => {
                    const sl = p.requestStatus ? STATUS_LABEL[p.requestStatus] : null;
                    const typeLabel = p.requestType ? TYPE_LABEL[p.requestType] : "—";
                    return (
                      <tr key={p.id} className="border-t border-gray-100 hover:bg-blue-50/30 dark:hover:bg-blue-500/10">
                        <td className="px-3 py-2">
                          {sl ? (
                            <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium border ${sl.color}`}>
                              {sl.text}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-700">{typeLabel}</td>
                        <td className="px-3 py-2">
                          <Link
                            href={`/board/feature-request/feature-request-all/${p.id}`}
                            className="text-blue-700 hover:underline dark:text-blue-300"
                          >
                            {p.title}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-600">{p.moduleArea ?? "—"}</td>
                        <td className="px-3 py-2 text-xs text-gray-600">{p.author?.name ?? "—"}</td>
                        <td className="px-3 py-2 text-xs text-gray-500">{fmtDate(p.publishedAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="mt-6 px-4 py-3 bg-blue-50/60 border border-blue-200 rounded-lg text-sm text-gray-700 dark:bg-blue-500/10 dark:border-blue-900">
          <p className="font-medium mb-1">📌 운영 가이드</p>
          <ul className="list-disc list-inside space-y-1 text-xs text-gray-600">
            <li>모든 직원이 게시판 카테고리 <span className="font-mono">기능 요구</span>에서 등록할 수 있습니다.</li>
            <li>등록된 항목은 <span className="font-mono">접수</span> → <span className="font-mono">검토중</span> → <span className="font-mono">승인</span>/<span className="font-mono">반려</span> → <span className="font-mono">진행중</span> → <span className="font-mono">완료</span> 흐름으로 진행됩니다.</li>
            <li>관리자는 담당자(assignee)·릴리즈 버전을 지정할 수 있고, 담당자도 상태를 변경할 수 있습니다.</li>
            <li>완료 시점은 자동으로 기록됩니다.</li>
          </ul>
        </div>
    </div>
  );
}

function SummaryCard({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="px-4 py-3 bg-white border border-gray-200 rounded-xl">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${accent}`}>{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h2 className="text-sm font-semibold text-gray-700 mb-2">{title}</h2>
      <div className="px-4 py-3 bg-gray-50/60 rounded-xl border border-gray-200 dark:bg-gray-500/10">
        {children}
      </div>
    </div>
  );
}
