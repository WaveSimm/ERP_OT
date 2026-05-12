"use client";

import { useEffect, useState } from "react";
import { expenseApi } from "@/lib/api";
import { fmtDate, fmtDateTime24 } from "@/lib/datetime";
import { DateInput } from "@/components/ui/DateInput";
import ReceiptSplitModal from "./ReceiptSplitModal";

interface Props {
  receiptId: string;
  onClose: () => void;
  onChange: () => void | Promise<void>;
}

// YYYY-MM-DD 변환 (DateInput용)
function toYmd(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// YYYY-MM-DD → ISO (00:00 KST 기준)
function ymdToIso(ymd: string): string | null {
  if (!ymd) return null;
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  // 로컬 자정으로 저장
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0);
  return d.toISOString();
}

const OCR_LABEL: Record<string, string> = {
  PENDING: "OCR 대기",
  RUNNING: "OCR 처리중",
  DONE: "OCR 완료",
  FAILED: "OCR 실패",
};

// OCR 원본 텍스트로부터 결제수단(source) 자동 추정
function detectSourceFromOcr(ocrText: string, sources: any[]): string | null {
  if (!ocrText) return null;
  const text = ocrText;

  // 1. 카드번호 끝 4자리 정확 매칭 (가장 신뢰도 높음)
  // source.displayName이 "신한카드(3969)" 또는 "신한카드 (3969)" 같은 형태에서 끝 4자리 추출
  for (const s of sources) {
    const name = (s.displayName ?? s.name ?? "") as string;
    const last4Match = name.match(/(\d{4})/);
    if (last4Match && text.includes(last4Match[1])) {
      return s.id;
    }
  }

  // 2. 카드사명 매칭 — OCR 텍스트에 카드사 이름이 있으면 해당 카드사 source 중 첫 번째
  const CARD_BRANDS = ["신한", "국민", "현대", "삼성", "롯데", "비씨", "BC", "하나", "우리", "농협", "씨티", "카카오뱅크", "케이뱅크", "토스"];
  const norm = text.toLowerCase();
  for (const brand of CARD_BRANDS) {
    if (norm.includes(brand.toLowerCase())) {
      const matched = sources.find((s) => {
        const n = ((s.displayName ?? s.name ?? "") as string).toLowerCase();
        return n.includes(brand.toLowerCase());
      });
      if (matched) return matched.id;
    }
  }

  // 3. 현금 영수증
  if (/현금영수증|현금\s|cash/i.test(text)) {
    const cash = sources.find((s) => s.type === "CASH");
    if (cash) return cash.id;
  }

  return null;
}

