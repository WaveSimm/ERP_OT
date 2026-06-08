"use client";

// OT-Brain NAS 통합검색 (게시판 내장 시범)
//   회사 NAS(약 800만 파일) 파일명·폴더·본문 통합검색. ERP 로그인 세션으로 knowledge-api 호출.
//   백엔드: knowledge-api(/api/v1/knowledge/* rewrite). 인증: ERP 쿠키 introspection.

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppLayout from "@/components/AppLayout";
import UnifiedBoardSidebar from "@/components/board/UnifiedBoardSidebar";
import { knowledgeApi, type KnowledgeResult, type KnowledgeSearchResponse, type KnowledgeAnswer } from "@/lib/api";

function copyPath(p: string) {
  navigator.clipboard?.writeText(p).catch(() => {});
}

export default function KnowledgeSearchPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [q, setQ] = useState("");
  const [data, setData] = useState<KnowledgeSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [took, setTook] = useState<number | null>(null);
  // RAG (AI 답변) — 로컬 LLM, 느림(수~수십초)
  const [answer, setAnswer] = useState<KnowledgeAnswer | null>(null);
  const [asking, setAsking] = useState(false);
  const [askErr, setAskErr] = useState<string | null>(null);

  useEffect(() => {
    if (!localStorage.getItem("erp_user")) {
      router.push("/login");
      return;
    }
    setMounted(true);
  }, [router]);

  const runSearch = useCallback(async () => {
    const query = q.trim();
    if (query.length < 2) {
      setData(null);
      setError(query.length === 0 ? null : "2자 이상 입력해주세요.");
      return;
    }
    setLoading(true);
    setError(null);
    const t0 = performance.now();
    try {
      const res = await knowledgeApi.searchDocuments(query, 20);
      setData(res);
      setTook(Math.round(performance.now() - t0));
    } catch (e: any) {
      setError(e?.message ?? "검색 실패");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [q]);

  const runAsk = useCallback(async () => {
    const query = q.trim();
    if (query.length < 2) return;
    setAsking(true);
    setAskErr(null);
    setAnswer(null);
    try {
      const res = await knowledgeApi.ask(query, 6);
      setAnswer(res);
    } catch (e: any) {
      setAskErr(e?.message ?? "AI 답변 생성 실패");
    } finally {
      setAsking(false);
    }
  }, [q]);

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
          <span className="text-gray-700 font-medium">NAS 통합검색</span>
        </div>

        <div className="mb-5">
          <div className="flex gap-2">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void runSearch(); }}
              placeholder="회사 NAS 검색 — 예: PWD22 매뉴얼, 해무 포항 결선도, 만성호 어선검사증서"
              className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={() => void runSearch()}
              className="px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              disabled={loading}
            >
              {loading ? "검색중…" : "검색"}
            </button>
            <button
              onClick={() => void runAsk()}
              className="px-4 py-2.5 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-50 whitespace-nowrap"
              disabled={asking || q.trim().length < 2}
              title="사내 자료 기반 AI 답변 (로컬 LLM, 수~수십초 소요)"
            >
              {asking ? "🤖 생성중…" : "🤖 AI 답변"}
            </button>
          </div>
          <p className="mt-1.5 text-xs text-gray-400">
            파일명·폴더는 전체 NAS, 본문은 추출 완료분 검색. 구체 주제어(모델명·사업명)일수록 정확합니다.
          </p>
        </div>

        <div className="flex gap-6">
          <UnifiedBoardSidebar />

          <div className="flex-1 min-w-0">
            {/* AI 답변 (RAG) */}
            {asking && (
              <div className="bg-violet-50 border border-violet-200 rounded-xl px-4 py-3 mb-3 text-sm text-violet-700 flex items-center gap-2">
                <div className="animate-spin w-4 h-4 border-2 border-violet-500 border-t-transparent rounded-full" />
                AI가 사내 자료를 읽고 답변 생성 중… (로컬 LLM, 수~수십초)
              </div>
            )}
            {askErr && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 mb-3">AI 답변: {askErr}</div>
            )}
            {answer && (
              <div className="bg-violet-50 border border-violet-200 rounded-xl px-4 py-3 mb-4">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-xs font-semibold text-violet-700">🤖 AI 답변</span>
                  <span className="text-[11px] text-violet-400">{answer.model} · {Math.round(answer.tookMs / 100) / 10}s · 사내 로컬</span>
                </div>
                <div className="text-sm text-gray-800 whitespace-pre-wrap">{answer.answer}</div>
                {answer.sources?.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-violet-100 text-xs text-gray-500">
                    출처: {answer.sources.map((s) => `[${s.n}] ${s.fileName}`).join("  ")}
                  </div>
                )}
                <div className="mt-1 text-[11px] text-gray-400">※ AI 생성 답변 — 중요한 내용은 원문 확인 권장</div>
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 mb-3">{error}</div>
            )}

            {!data && !error && (
              <div className="bg-white border border-gray-200 rounded-xl py-16 text-center text-gray-400">
                검색어를 입력하고 Enter를 누르세요.
              </div>
            )}

            {data && (
              <>
                <div className="flex items-center gap-3 mb-3 text-xs text-gray-500">
                  <span>결과 <b className="text-gray-700">{data.count}</b>건{took != null && ` · ${took}ms`}</span>
                  {!data.hasExact && <span className="text-amber-600">정확 일치 없음 — 의미 유사 결과</span>}
                  {data.tokenWeights && data.tokenWeights.length > 0 && (
                    <span className="ml-auto text-gray-400">
                      가중치: {data.tokenWeights.map((w) => `${w.token} ${w.weight}`).join(" · ")}
                    </span>
                  )}
                </div>

                {data.results.length === 0 ? (
                  <div className="bg-white border border-gray-200 rounded-xl py-16 text-center text-gray-400">
                    결과가 없습니다.
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {data.results.map((r: KnowledgeResult) => (
                      <li key={r.id} className="bg-white border border-gray-200 rounded-xl px-4 py-3 hover:border-blue-300 transition-colors">
                        <div className="flex items-start gap-2">
                          <span className="mt-0.5 shrink-0 text-[11px] uppercase px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{r.ext || "?"}</span>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-gray-800 break-all">{r.fileName}</div>
                            <div className="text-xs text-gray-500 mt-0.5 truncate">
                              {r.folderPath || r.folder}
                              {r.agency ? ` · ${r.agency}` : ""}
                              {r.copies > 1 ? ` · 사본 ${r.copies}` : ""}
                            </div>
                            {r.snippet && (
                              <div className="text-xs text-gray-400 mt-1 line-clamp-2">{r.snippet}</div>
                            )}
                            <div className="flex items-center gap-2 mt-1.5">
                              <button
                                onClick={() => copyPath(r.nasPath)}
                                className="text-[11px] text-blue-600 hover:underline"
                                title={r.nasPath}
                              >
                                경로 복사
                              </button>
                              <span className="text-[11px] text-gray-300">score {r.score}</span>
                            </div>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
