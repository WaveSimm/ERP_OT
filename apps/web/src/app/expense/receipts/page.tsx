"use client";

import { useEffect, useRef, useState } from "react";
import { expenseApi } from "@/lib/api";
import { fmtDateTime24 } from "@/lib/datetime";
import { useTableSort } from "@/lib/hooks/useTableSort";
import { useBulkSelect } from "@/lib/hooks/useBulkSelect";
import ReceiptDetailModal from "@/components/expense/ReceiptDetailModal";

const OCR_LABEL: Record<string, string> = {
  PENDING: "OCR 대기",
  RUNNING: "OCR 처리중",
  DONE: "OCR 완료",
  FAILED: "OCR 실패",
};

const OCR_COLOR: Record<string, string> = {
  PENDING: "bg-gray-100 text-gray-600",
  RUNNING: "bg-blue-100 text-blue-700 animate-pulse",
  DONE: "bg-emerald-100 text-emerald-700",
  FAILED: "bg-red-100 text-red-700",
};

export default function ReceiptsPage() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [uploadQueue, setUploadQueue] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const retryOcr = async (id: string) => {
    setRetryingId(id);
    try {
      await expenseApi.reprocessReceipt(id);
      // 즉시 PENDING 표시되도록 로컬 상태 갱신
      setItems((prev) => prev.map((r) => r.id === id ? { ...r, ocrStatus: "PENDING", extractedAmount: null, extractedMerchant: null, extractedDate: null } : r));
      // 잠시 후 새로고침 (서버측 OCR 진행 반영)
      setTimeout(load, 1500);
    } catch (e: any) {
      alert("재OCR 실패: " + (e.message ?? e));
    } finally {
      setRetryingId(null);
    }
  };

  type SortKey = "uploadedAt" | "originalFileName" | "ocrStatus" | "extractedMerchant" | "extractedAmount" | "extractedDate" | "matches";
  const sort = useTableSort<any, SortKey>(items, {
    initialKey: "uploadedAt",
    initialDir: "desc",
    keyExtractor: (r, key) => {
      switch (key) {
        case "uploadedAt": return new Date(r.uploadedAt);
        case "originalFileName": return r.originalFileName ?? "";
        case "ocrStatus": return r.ocrStatus;
        case "extractedMerchant": return r.extractedMerchant ?? "";
        case "extractedAmount": return r.extractedAmount != null ? Number(r.extractedAmount) : null;
        case "extractedDate": return r.extractedDate ? new Date(r.extractedDate) : null;
        case "matches": return r.matches?.length ?? 0;
      }
    },
  });
  const sortedItems = sort.sortedItems;
  const sel = useBulkSelect<any>(sortedItems, (r) => r.id);

  const load = async () => {
    setLoading(true);
    try {
      const r = await expenseApi.listReceipts({ limit: 100 });
      setItems(r.items);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  // OCR 처리 중인 영수증이 있으면 5초마다 새로고침
  useEffect(() => {
    const running = items.some((r) => r.ocrStatus === "PENDING" || r.ocrStatus === "RUNNING");
    if (!running) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [items]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setUploading(true);
    setMsg(null);
    const uploaded: any[] = [];
    let fail = 0;
    for (const file of files) {
      try {
        const r = await expenseApi.uploadReceipt(file);
        uploaded.push(r);
      } catch (err: any) {
        fail++;
        console.error(err);
      }
    }
    setMsg(`✅ ${uploaded.length}건 업로드 완료${fail > 0 ? ` / ${fail}건 실패` : ""}`);
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
    await load();

    // 업로드 직후 첫 영수증 모달 자동 오픈, 나머지는 큐로 (모달 닫을 때마다 다음으로 진행)
    if (uploaded.length > 0) {
      const ids = uploaded.map((r) => r.id);
      setUploadQueue(ids.slice(1));
      setDetailId(ids[0]);
    }
  };

  const handleModalClose = () => {
    if (uploadQueue.length > 0) {
      const next = uploadQueue[0];
      setUploadQueue(uploadQueue.slice(1));
      setDetailId(next);
    } else {
      setDetailId(null);
    }
  };

  const bulkDelete = async () => {
    if (sel.count === 0) return;
    if (!confirm(`${sel.count}건의 영수증을 삭제하시겠습니까?\n삭제 후에는 되돌릴 수 없습니다.`)) return;
    setBulkDeleting(true);
    try {
      const results = await Promise.allSettled(sel.ids.map((id) => expenseApi.deleteReceipt(id)));
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed > 0) alert(`${failed}건 삭제 실패`);
      sel.clear();
      await load();
    } finally {
      setBulkDeleting(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-6 space-y-4">
      {msg && (
        <div className="p-3 rounded-md text-sm bg-green-50 text-green-700 border border-green-200">{msg}</div>
      )}

      {/* 일괄 작업 바 + 업로드 액션 */}
      <div className={`-mt-5 border rounded-lg p-3 mb-6 flex flex-wrap items-center gap-2 transition-colors shadow-sm ${
        sel.count > 0 ? "bg-red-50 border-red-300" : "bg-white border-gray-300"
      }`}>
        <span className={`text-sm font-medium ${sel.count > 0 ? "text-red-900" : "text-gray-500"}`}>
          {sel.count > 0 ? `선택 ${sel.count}건` : "선택된 항목 없음"}
        </span>
        <button onClick={bulkDelete} disabled={bulkDeleting || sel.count === 0}
          className="px-3 py-1 text-sm rounded enabled:bg-red-600 enabled:text-white enabled:hover:bg-red-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed">
          {bulkDeleting ? "삭제 중..." : "선택 삭제"}
        </button>
        {sel.count > 0 && (
          <button onClick={sel.clear} className="text-xs text-gray-600 hover:text-gray-800">선택 해제</button>
        )}
        <span className="text-[11px] text-gray-500">💡 행 클릭으로 상세보기 · Shift+체크박스로 범위 선택</span>
        <div className="ml-auto">
          <input ref={fileRef} type="file" multiple accept="image/*,.pdf"
            onChange={handleUpload} disabled={uploading} className="hidden" id="receipt-upload" />
          <label htmlFor="receipt-upload"
            className={`px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 cursor-pointer ${uploading ? "opacity-50 pointer-events-none" : ""}`}>
            {uploading ? "업로드 중..." : "+ 영수증 업로드 (다중)"}
          </label>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr className="text-xs text-gray-500">
              <th className="px-3 py-2 w-8 text-center">
                <input type="checkbox" checked={sel.isAllSelected()} onChange={sel.toggleAll}
                  ref={sel.headerRef} className="cursor-pointer" />
              </th>
              <th className="px-3 py-2 text-left">미리보기</th>
              <th onClick={() => sort.handleSort("originalFileName")} className="px-3 py-2 text-left cursor-pointer hover:bg-gray-100 select-none">파일명{sort.sortIndicator("originalFileName")}</th>
              <th onClick={() => sort.handleSort("ocrStatus")} className="px-3 py-2 text-center cursor-pointer hover:bg-gray-100 select-none">OCR{sort.sortIndicator("ocrStatus")}</th>
              <th onClick={() => sort.handleSort("extractedMerchant")} className="px-3 py-2 text-left cursor-pointer hover:bg-gray-100 select-none">추출 가맹점{sort.sortIndicator("extractedMerchant")}</th>
              <th onClick={() => sort.handleSort("extractedAmount")} className="px-3 py-2 text-right cursor-pointer hover:bg-gray-100 select-none">추출 금액{sort.sortIndicator("extractedAmount")}</th>
              <th onClick={() => sort.handleSort("extractedDate")} className="px-3 py-2 text-left cursor-pointer hover:bg-gray-100 select-none">추출 일시{sort.sortIndicator("extractedDate")}</th>
              <th onClick={() => sort.handleSort("matches")} className="px-3 py-2 text-center cursor-pointer hover:bg-gray-100 select-none">매칭{sort.sortIndicator("matches")}</th>
              <th onClick={() => sort.handleSort("uploadedAt")} className="px-3 py-2 text-left cursor-pointer hover:bg-gray-100 select-none">업로드{sort.sortIndicator("uploadedAt")}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="py-12 text-center text-gray-400">불러오는 중...</td></tr>
            ) : sortedItems.length === 0 ? (
              <tr><td colSpan={9} className="py-12 text-center text-gray-400">아직 영수증이 없습니다.</td></tr>
            ) : sortedItems.map((r) => {
              const checked = sel.isSelected(r.id);
              return (
                <tr key={r.id}
                  onClick={() => setDetailId(r.id)}
                  className={`border-t border-gray-100 cursor-pointer hover:bg-gray-50 ${checked ? "bg-blue-50/40 hover:bg-blue-50/60" : ""}`}>
                  <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={checked}
                      onMouseDown={sel.handleMouseDown}
                      onChange={() => sel.handleChange(r.id)}
                      className="cursor-pointer" />
                  </td>
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    {r.fileType?.startsWith("image/") ? (
                      <a href={expenseApi.receiptDownloadUrl(r.id)} target="_blank" rel="noopener">
                        <img src={expenseApi.receiptDownloadUrl(r.id)} alt={r.originalFileName}
                          className="w-12 h-12 object-cover rounded border border-gray-200" />
                      </a>
                    ) : (
                      <a href={expenseApi.receiptDownloadUrl(r.id)} target="_blank" rel="noopener"
                        className="text-blue-600 text-xs hover:underline">📄</a>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-700 max-w-[200px] truncate" title={r.originalFileName}>{r.originalFileName}</td>
                  <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                    <div className="inline-flex items-center gap-1">
                      <span className={`text-xs px-2 py-0.5 rounded ${OCR_COLOR[r.ocrStatus] ?? "bg-gray-100"}`}>
                        {OCR_LABEL[r.ocrStatus] ?? r.ocrStatus}
                      </span>
                      {(r.ocrStatus === "FAILED" || r.ocrStatus === "DONE") && (
                        <button
                          onClick={() => retryOcr(r.id)}
                          disabled={retryingId === r.id}
                          title="OCR 재시도"
                          className="text-xs px-1.5 py-0.5 border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50">
                          {retryingId === r.id ? "..." : "🔄"}
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-sm">{r.extractedMerchant ?? <span className="text-gray-400">-</span>}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.extractedAmount ? Number(r.extractedAmount).toLocaleString() : <span className="text-gray-400">-</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-600">
                    {r.extractedDate ? fmtDateTime24(r.extractedDate, { short: true }) : <span className="text-gray-400">-</span>}
                  </td>
                  <td className="px-3 py-2 text-center text-xs">
                    {r.matches?.length > 0 ? (
                      <span className="text-emerald-600">📎 {r.matches.length}</span>
                    ) : (
                      <span className="text-gray-400">없음</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{fmtDateTime24(r.uploadedAt, { short: true })}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {detailId && (
        <ReceiptDetailModal
          receiptId={detailId}
          onClose={handleModalClose}
          onChange={load}
        />
      )}
    </div>
  );
}