export default function ReceiptDetailModal({ receiptId, onClose, onChange }: Props) {
  const [r, setR] = useState<any>(null);
  const [merch, setMerch] = useState("");
  const [amt, setAmt] = useState("");
  const [date, setDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [showSplit, setShowSplit] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // 매칭용 거래 후보
  const [availableTxs, setAvailableTxs] = useState<any[]>([]);
  const [selectedTxId, setSelectedTxId] = useState("");
  const [matching, setMatching] = useState(false);

  // 결제수단 (거래 자동 추가용)
  const [sources, setSources] = useState<any[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [adding, setAdding] = useState(false);

  async function load() {
    try {
      const d = await expenseApi.getReceipt(receiptId);
      setR(d);
      setMerch(d.extractedMerchant ?? "");
      setAmt(d.extractedAmount != null ? String(d.extractedAmount) : "");
      setDate(toYmd(d.extractedDate));
    } catch (e: any) {
      alert("불러오기 실패: " + (e.message ?? e));
      onClose();
    }
  }

  useEffect(() => {
    load();
    // 거래 목록 + 결제수단 함께 로드
    (async () => {
      try {
        const [txData, srcs] = await Promise.all([
          expenseApi.listTransactions({ limit: 500 }),
          expenseApi.listSources().catch(() => []),
        ]);
        const txs = (txData as any).items ?? [];
        // 후보: 취소·제외 거래 아니고, 다른 영수증과 매칭(confirmed/candidate 모두) 없는 거래
        const candidates = txs.filter((t: any) => {
          if (t.isCanceled) return false;
          if (t.status === "EXCLUDED") return false;
          return !(t.matches ?? []).some((m: any) => m.receiptId !== receiptId);
        });
        setAvailableTxs(candidates);
        setSources(srcs as any[]);
      } catch (e: any) {
        console.error("거래/결제수단 로드 실패:", e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiptId]);

  // OCR 텍스트로부터 결제수단 자동 추정
  useEffect(() => {
    if (!r?.ocrText || sources.length === 0 || sourceId) return;
    const text = String(r.ocrText);
    const matched = detectSourceFromOcr(text, sources);
    if (matched) setSourceId(matched);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r?.ocrText, sources]);

  // 거래 선택 시 상단 필드를 거래 정보로 자동 채움
  useEffect(() => {
    if (!selectedTxId) return;
    const tx = availableTxs.find((t) => t.id === selectedTxId);
    if (!tx) return;
    setMerch(tx.merchantName ?? "");
    setAmt(tx.amount != null ? String(tx.amount) : "");
    setDate(toYmd(tx.transactedAt));
    if (tx.sourceId) setSourceId(tx.sourceId);
  }, [selectedTxId, availableTxs]);

  // 매칭된 영수증의 경우 거래 정보에서 결제수단 자동 채움
  useEffect(() => {
    if (!r?.matches) return;
    const confirmed = r.matches.find((m: any) => m.confirmedAt);
    if (confirmed?.transaction?.sourceId && !sourceId) {
      setSourceId(confirmed.transaction.sourceId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r?.matches]);

  async function matchToTransaction() {
    if (!selectedTxId) return;
    setMatching(true);
    try {
      // 기존 매칭 있으면 그것 사용, 없으면 새로 생성 (P2002 Unique 충돌 방지)
      const existing = (r?.matches ?? []).find((m: any) =>
        m.transactionId === selectedTxId || m.transaction?.id === selectedTxId,
      );
      let matchId: string | undefined = existing?.id;
      if (!matchId) {
        try {
          const created = await expenseApi.createMatch(selectedTxId, receiptId);
          matchId = created?.id;
        } catch (createErr: any) {
          // 이미 매칭이 존재하지만 r.matches 캐시에 없는 경우 — 다시 fetch
          const fresh = await expenseApi.getReceipt(receiptId).catch(() => null);
          const m = (fresh?.matches ?? []).find((m: any) =>
            m.transactionId === selectedTxId || m.transaction?.id === selectedTxId,
          );
          matchId = m?.id;
          if (!matchId) throw createErr;
        }
      }
      if (matchId) {
        await expenseApi.confirmMatch(matchId);
      }
      // 영수증의 추출 정보도 거래 정보로 동기화
      const tx = availableTxs.find((t) => t.id === selectedTxId);
      if (tx) {
        try {
          await expenseApi.updateReceipt(receiptId, {
            extractedMerchant: tx.merchantName ?? null,
            extractedAmount: tx.amount != null ? Number(tx.amount) : null,
            extractedDate: tx.transactedAt ?? null,
          });
        } catch (e: any) {
          console.error("영수증 정보 동기화 실패:", e.message);
        }
      }
      setSelectedTxId("");
      await load();
      await onChange();
    } catch (e: any) {
      alert("매칭 실패: " + (e.message ?? e));
    } finally {
      setMatching(false);
    }
  }

  async function unmatch(matchId: string) {
    if (!confirm("매칭을 해제하시겠습니까?")) return;
    try {
      await expenseApi.removeMatch(matchId);
      await load();
      await onChange();
    } catch (e: any) {
      alert("매칭 해제 실패: " + (e.message ?? e));
    }
  }

  // ESC 닫기
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !showSplit) onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose, showSplit]);

  // RUNNING/PENDING 동안 4초마다 폴링
  useEffect(() => {
    if (!r) return;
    if (r.ocrStatus !== "PENDING" && r.ocrStatus !== "RUNNING") return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r?.ocrStatus]);

  async function save() {
    setSaving(true);
    try {
      const updated = await expenseApi.updateReceipt(receiptId, {
        extractedMerchant: merch || null,
        extractedAmount: amt ? Number(amt) : null,
        extractedDate: date ? ymdToIso(date) : null,
      });
      setR((cur: any) => (cur ? { ...cur, ...updated } : cur));
      setMerch(updated.extractedMerchant ?? "");
      setAmt(updated.extractedAmount != null ? String(updated.extractedAmount) : "");
      setDate(toYmd(updated.extractedDate));
      await onChange();
    } catch (e: any) {
      alert("저장 실패: " + (e.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  async function addTransactionAndMatch() {
    const iso = ymdToIso(date);
    if (!sourceId || !merch || !amt || !iso) return;
    setAdding(true);
    try {
      // 영수증 정보 먼저 저장 (사용자가 추출 정보 수정한 상태일 수 있음)
      await expenseApi.updateReceipt(receiptId, {
        extractedMerchant: merch || null,
        extractedAmount: amt ? Number(amt) : null,
        extractedDate: iso,
      });
      const tx = await expenseApi.createTransaction({
        sourceId,
        transactedAt: iso,
        merchantName: merch,
        amount: Number(amt),
      });
      const m = await expenseApi.createMatch(tx.id, receiptId);
      if (m?.id) await expenseApi.confirmMatch(m.id);
      await load();
      await onChange();
    } catch (e: any) {
      alert("내역 추가 실패: " + (e.message ?? e));
    } finally {
      setAdding(false);
    }
  }

  async function reprocess() {
    if (!confirm("이 영수증을 다시 OCR 처리합니다. 기존 추출값은 초기화됩니다.")) return;
    setReprocessing(true);
    try {
      await expenseApi.reprocessReceipt(receiptId);
      await load();
      await onChange();
    } catch (e: any) {
      alert("재OCR 실패: " + (e.message ?? e));
    } finally {
      setReprocessing(false);
    }
  }

  async function remove() {
    if (!confirm("이 영수증을 삭제하시겠습니까?")) return;
    setDeleting(true);
    try {
      await expenseApi.deleteReceipt(receiptId);
      await onChange();
      onClose();
    } catch (e: any) {
      alert("삭제 실패: " + (e.message ?? e));
      setDeleting(false);
    }
  }

  if (!r) {
    return (
      <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center">
        <div className="bg-white rounded-lg p-8 text-sm">로딩 중...</div>
      </div>
    );
  }

  const isImage = r.fileType?.startsWith("image/");
  const confirmedMatches = (r.matches ?? []).filter((m: any) => m.confirmedAt);
  const candidateMatches = (r.matches ?? []).filter((m: any) => !m.confirmedAt);

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center p-4"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div className="bg-white rounded-lg shadow-xl w-full max-w-6xl max-h-[95vh] flex flex-col">
          <div className="flex items-center justify-between p-4 border-b">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold truncate">{r.originalFileName}</h2>
              <p className="text-xs text-gray-500">
                {fmtDate(r.uploadedAt)} 업로드 · {OCR_LABEL[r.ocrStatus] ?? r.ocrStatus}
                {r.ocrEngineUsed && ` · ${r.ocrEngineUsed}`}
              </p>
            </div>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-700 ml-3" title="ESC">✕</button>
          </div>

          <div className="flex-1 overflow-auto grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
            {/* 좌: 이미지 + 줌 */}
            <div className="bg-gray-100 rounded p-2 flex flex-col">
              <div className="flex items-center gap-2 mb-2 text-sm">
                <button onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
                  className="px-2 py-0.5 bg-white border rounded">−</button>
                <span className="text-gray-600 tabular-nums">{Math.round(zoom * 100)}%</span>
                <button onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
                  className="px-2 py-0.5 bg-white border rounded">+</button>
                <button onClick={() => setZoom(1)}
                  className="px-2 py-0.5 bg-white border rounded">100%</button>
                <a href={expenseApi.receiptDownloadUrl(r.id)} target="_blank" rel="noreferrer"
                  className="ml-auto text-xs text-blue-600 hover:underline">새 창에서 보기</a>
              </div>
              <div className="flex-1 overflow-auto bg-white rounded border">
                <div style={{
                  transform: `scale(${zoom})`,
                  transformOrigin: "top left",
                  width: `${100 / zoom}%`,
                }}>
                  {isImage ? (
                    <img src={expenseApi.receiptDownloadUrl(r.id)} alt={r.originalFileName}
                      className="w-full h-auto block" />
                  ) : (
                    <iframe src={expenseApi.receiptDownloadUrl(r.id)}
                      className="w-full h-[70vh]" title={r.originalFileName} />
                  )}
                </div>
              </div>
            </div>

            {/* 우: 추출 정보 + 수정 + 매칭 */}
            <div className="space-y-4">
              <section>
                <h3 className="font-semibold mb-2 text-sm text-gray-700">추출 정보 (수정 가능)</h3>
                <div className="space-y-2">
                  <div>
                    <label className="text-xs text-gray-500">가맹점명</label>
                    <input type="text" value={merch}
                      onChange={(e) => setMerch(e.target.value)} placeholder="가맹점명"
                      className="w-full border px-2 py-1.5 rounded text-sm" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-gray-500">금액 (원)</label>
                      <input type="number" value={amt}
                        onChange={(e) => setAmt(e.target.value)} placeholder="금액"
                        className="w-full border px-2 py-1.5 rounded text-sm" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">거래일</label>
                      <DateInput value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className="w-full border px-2 py-1.5 rounded text-sm" />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">
                      결제수단
                      {!confirmedMatches.length && <span className="text-gray-400"> (선택 시 거래 자동 추가·매칭)</span>}
                    </label>
                    <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}
                      disabled={confirmedMatches.length > 0}
                      className="w-full border px-2 py-1.5 rounded text-sm bg-white disabled:bg-gray-50 disabled:text-gray-500">
                      <option value="">{confirmedMatches.length > 0 ? "— 미지정 —" : "— 매칭만 (거래 추가 안 함) —"}</option>
                      {sources.map((s) => (
                        <option key={s.id} value={s.id}>{s.displayName ?? s.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={save} disabled={saving || adding}
                      className="flex-1 py-2 rounded text-sm border border-gray-300 enabled:bg-white enabled:text-gray-700 enabled:hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400">
                      {saving ? "저장 중..." : "💾 저장"}
                    </button>
                    <button
                      onClick={addTransactionAndMatch}
                      disabled={
                        adding || saving
                        || confirmedMatches.length > 0
                        || !sourceId || !merch || !amt || !date
                      }
                      title={
                        confirmedMatches.length > 0
                          ? "이미 매칭된 영수증입니다"
                          : (!sourceId || !merch || !amt || !date)
                            ? "결제수단·가맹점·금액·거래일이 모두 필요합니다"
                            : ""
                      }
                      className="flex-1 py-2 rounded text-sm enabled:bg-blue-600 enabled:text-white enabled:hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400"
                    >
                      {adding ? "추가 중..." : "➕ 내역 추가"}
                    </button>
                  </div>
                </div>
              </section>

              {confirmedMatches.length > 0 ? (
                <section className="bg-green-50 border border-green-200 rounded p-3">
                  <h3 className="font-semibold mb-1 text-sm text-green-800">✓ 매칭됨</h3>
                  {confirmedMatches.map((m: any) => (
                    <div key={m.id} className="flex items-center justify-between text-sm">
                      <span>
                        {m.transaction?.merchantName} · {Number(m.transaction?.amount ?? 0).toLocaleString()}원
                        {m.transaction?.category && (
                          <span className="text-gray-500"> ({m.transaction.category.name})</span>
                        )}
                      </span>
                      <button onClick={() => unmatch(m.id)} className="text-xs text-red-600 hover:underline">매칭 해제</button>
                    </div>
                  ))}
                </section>
              ) : (
                <section className="bg-blue-50 border border-blue-200 rounded p-3 space-y-2">
                  <h3 className="font-semibold text-sm text-blue-800">거래 매칭</h3>
                  {candidateMatches.length > 0 && (
                    <div className="text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 rounded px-2 py-1">
                      ⚡ 자동 매칭 후보 {candidateMatches.length}건 — 아래에서 선택해 확정하세요
                    </div>
                  )}
                  <select
                    value={selectedTxId}
                    onChange={(e) => setSelectedTxId(e.target.value)}
                    className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-white"
                  >
                    <option value="">— 매칭할 거래 선택 —</option>
                    {availableTxs.map((t: any) => (
                      <option key={t.id} value={t.id}>
                        {fmtDateTime24(t.transactedAt, { short: true })} · {t.merchantName} · {Number(t.amount).toLocaleString()}원
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={matchToTransaction}
                    disabled={!selectedTxId || matching}
                    className="w-full py-1.5 text-sm rounded enabled:bg-blue-600 enabled:text-white enabled:hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400"
                  >
                    {matching ? "매칭 중..." : "이 거래에 매칭"}
                  </button>
                </section>
              )}

              {r.ocrText && (
                <section>
                  <details>
                    <summary className="text-sm text-gray-700 cursor-pointer">
                      OCR 원본 텍스트 ({r.ocrText.length}자)
                    </summary>
                    <pre className="mt-2 text-xs bg-gray-50 p-2 rounded max-h-40 overflow-auto whitespace-pre-wrap">
                      {r.ocrText}
                    </pre>
                  </details>
                </section>
              )}

              <div className="text-xs text-gray-500">
                업로드: {fmtDateTime24(r.uploadedAt)}
                {r.ocrCompletedAt && <> · OCR 완료: {fmtDateTime24(r.ocrCompletedAt)}</>}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 p-3 border-t bg-gray-50">
            {isImage && (
              <button onClick={() => setShowSplit(true)}
                className="px-3 py-1.5 text-sm bg-purple-600 hover:bg-purple-700 text-white rounded">
                ✂ 분할
              </button>
            )}
            <button onClick={reprocess} disabled={reprocessing}
              className="px-3 py-1.5 text-sm bg-gray-200 hover:bg-gray-300 rounded disabled:opacity-50">
              {reprocessing ? "처리 중..." : "재OCR"}
            </button>
            <button onClick={remove} disabled={deleting}
              className="px-3 py-1.5 text-sm bg-red-100 hover:bg-red-200 text-red-700 rounded disabled:opacity-50">
              {deleting ? "삭제 중..." : "삭제"}
            </button>
            <span className="ml-auto text-xs text-gray-400">ESC 닫기</span>
          </div>
        </div>
      </div>

      {showSplit && (
        <ReceiptSplitModal
          receiptId={receiptId}
          onClose={() => setShowSplit(false)}
          onSuccess={async (n) => {
            setShowSplit(false);
            await onChange();
            onClose();
            setTimeout(() => alert(`${n}개 영수증으로 분할되었습니다. (OCR 처리 중)`), 100);
          }}
        />
      )}
    </>
  );
}
