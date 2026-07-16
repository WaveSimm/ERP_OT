"use client";

import { useEffect, useRef, useState } from "react";
import { expenseApi } from "@/lib/api";
import { fmtDateTime24 } from "@/lib/datetime";
import { useTableSort } from "@/lib/hooks/useTableSort";
import { useBulkSelect } from "@/lib/hooks/useBulkSelect";
import ReceiptDetailModal from "@/components/expense/ReceiptDetailModal";
import { TableCard, Table, THead, Th, TBody, Tr, Td, TableEmpty } from "@/components/ui/Table";

const OCR_LABEL: Record<string, string> = {
  PENDING: "OCR 대기",
  RUNNING: "OCR 처리중",
  DONE: "OCR 완료",
  FAILED: "OCR 실패",
};

const OCR_COLOR: Record<string, string> = {
  PENDING: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
  RUNNING: "bg-blue-100 text-blue-700 animate-pulse dark:bg-blue-500/20 dark:text-blue-300",
  DONE: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
  FAILED: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300",
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
        case "matches": {
          const confirmed = (r.matches ?? []).filter((m: any) => m.confirmedAt).length;
          // confirmed 우선 정렬 (가중치), candidate는 작은 값
          return confirmed * 1000 + ((r.matches?.length ?? 0) - confirmed);
        }
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
        <div className="p-3 rounded-md text-sm bg-green-50 text-green-700 border border-green-200 dark:text-green-300 dark:border-green-800">{msg}</div>
      )}

      {/* 일괄 작업 바 + 업로드 액션 */}
      <div className={`-mt-5 border rounded-lg p-3 mb-6 flex flex-wrap items-center gap-2 transition-colors shadow-sm ${
        sel.count > 0 ? "bg-red-50 border-red-300 dark:border-red-800" : "bg-white border-gray-300"
      }`}>
        <span className={`text-sm font-medium ${sel.count > 0 ? "text-red-900 dark:text-red-300" : "text-gray-500"}`}>
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

      <TableCard>
        <Table columnDividers>
          <THead>
            <Th align="center" className="w-8">
              <input type="checkbox" checked={sel.isAllSelected()} onChange={sel.toggleAll}
                ref={sel.headerRef} className="cursor-pointer" />
            </Th>
            <Th align="center">미리보기</Th>
            <Th align="center" onClick={() => sort.handleSort("originalFileName")} className="cursor-pointer hover:bg-gray-100 select-none">파일명{sort.sortIndicator("originalFileName")}</Th>
            <Th align="center" onClick={() => sort.handleSort("ocrStatus")} className="cursor-pointer hover:bg-gray-100 select-none">OCR{sort.sortIndicator("ocrStatus")}</Th>
            <Th align="center" onClick={() => sort.handleSort("extractedMerchant")} className="cursor-pointer hover:bg-gray-100 select-none">추출 가맹점{sort.sortIndicator("extractedMerchant")}</Th>
            <Th align="center" onClick={() => sort.handleSort("extractedAmount")} className="cursor-pointer hover:bg-gray-100 select-none">추출 금액{sort.sortIndicator("extractedAmount")}</Th>
            <Th align="center" onClick={() => sort.handleSort("extractedDate")} className="cursor-pointer hover:bg-gray-100 select-none">추출 일시{sort.sortIndicator("extractedDate")}</Th>
            <Th align="center" onClick={() => sort.handleSort("matches")} className="cursor-pointer hover:bg-gray-100 select-none">매칭{sort.sortIndicator("matches")}</Th>
            <Th align="center" onClick={() => sort.handleSort("uploadedAt")} className="cursor-pointer hover:bg-gray-100 select-none">업로드{sort.sortIndicator("uploadedAt")}</Th>
          </THead>
          <TBody>
            {loading ? (
              <TableEmpty colSpan={9}>불러오는 중...</TableEmpty>
            ) : sortedItems.length === 0 ? (
              <TableEmpty colSpan={9}>아직 영수증이 없습니다.</TableEmpty>
            ) : sortedItems.map((r) => {
              const checked = sel.isSelected(r.id);
              return (
                <Tr key={r.id} onClick={() => setDetailId(r.id)}
                  className={checked ? "bg-blue-50/40 hover:bg-blue-50/60 dark:bg-blue-500/10 dark:hover:bg-blue-500/20" : ""}>
                  <Td align="center" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={checked}
                      onMouseDown={sel.handleMouseDown}
                      onChange={() => sel.handleChange(r.id)}
                      className="cursor-pointer" />
                  </Td>
                  <Td align="center" onClick={(e) => e.stopPropagation()}>
                    {r.fileType?.startsWith("image/") ? (
                      <a href={expenseApi.receiptDownloadUrl(r.id)} target="_blank" rel="noopener">
                        <img src={expenseApi.receiptDownloadUrl(r.id)} alt={r.originalFileName}
                          className="w-12 h-12 object-cover rounded border border-gray-200 inline-block" />
                      </a>
                    ) : (
                      <a href={expenseApi.receiptDownloadUrl(r.id)} target="_blank" rel="noopener"
                        className="text-xs hover:underline">📄</a>
                    )}
                  </Td>
                  <Td className="max-w-[200px] truncate text-xs" title={r.originalFileName}>{r.originalFileName}</Td>
                  <Td align="center" onClick={(e) => e.stopPropagation()}>
                    <div className="inline-flex items-center gap-1">
                      <span className={`text-xs px-2 py-0.5 rounded whitespace-nowrap ${OCR_COLOR[r.ocrStatus] ?? "bg-gray-100 dark:bg-gray-700 dark:text-gray-300"}`}>
                        {OCR_LABEL[r.ocrStatus] ?? r.ocrStatus}
                      </span>
                      {(r.ocrStatus === "FAILED" || r.ocrStatus === "DONE") && (
                        <button
                          onClick={() => retryOcr(r.id)}
                          disabled={retryingId === r.id}
                          title="OCR 재시도"
                          className="text-xs px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50">
                          {retryingId === r.id ? "..." : "🔄"}
                        </button>
                      )}
                    </div>
                  </Td>
                  <Td dash>{r.extractedMerchant}</Td>
                  <Td align="right" mono>{r.extractedAmount ? Number(r.extractedAmount).toLocaleString() : <span className="text-gray-400">-</span>}</Td>
                  <Td align="center" mono className="whitespace-nowrap">{r.extractedDate ? fmtDateTime24(r.extractedDate, { short: true }) : "-"}</Td>
                  <Td align="center">
                    {(() => {
                      const confirmed = (r.matches ?? []).filter((m: any) => m.confirmedAt).length;
                      const candidate = (r.matches ?? []).filter((m: any) => !m.confirmedAt).length;
                      if (confirmed > 0) return <span className="text-emerald-600 dark:text-emerald-400">📎 {confirmed}</span>;
                      if (candidate > 0) return <span className="text-amber-600 dark:text-amber-400">⚡{candidate}</span>;
                      return <span className="text-gray-400">없음</span>;
                    })()}
                  </Td>
                  <Td align="center" mono className="whitespace-nowrap">{fmtDateTime24(r.uploadedAt, { short: true })}</Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      </TableCard>

      {detailId && (
        <ReceiptDetailModal
          receiptId={detailId}
          onClose={handleModalClose}
          onChange={load}
          onSplit={(createdIds) => {
            // 분할된 영수증들을 큐 맨 앞에 삽입
            setUploadQueue([...createdIds.slice(1), ...uploadQueue]);
            setDetailId(createdIds[0]);
          }}
        />
      )}
    </div>
  );
}
