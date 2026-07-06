"use client";

// OT-Brain NAS 통합검색 (게시판 내장 시범)
//   회사 NAS(약 800만 파일) 파일명·폴더·본문 통합검색. ERP 로그인 세션으로 knowledge-api 호출.
//   백엔드: knowledge-api(/api/v1/knowledge/* rewrite). 인증: ERP 쿠키 introspection.

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppLayout from "@/components/AppLayout";
import UnifiedBoardSidebar from "@/components/board/UnifiedBoardSidebar";
import { knowledgeApi, type KnowledgeResult, type KnowledgeSearchResponse } from "@/lib/api";

// LAN http(비보안 컨텍스트)에서는 navigator.clipboard가 막혀 execCommand 폴백 필요.
function showCopyToast(msg: string) {
  const d = document.createElement("div");
  d.textContent = msg;
  d.style.cssText =
    "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#111827;color:#fff;padding:10px 16px;border-radius:8px;font-size:13px;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,.3)";
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 2800);
}
// 파일명을 제거하고 상위 폴더 경로만 반환 (탐색기 주소창에 붙여넣어 폴더 열기).
function folderOf(p: string) {
  if (!p) return p;
  const i = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
  return i > 0 ? p.slice(0, i) : p;
}
// NAS 파일 서버(호스트측 nas-file, 127.0.0.1:3105). pdf·이미지·txt는 새 탭 미리보기, 그 외는 다운로드.
const NAS_FILE_BASE = process.env.NEXT_PUBLIC_NAS_FILE_BASE || "http://127.0.0.1:3105";
function openNasFile(p: string, dl = false) {
  const url = `${NAS_FILE_BASE}/nas/open?path=${encodeURIComponent(p)}${dl ? "&dl=1" : ""}`;
  window.open(url, "_blank", "noopener");
}
function copyPath(p: string) {
  const ok = () => showCopyToast("경로 복사됨 — 탐색기 주소창(Ctrl+L)에 붙여넣기");
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(p).then(ok).catch(() => fallbackCopy(p, ok));
  } else {
    fallbackCopy(p, ok);
  }
}
function fallbackCopy(p: string, cb: () => void) {
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

export default function KnowledgeSearchPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [q, setQ] = useState("");
  const [data, setData] = useState<KnowledgeSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [took, setTook] = useState<number | null>(null);

  useEffect(() => {
    if (!localStorage.getItem("erp_user")) {
      router.push("/login");
      return;
    }
    setMounted(true);
  }, [router]);

  const runSearch = useCallback(async (override?: string) => {
    const query = (override ?? q).trim();
    if (query.length < 2) {
      setData(null);
      setError(query.length === 0 ? null : "2자 이상 입력해주세요.");
      return;
    }
    setLoading(true);
    setError(null);
    const t0 = performance.now();
    try {
      const res = await knowledgeApi.searchDocuments(query, 50);
      setData(res);
      setTook(Math.round(performance.now() - t0));
    } catch (e: any) {
      setError(e?.message ?? "검색 실패");
      setData(null);
    } finally {
      setLoading(false);
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
          </div>
          <p className="mt-1.5 text-xs text-gray-400">
            💡 <b className="font-medium text-gray-500">키워드</b>도 <b className="font-medium text-gray-500">문장(질문)</b>도 검색됩니다 — 구체 주제어(모델명·사업명)에 파일종류(&lsquo;사진&rsquo;·&lsquo;pdf&rsquo;·&lsquo;엑셀&rsquo;)·장소·항만(&lsquo;포항&rsquo;·&lsquo;축산항&rsquo;)·시기(&lsquo;2025년&rsquo;)를 함께 넣을수록 정확합니다.
          </p>
          {/* 검증된 예시 검색어 — 클릭 시 바로 검색 (내용검색 + 날짜/최근 라우팅) */}
          <div className="mt-2 space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-gray-400 mr-0.5">예시</span>
              {[
                "만성호 어선검사증서",
                "냉수대 관측 절차는?",
                "용역계약서 pdf",
                "축산항 2025년 작업 사진",
              ].map((ex) => (
                <button key={ex} type="button" onClick={() => { setQ(ex); void runSearch(ex); }}
                  className="text-xs px-2.5 py-1 rounded-full border border-gray-200 text-gray-600 bg-gray-50 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-600 transition-colors">
                  {ex}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-gray-400 mr-0.5">날짜·최근</span>
              {[
                "가장 최근에 추가된 파일 20개",
                "어제 올린 사진",
                "이번주 추가된 문서",
                "2024년 6월 28일 작성 견적서",
                "2021년 7월 27일 찍은 사진",
              ].map((ex) => (
                <button key={ex} type="button" onClick={() => { setQ(ex); void runSearch(ex); }}
                  className="text-xs px-2.5 py-1 rounded-full border border-violet-200 text-violet-600 bg-violet-50 dark:border-violet-900 dark:text-violet-300 dark:bg-violet-950 hover:bg-violet-100 hover:border-violet-300 transition-colors">
                  {ex}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex gap-6">
          <UnifiedBoardSidebar />

          <div className="flex-1 min-w-0">
            {error && (
              <div className="bg-red-50 border border-red-200 dark:border-red-900 rounded-xl px-4 py-3 text-sm text-red-700 dark:text-red-300 mb-3">{error}</div>
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
                  {!data.hasExact && <span className="text-amber-600 dark:text-amber-400">정확 일치 없음 — 의미 유사 결과</span>}
                  {data.tokenWeights && data.tokenWeights.length > 0 && (
                    <span className="ml-auto text-gray-400">
                      가중치: {data.tokenWeights.map((w) => `${w.token} ${w.weight}`).join(" · ")}
                    </span>
                  )}
                </div>

                {data.dateMatched === false && (
                  <div className="mb-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 dark:border-amber-900 text-xs text-amber-700 dark:text-amber-300">
                    🗓 <b>{data.dateLabel}</b>에 해당하는 결과가 없어 <b>전 기간</b> 결과를 표시합니다. (날짜가 기록된 사진·문서가 없거나 그 시기 자료가 없을 수 있습니다)
                  </div>
                )}

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
                            <button
                              onClick={() => openNasFile(r.nasPath)}
                              className="text-sm font-medium text-blue-700 dark:text-blue-300 hover:underline break-all text-left"
                              title="클릭하면 파일이 열립니다 — PDF·이미지·텍스트는 브라우저 미리보기, 그 외는 다운로드"
                            >
                              {r.fileName}
                            </button>
                            <div className="text-xs text-gray-500 mt-0.5 truncate">
                              {r.folderPath || r.folder}
                              {r.agency ? ` · ${r.agency}` : ""}
                              {r.isPhotoFolder
                                ? (r.folderFiles && r.folderFiles > 1 ? ` · 📷 이 폴더 ${r.folderFiles}장` : "")
                                : (r.copies > 1 ? ` · 사본 ${r.copies}` : "")}
                              {r.place ? ` · 📍 ${r.place}` : ""}
                              {(r.takenAt || r.docDate) ? ` · 🗓 ${String(r.takenAt || r.docDate).slice(0, 10)}` : ""}
                            </div>
                            {r.snippet && (
                              <div className="text-xs text-gray-400 mt-1 line-clamp-2">{r.snippet}</div>
                            )}
                            <div className="flex items-center gap-3 mt-1.5">
                              <button
                                onClick={() => openNasFile(r.nasPath)}
                                className="text-[11px] text-blue-700 dark:text-blue-300 hover:underline font-medium"
                                title="파일 열기 (미리보기/다운로드)"
                              >
                                📄 열기
                              </button>
                              <button
                                onClick={() => openNasFile(r.nasPath, true)}
                                className="text-[11px] text-gray-600 hover:underline"
                                title="파일 다운로드"
                              >
                                ⬇ 다운로드
                              </button>
                              <button
                                onClick={() => copyPath(folderOf(r.nasPath))}
                                className="text-[11px] text-gray-600 hover:underline"
                                title={`폴더 경로 복사 — ${folderOf(r.nasPath)}`}
                              >
                                📋 폴더 경로 복사
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
