"use client";

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import AppLayout from "@/components/AppLayout";
import UnifiedBoardSidebar from "@/components/board/UnifiedBoardSidebar";
import SearchBar from "@/components/board/SearchBar";
import SearchResultCard from "@/components/board/SearchResultCard";
import { searchApi, type SearchResultItem, knowledgeApi, type KnowledgeResult } from "@/lib/api";

type Scope = "all" | "notice" | "wiki" | "worklogs" | "nas";

const POST_SCOPES: Scope[] = ["all", "notice", "wiki", "worklogs"];
const TAB_LABEL: Record<Scope, string> = {
  all: "전체",
  notice: "공지사항",
  wiki: "게시판",
  worklogs: "프로젝트",
  nas: "NAS 파일",
};

function matchScope(item: SearchResultItem, s: Scope): boolean {
  if (s === "all") return true;
  if (s === "worklogs") return item.type === "worklog";
  return item.type === "post" && item.url.startsWith(`/board/${s}/`);
}

// LAN http(비보안)에서 navigator.clipboard 차단 → execCommand 폴백.
function showCopyToast(msg: string) {
  const d = document.createElement("div");
  d.textContent = msg;
  d.style.cssText =
    "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#111827;color:#fff;padding:10px 16px;border-radius:8px;font-size:13px;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,.3)";
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 2800);
}
function toFileUrl(nasPath: string): string {
  const p = nasPath.replace(/\\/g, "/").replace(/^\/+/, "");
  return "file://" + encodeURI(p);
}
function copyPath(p: string) {
  const ok = () => showCopyToast("경로 복사됨 — 탐색기 주소창(Ctrl+L)에 붙여넣기");
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(p).then(ok).catch(() => fallbackCopyPath(p, ok));
  } else {
    fallbackCopyPath(p, ok);
  }
}
function fallbackCopyPath(p: string, cb: () => void) {
  try {
    const ta = document.createElement("textarea");
    ta.value = p;
    ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    cb();
  } catch {
    window.prompt("아래 경로를 복사하세요 (Ctrl+C):", p);
  }
}

export default function SearchPage() {
  const router = useRouter();
  const params = useSearchParams();
  const q = params.get("q") ?? "";
  const [mounted, setMounted] = useState(false);
  const [items, setItems] = useState<SearchResultItem[]>([]);
  const [took, setTook] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("all");

  // NAS 통합검색(파일) — 탭 선택 시 lazy 로드 (게시판 검색 속도에 영향 없음)
  const [nasItems, setNasItems] = useState<KnowledgeResult[]>([]);
  const [nasLoading, setNasLoading] = useState(false);
  const [nasError, setNasError] = useState<string | null>(null);
  const [nasQuery, setNasQuery] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("erp_user");
    if (!token) {
      router.push("/login");
      return;
    }
    setMounted(true);
  }, [router]);

  const runSearch = useCallback(async () => {
    if (!q || q.trim().length < 2) {
      setItems([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await searchApi.search(q, { scope: "all", limit: 30 });
      setItems(result.items ?? []);
      setTook(result.took ?? 0);
    } catch (e: any) {
      setError(e?.message ?? "검색 실패");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [q]);

  useEffect(() => {
    if (mounted) void runSearch();
  }, [mounted, runSearch]);

  // 질의 변경 시 NAS 결과 리셋(탭 다시 누르면 재조회)
  useEffect(() => {
    setNasItems([]);
    setNasQuery(null);
    setNasError(null);
  }, [q]);

  // NAS 탭 선택 시에만 knowledge-api 호출 (lazy)
  useEffect(() => {
    if (!mounted || scope !== "nas") return;
    const query = q.trim();
    if (query.length < 2 || nasQuery === query) return;
    let cancelled = false;
    (async () => {
      setNasLoading(true);
      setNasError(null);
      try {
        const res = await knowledgeApi.searchDocuments(query, 20);
        if (!cancelled) {
          setNasItems(res.results ?? []);
          setNasQuery(query);
        }
      } catch (e: any) {
        if (!cancelled) {
          setNasError(e?.message ?? "NAS 검색 실패");
          setNasItems([]);
        }
      } finally {
        if (!cancelled) setNasLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [scope, q, mounted, nasQuery]);

  const counts: Record<string, number> = {
    all: items.length,
    notice: items.filter((i) => matchScope(i, "notice")).length,
    wiki: items.filter((i) => matchScope(i, "wiki")).length,
    worklogs: items.filter((i) => matchScope(i, "worklogs")).length,
  };
  const nasFetched = nasQuery === q.trim();

  if (!mounted) {
    return (
      <AppLayout>
        <div className="max-w-7xl mx-auto px-6 py-12 flex items-center justify-center">
          <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="text-sm text-gray-500 flex items-center gap-1.5 mb-3">
          <Link href="/board" className="hover:text-gray-700">게시판</Link>
          <span>›</span>
          <span className="text-gray-700 font-medium">검색</span>
        </div>

        <div className="mb-5">
          <SearchBar initialQuery={q} />
        </div>

        <div className="flex gap-6">
          <UnifiedBoardSidebar />

          <div className="flex-1 min-w-0">
            {q.trim().length === 0 ? (
              <div className="bg-white border border-gray-200 rounded-xl py-16 text-center text-gray-400">
                검색어를 입력해주세요.
              </div>
            ) : q.trim().length < 2 ? (
              <div className="bg-white border border-gray-200 rounded-xl py-16 text-center text-gray-400">
                2자 이상 입력해주세요.
              </div>
            ) : (
              <>
                {/* 탭 + 메타 */}
                <div className="flex items-center gap-1 mb-3 border-b border-gray-200">
                  {POST_SCOPES.map((s) => (
                    <button
                      key={s}
                      onClick={() => setScope(s)}
                      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                        scope === s
                          ? "border-blue-600 text-blue-600"
                          : "border-transparent text-gray-500 hover:text-gray-700"
                      }`}
                    >
                      {TAB_LABEL[s]} ({counts[s]})
                    </button>
                  ))}
                  {/* NAS 파일 탭 (별도 백엔드, lazy) */}
                  <button
                    onClick={() => setScope("nas")}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                      scope === "nas"
                        ? "border-blue-600 text-blue-600"
                        : "border-transparent text-gray-500 hover:text-gray-700"
                    }`}
                    title="회사 NAS 파일 통합검색"
                  >
                    🔎 {TAB_LABEL.nas}{nasFetched ? ` (${nasItems.length})` : ""}
                  </button>
                  {scope !== "nas" && !loading && (
                    <span className="ml-auto text-xs text-gray-400 pb-2">
                      {items.length}건 · {took}ms
                    </span>
                  )}
                </div>

                {/* ── NAS 파일 탭 ── */}
                {scope === "nas" ? (
                  nasLoading ? (
                    <div className="flex items-center justify-center py-16">
                      <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
                    </div>
                  ) : nasError ? (
                    <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{nasError}</div>
                  ) : nasItems.length === 0 ? (
                    <div className="bg-white border border-gray-200 rounded-xl py-16 text-center text-sm text-gray-400">
                      NAS에서 관련 파일을 찾지 못했습니다.
                    </div>
                  ) : (
                    <ul className="space-y-2">
                      {nasItems.map((r) => (
                        <li key={r.id} className="bg-white border border-gray-200 rounded-xl px-4 py-3 hover:border-blue-300 transition-colors">
                          <div className="flex items-start gap-2">
                            <span className="mt-0.5 shrink-0 text-[11px] uppercase px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{r.ext || "?"}</span>
                            <div className="min-w-0 flex-1">
                              <a
                                href={toFileUrl(r.nasPath)}
                                target="_blank"
                                rel="noreferrer"
                                className="text-sm font-medium text-blue-700 hover:underline break-all"
                                title="클릭하여 열기 (차단되면 '경로 복사' 사용)"
                              >
                                {r.fileName}
                              </a>
                              <div className="text-xs text-gray-500 mt-0.5 truncate">
                                {r.folderPath || r.folder}
                                {r.agency ? ` · ${r.agency}` : ""}
                                {r.copies > 1 ? ` · 사본 ${r.copies}` : ""}
                              </div>
                              {r.snippet && <div className="text-xs text-gray-400 mt-1 line-clamp-2">{r.snippet}</div>}
                              <button
                                onClick={() => copyPath(r.nasPath)}
                                className="mt-1.5 text-[11px] text-blue-600 hover:underline"
                                title={r.nasPath}
                              >
                                경로 복사
                              </button>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )
                ) : error ? (
                  <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 mb-4">{error}</div>
                ) : loading ? (
                  <div className="flex items-center justify-center py-16">
                    <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
                  </div>
                ) : items.length === 0 ? (
                  <div className="bg-white border border-gray-200 rounded-xl py-16 text-center text-sm text-gray-400">
                    <div className="mb-2">관련된 글이 없습니다.</div>
                    <div className="text-xs text-gray-400">💡 다른 검색어를 시도하거나 NAS 파일 탭을 확인해보세요.</div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {items
                      .filter((i) => matchScope(i, scope))
                      .map((item) => (
                        <SearchResultCard key={`${item.type}-${item.id}`} item={item} />
                      ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
