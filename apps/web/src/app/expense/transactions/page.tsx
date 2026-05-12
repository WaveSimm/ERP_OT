"use client";

import { useEffect, useState, useRef } from "react";
import { expenseApi } from "@/lib/api";
import { fmtDateTime24 } from "@/lib/datetime";
import { useTableSort } from "@/lib/hooks/useTableSort";
import { useBulkSelect } from "@/lib/hooks/useBulkSelect";
import ReceiptDetailModal from "@/components/expense/ReceiptDetailModal";

const STATUS_LABELS: Record<string, string> = {
  PENDING: "미분류",
  CATEGORIZED: "분류완료",
  EXCLUDED: "제외",
  CANCELED: "취소",
  SETTLED: "정산됨",
};

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-700",
  CATEGORIZED: "bg-blue-100 text-blue-700",
  EXCLUDED: "bg-gray-100 text-gray-500",
  CANCELED: "bg-red-100 text-red-700",
  SETTLED: "bg-emerald-100 text-emerald-700",
};

export default function TransactionsPage() {
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [importing, setImporting] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const [sources, setSources] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [settlements, setSettlements] = useState<any[]>([]);

  const [bulkCategoryId, setBulkCategoryId] = useState("");
  const [bulkDetail, setBulkDetail] = useState("");
  const [bulkMemo, setBulkMemo] = useState("");
  const [bulkSettlementId, setBulkSettlementId] = useState(""); // "" | settlementId | "__new__" | "__clear__"
  const [bulkApplying, setBulkApplying] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [receiptModalId, setReceiptModalId] = useState<string | null>(null);

  // 가상 상태 client-side 필터 적용
  const filteredItems = items.filter((t: any) => {
    if (statusFilter === "UNSETTLED") {
      // CATEGORIZED + 정산묶음 없음
      return t.status === "CATEGORIZED" && (!t.settlementItems || t.settlementItems.length === 0);
    }
    if (statusFilter === "UNAPPROVED") {
      // 정산묶음에 들어갔지만 결재 상신 전 (settlement.status === DRAFT)
      return (t.settlementItems ?? []).some((si: any) => si.settlement?.status === "DRAFT");
    }
    return true;
  });

  type SortKey = "transactedAt" | "merchant" | "source" | "amount" | "category" | "detail" | "memo" | "receipt" | "status";
  const sort = useTableSort<any, SortKey>(filteredItems, {
    initialKey: "transactedAt",
    initialDir: "desc",
    keyExtractor: (t, key) => {
      switch (key) {
        case "transactedAt": return new Date(t.transactedAt);
        case "merchant": return t.merchantName ?? "";
        case "source": return t.source?.displayName ?? t.source?.name ?? "";
        case "amount": return Number(t.amount);
        case "category": return t.category?.name ?? "";
        case "detail": return t.detail ?? "";
        case "memo": return t.memo ?? "";
        case "receipt": {
          // 확정 매칭 > 후보 > 없음 순
          const matches = t.matches ?? [];
          const confirmed = matches.some((m: any) => m.confirmedAt);
          if (confirmed) return 2;
          if (matches.length > 0) return 1;
          return 0;
        }
        case "status": return t.status;
      }
    },
  });
  const sortedItems = sort.sortedItems;

  const sel = useBulkSelect<any>(sortedItems, (t) => t.id);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      // 가상 상태 (UNSETTLED/UNAPPROVED) → 백엔드는 CATEGORIZED로 호출
      const apiStatus =
        statusFilter === "UNSETTLED" || statusFilter === "UNAPPROVED"
          ? "CATEGORIZED"
          : statusFilter;
      const [tx, srcs, cats, stls] = await Promise.all([
        expenseApi.listTransactions({ ...(apiStatus && { status: apiStatus }), limit: 200 }),
        expenseApi.listSources(),
        expenseApi.listCategories(),
        expenseApi.listSettlements({ status: "DRAFT", limit: 100 }).catch(() => ({ items: [] as any[] })),
      ]);
      setSettlements((stls as any).items ?? []);
      // 현금(CASH) 소스 없으면 자동 생성 (수동 입력 dropdown 가장 상단 노출용)
      let allSources = srcs;
      if (!srcs.some((s) => s.type === "CASH" && s.active)) {
        try {
          const cashSrc = await expenseApi.createSource({
            name: "현금",
            displayName: "현금",
            type: "CASH",
          });
          allSources = [cashSrc, ...srcs];
        } catch { /* 이미 있거나 실패 — 무시 */ }
      }
      // CASH 우선, 그 외는 대표이름 순
      allSources = [...allSources].sort((a, b) => {
        if (a.type === "CASH" && b.type !== "CASH") return -1;
        if (a.type !== "CASH" && b.type === "CASH") return 1;
        const an = a.displayName ?? a.name ?? "";
        const bn = b.displayName ?? b.name ?? "";
        return an.localeCompare(bn);
      });
      setItems(tx.items);
      setTotal(tx.total);
      setSources(allSources);
      setCategories(cats);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [statusFilter]);

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportMsg(null);
    try {
      const result = await expenseApi.importStatement(file);
      setImportMsg(`✅ ${result.cardCompany} ${result.insertedTransactions}건 추가 (${result.skippedDuplicates}건 중복 skip)`);
      await load();
    } catch (err: any) {
      setImportMsg(`❌ ${err.message}`);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const updateCategory = async (id: string, categoryId: string) => {
    await expenseApi.updateTransaction(id, { categoryId: categoryId || null });
    await load();
  };

  const updateMemo = async (id: string, memo: string) => {
    await expenseApi.updateTransaction(id, { memo });
    await load();
  };

  const updateDetail = async (id: string, detail: string) => {
    await expenseApi.updateTransaction(id, { detail });
    await load();
  };

  /**
   * 거래의 정산분류 변경. settlementId가 "__new__"면 거래의 카테고리-detail로 새 정산 묶음 생성.
   * "__clear__"는 정산 해제.
   */
  const updateSettlement = async (tx: any, settlementId: string) => {
    try {
      if (settlementId === "__new__") {
        const cat = tx.category?.name ?? "";
        const detail = (tx.detail ?? "").trim();
        const ymd = new Date(tx.transactedAt).toISOString().slice(0, 10);
        const tail = (cat && detail) ? `${cat}-${detail}` : (cat || detail || tx.merchantName);
        const title = `${ymd} ${tail}`;
        const created = await expenseApi.createEmptySettlement({ title });
        await expenseApi.setTransactionSettlement(tx.id, created.id);
      } else if (settlementId === "__clear__" || settlementId === "") {
        await expenseApi.setTransactionSettlement(tx.id, null);
      } else {
        await expenseApi.setTransactionSettlement(tx.id, settlementId);
      }
      await load();
    } catch (err: any) {
      alert(err.message ?? "정산분류 변경 실패");
    }
  };

  const bulkDelete = async () => {
    if (sel.count === 0) return;
    if (!confirm(`${sel.count}건의 거래를 삭제하시겠습니까?\n매칭된 영수증과 정산묶음 할당도 해제됩니다.`)) return;
    setBulkDeleting(true);
    try {
      const results = await Promise.allSettled(
        sel.ids.map((id) => expenseApi.deleteTransaction(id)),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed > 0) alert(`${failed}건 삭제 실패`);
      sel.clear();
      await load();
    } finally {
      setBulkDeleting(false);
    }
  };

  const applyBulk = async () => {
    if (sel.count === 0) return;
    if (!bulkCategoryId && !bulkDetail && !bulkMemo && !bulkSettlementId) {
      alert("카테고리·상세 내역·메모·정산분류 중 하나는 선택해야 합니다.");
      return;
    }
    const settlementLabel = bulkSettlementId === "__new__"
      ? "정산분류: + 새 정산 (선택한 첫 거래의 상세내역으로 생성)"
      : bulkSettlementId === "__clear__"
        ? "정산분류: 미설정"
        : bulkSettlementId
          ? `정산분류: ${settlements.find((s) => s.id === bulkSettlementId)?.title ?? bulkSettlementId}`
          : "";
    const lines = [
      bulkCategoryId && `카테고리: ${categories.find((c) => c.id === bulkCategoryId)?.name}`,
      bulkDetail && `상세 내역: ${bulkDetail}`,
      bulkMemo && `메모: ${bulkMemo}`,
      settlementLabel,
    ].filter(Boolean).join("\n");
    if (!confirm(`${sel.count}건의 거래에 적용하시겠습니까?\n${lines}`)) return;

    setBulkApplying(true);
    try {
      const updateData: any = {};
      if (bulkCategoryId) updateData.categoryId = bulkCategoryId;
      if (bulkDetail) updateData.detail = bulkDetail;
      if (bulkMemo) updateData.memo = bulkMemo;

      // 1단계: 거래 메타 일괄 업데이트
      if (Object.keys(updateData).length > 0) {
        const results = await Promise.allSettled(
          sel.ids.map((id) => expenseApi.updateTransaction(id, updateData)),
        );
        const failed = results.filter((r) => r.status === "rejected").length;
        if (failed > 0) alert(`거래 업데이트 ${failed}건 실패`);
      }

      // 2단계: 정산분류 일괄 적용
      if (bulkSettlementId) {
        let targetSettlementId: string | null;
        if (bulkSettlementId === "__new__") {
          // 새 정산 묶음 생성: 'YYYY-MM-DD 카테고리-상세내역' 조합을 중복 제거하여 '/'로 join
          const selectedTxs = sortedItems.filter((t) => sel.isSelected(t.id));
          // 거래일 가장 빠른 거래의 날짜를 제목 앞에 붙임
          const earliestDate = selectedTxs.length > 0
            ? new Date(Math.min(...selectedTxs.map((t) => new Date(t.transactedAt).getTime()))).toISOString().slice(0, 10)
            : new Date().toISOString().slice(0, 10);
          let tail: string;
          if (bulkCategoryId || bulkDetail.trim()) {
            const cat = bulkCategoryId ? categories.find((c) => c.id === bulkCategoryId)?.name ?? "" : "";
            const det = bulkDetail.trim();
            tail = (cat && det) ? `${cat}-${det}` : (cat || det);
          } else {
            const pairs = Array.from(new Set(
              selectedTxs.map((t) => {
                const cat = t.category?.name ?? "";
                const detail = (t.detail ?? "").trim();
                if (cat && detail) return `${cat}-${detail}`;
                if (cat) return cat;
                if (detail) return detail;
                return null;
              }).filter(Boolean) as string[],
            ));
            tail = pairs.length > 0 ? pairs.join(" / ") : (selectedTxs[0]?.merchantName ?? "정산");
          }
          const title = `${earliestDate} ${tail}`;
          const created = await expenseApi.createEmptySettlement({ title });
          targetSettlementId = created.id;
        } else if (bulkSettlementId === "__clear__") {
          targetSettlementId = null;
        } else {
          targetSettlementId = bulkSettlementId;
        }
        const results = await Promise.allSettled(
          sel.ids.map((id) => expenseApi.setTransactionSettlement(id, targetSettlementId)),
        );
        const failed = results.filter((r) => r.status === "rejected").length;
        if (failed > 0) alert(`정산분류 ${failed}건 실패`);
      }

      sel.clear();
      setBulkCategoryId("");
      setBulkDetail("");
      setBulkMemo("");
      setBulkSettlementId("");
      await load();
    } finally {
      setBulkApplying(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-6 space-y-4">
      {importMsg && (
        <div className={`p-3 rounded-md text-sm ${importMsg.startsWith("✅") ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
          {importMsg}
        </div>
      )}

      {/* 상태 필터 + 액션 버튼 */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-gray-500">상태:</span>
        {[
          { v: "", l: "전체" },
          { v: "PENDING", l: "미분류" },
          { v: "UNSETTLED", l: "미정산분류" },
          { v: "UNAPPROVED", l: "미결재" },
          { v: "SETTLED", l: "정산됨" },
          { v: "EXCLUDED", l: "제외" },
        ].map((s) => (
          <button key={s.v} onClick={() => setStatusFilter(s.v)}
            className={`px-2.5 py-1 text-xs rounded-md ${statusFilter === s.v ? "bg-blue-600 text-white" : "border border-gray-300 text-gray-600 hover:bg-gray-50"}`}>
            {s.l}
          </button>
        ))}
        <span className="text-xs text-gray-500">
          {statusFilter === "UNSETTLED" || statusFilter === "UNAPPROVED"
            ? `${filteredItems.length}건`
            : `총 ${total}건`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <input ref={fileInputRef} type="file" accept=".xls,.xlsx,.html"
            onChange={handleImport} disabled={importing} className="hidden" id="stmt-import" />
          <label htmlFor="stmt-import"
            className={`px-3 py-1.5 text-sm border border-blue-300 text-blue-700 rounded-md hover:bg-blue-50 cursor-pointer ${importing ? "opacity-50 pointer-events-none" : ""}`}>
            {importing ? "import 중..." : "📥 카드 명세서 import"}
          </label>
          <button onClick={() => setShowManual(true)}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700">
            + 수동 입력
          </button>
        </div>
      </div>

      {/* 일괄 작업 바 — 항상 표시 */}
      <div className={`-mt-5 border rounded-lg p-3 mb-6 flex flex-wrap items-center gap-2 transition-colors shadow-sm ${
        sel.count > 0 ? "bg-blue-50 border-blue-300" : "bg-white border-gray-300"
      }`}>
        <span className={`text-sm font-medium ${sel.count > 0 ? "text-blue-900" : "text-gray-500"}`}>
          {sel.count > 0 ? `선택 ${sel.count}건` : "선택된 항목 없음"}
        </span>
        <span className="text-xs text-gray-600 mr-2">일괄 적용:</span>
        <select value={bulkCategoryId} onChange={(e) => setBulkCategoryId(e.target.value)}
          disabled={sel.count === 0}
          className="text-sm border border-gray-300 rounded px-2 py-1 disabled:bg-gray-100 disabled:text-gray-400">
          <option value="">카테고리 (변경 안 함)</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input type="text" value={bulkDetail} onChange={(e) => setBulkDetail(e.target.value)}
          disabled={sel.count === 0}
          placeholder="상세 내역 (변경 안 함)"
          className="text-sm border border-gray-300 rounded px-2 py-1 flex-1 min-w-[160px] disabled:bg-gray-100" />
        <input type="text" value={bulkMemo} onChange={(e) => setBulkMemo(e.target.value)}
          disabled={sel.count === 0}
          placeholder="메모 (변경 안 함)"
          className="text-sm border border-gray-300 rounded px-2 py-1 flex-1 min-w-[160px] disabled:bg-gray-100" />
        <select value={bulkSettlementId} onChange={(e) => setBulkSettlementId(e.target.value)}
          disabled={sel.count === 0}
          className="text-sm border border-gray-300 rounded px-2 py-1 disabled:bg-gray-100 disabled:text-gray-400">
          <option value="">정산분류 (변경 안 함)</option>
          <option value="__clear__">— 미설정 —</option>
          <option value="__new__">+ 새 정산 (상세내역으로 제목)</option>
          {settlements.length > 0 && <option disabled>──────────</option>}
          {settlements.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select>
        <button onClick={applyBulk}
          disabled={bulkApplying || sel.count === 0 || (!bulkCategoryId && !bulkDetail && !bulkMemo && !bulkSettlementId)}
          className="px-3 py-1 text-sm rounded transition-colors enabled:bg-blue-600 enabled:text-white enabled:hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed">
          {bulkApplying ? "적용 중..." : "일괄 적용"}
        </button>
        <button onClick={bulkDelete}
          disabled={bulkDeleting || sel.count === 0}
          className="px-3 py-1 text-sm rounded enabled:bg-red-600 enabled:text-white enabled:hover:bg-red-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed">
          {bulkDeleting ? "삭제 중..." : "선택 삭제"}
        </button>
        {sel.count > 0 && (
          <button onClick={sel.clear} className="text-xs text-gray-600 hover:text-gray-800">선택 해제</button>
        )}
        <span className="ml-auto text-[11px] text-gray-500">💡 Shift+클릭으로 범위 선택</span>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr className="text-xs text-gray-500">
              <th className="px-3 py-2 w-8 text-center">
                <input type="checkbox" checked={sel.isAllSelected()} onChange={sel.toggleAll}
                  ref={sel.headerRef} className="cursor-pointer" />
              </th>
              <th onClick={() => sort.handleSort("transactedAt")} className="px-3 py-2 text-left cursor-pointer hover:bg-gray-100 select-none">거래일시{sort.sortIndicator("transactedAt")}</th>
              <th onClick={() => sort.handleSort("merchant")} className="px-3 py-2 text-left cursor-pointer hover:bg-gray-100 select-none">가맹점{sort.sortIndicator("merchant")}</th>
              <th onClick={() => sort.handleSort("source")} className="px-3 py-2 text-left cursor-pointer hover:bg-gray-100 select-none">결제수단{sort.sortIndicator("source")}</th>
              <th onClick={() => sort.handleSort("amount")} className="px-3 py-2 text-right cursor-pointer hover:bg-gray-100 select-none">금액{sort.sortIndicator("amount")}</th>
              <th onClick={() => sort.handleSort("category")} className="px-3 py-2 text-left cursor-pointer hover:bg-gray-100 select-none">카테고리{sort.sortIndicator("category")}</th>
              <th onClick={() => sort.handleSort("detail")} className="px-3 py-2 text-left cursor-pointer hover:bg-gray-100 select-none">상세 내역{sort.sortIndicator("detail")}</th>
              <th onClick={() => sort.handleSort("memo")} className="px-3 py-2 text-left cursor-pointer hover:bg-gray-100 select-none">메모{sort.sortIndicator("memo")}</th>
              <th onClick={() => sort.handleSort("receipt")} className="px-3 py-2 text-center cursor-pointer hover:bg-gray-100 select-none whitespace-nowrap">영수증{sort.sortIndicator("receipt")}</th>
              <th onClick={() => sort.handleSort("status")} className="px-3 py-2 text-center cursor-pointer hover:bg-gray-100 select-none">상태{sort.sortIndicator("status")}</th>
              <th className="px-3 py-2 text-left">정산분류</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} className="py-12 text-center text-gray-400">불러오는 중...</td></tr>
            ) : sortedItems.length === 0 ? (
              <tr><td colSpan={11} className="py-12 text-center text-gray-400">거래가 없습니다.</td></tr>
            ) : sortedItems.map((t) => {
              const checked = sel.isSelected(t.id);
              return (
                <tr key={t.id}
                  className={`border-t border-gray-100 ${t.isCanceled ? "bg-red-50/30" : ""} ${checked ? "bg-blue-50/40" : ""}`}>
                  <td className="px-3 py-2 text-center">
                    <input type="checkbox" checked={checked}
                      onMouseDown={sel.handleMouseDown}
                      onChange={() => sel.handleChange(t.id)}
                      className="cursor-pointer" />
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">{fmtDateTime24(t.transactedAt, { short: true })}</td>
                  <td className="px-3 py-2 text-gray-800">
                    <span className={t.isCanceled ? "line-through text-gray-400" : ""}>{t.merchantName}</span>
                    {t.isCanceled && (
                      <span className="ml-2 px-1.5 py-0.5 text-[10px] font-medium bg-red-100 text-red-700 rounded">취소</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">{t.source?.displayName ?? t.source?.name ?? "-"}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">
                    {Number(t.amount).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    <select value={t.categoryId ?? ""} onChange={(e) => updateCategory(t.id, e.target.value)}
                      className="text-xs border border-gray-300 rounded px-1.5 py-0.5 max-w-[120px]">
                      <option value="">선택</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input type="text" defaultValue={t.detail ?? ""}
                      onBlur={(e) => e.target.value !== (t.detail ?? "") && updateDetail(t.id, e.target.value)}
                      className="text-xs border border-gray-200 rounded px-2 py-0.5 w-full max-w-[200px]"
                      placeholder="상세 내역..." />
                  </td>
                  <td className="px-3 py-2">
                    <input type="text" defaultValue={t.memo ?? ""}
                      onBlur={(e) => e.target.value !== (t.memo ?? "") && updateMemo(t.id, e.target.value)}
                      className="text-xs border border-gray-200 rounded px-2 py-0.5 w-full max-w-[200px]"
                      placeholder="메모..." />
                  </td>
                  <td className="px-3 py-2 text-center">
                    {(() => {
                      const matches = t.matches ?? [];
                      const confirmed = matches.find((m: any) => m.confirmedAt);
                      const candidate = matches.find((m: any) => !m.confirmedAt);
                      if (confirmed) {
                        return (
                          <button onClick={(e) => { e.stopPropagation(); setReceiptModalId(confirmed.receiptId); }}
                            title="첨부된 영수증 보기"
                            className="inline-block text-emerald-600 hover:text-emerald-700">📎</button>
                        );
                      }
                      if (candidate) {
                        return (
                          <button onClick={(e) => { e.stopPropagation(); setReceiptModalId(candidate.receiptId); }}
                            title={`매칭 후보 ${matches.length}건`}
                            className="inline-block text-amber-600 hover:text-amber-700 text-xs">⚡{matches.length}</button>
                        );
                      }
                      return <span className="text-xs text-gray-300">—</span>;
                    })()}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className={`px-2 py-0.5 text-xs rounded whitespace-nowrap ${STATUS_COLORS[t.status]}`}>
                      {STATUS_LABELS[t.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {(() => {
                      const currentItem = (t.settlementItems ?? [])[0];
                      const currentSettlementId = currentItem?.settlementId ?? "";
                      const currentStatus = currentItem?.settlement?.status;
                      const locked = currentStatus && currentStatus !== "DRAFT";
                      return (
                        <select
                          value={currentSettlementId}
                          onChange={(e) => updateSettlement(t, e.target.value)}
                          disabled={!!locked}
                          className="text-xs border border-gray-300 rounded px-1.5 py-0.5 max-w-[160px] disabled:bg-gray-100 disabled:text-gray-500"
                          title={locked ? `${currentStatus} 상태로 변경 불가` : ""}
                        >
                          <option value="">— 미설정 —</option>
                          <option value="__new__">+ 새 정산</option>
                          {settlements.length > 0 && <option disabled>──────────</option>}
                          {settlements.map((s) => (
                            <option key={s.id} value={s.id}>{s.title}</option>
                          ))}
                          {/* 현재 묶음이 DRAFT가 아닌 경우 옵션에 강제로 추가 (표시용) */}
                          {locked && currentItem?.settlement && (
                            <option value={currentSettlementId}>{currentItem.settlement.title} ({currentStatus})</option>
                          )}
                        </select>
                      );
                    })()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showManual && (
        <ManualTransactionModal
          sources={sources}
          categories={categories}
          onClose={() => setShowManual(false)}
          onSaved={() => { setShowManual(false); load(); }}
        />
      )}

      {receiptModalId && (
        <ReceiptDetailModal
          receiptId={receiptModalId}
          onClose={() => setReceiptModalId(null)}
          onChange={load}
        />
      )}
    </div>
  );
}

function ManualTransactionModal({ sources, categories, onClose, onSaved }: {
  sources: any[]; categories: any[]; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    sourceId: sources[0]?.id ?? "", // 정렬돼서 CASH가 첫 번째로 들어와 있음
    transactedAt: new Date().toISOString().slice(0, 16),
    merchantName: "",
    amount: 0,
    categoryId: "",
    detail: "",
    memo: "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.sourceId) { setErr("결제수단을 선택하세요."); return; }
    if (!form.merchantName.trim()) { setErr("가맹점명을 입력하세요."); return; }
    if (form.amount <= 0) { setErr("금액을 입력하세요."); return; }
    setSaving(true);
    try {
      await expenseApi.createTransaction({
        sourceId: form.sourceId,
        transactedAt: new Date(form.transactedAt).toISOString(),
        merchantName: form.merchantName,
        amount: form.amount,
        categoryId: form.categoryId || undefined,
        detail: form.detail || undefined,
        memo: form.memo || undefined,
      });
      onSaved();
    } catch (e: any) {
      setErr(e.message);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <h3 className="font-semibold text-gray-900 mb-4">거래 수동 입력</h3>
        <form onSubmit={submit} className="space-y-3">
          <Field label="결제수단">
            <select value={form.sourceId} onChange={(e) => setForm({ ...form, sourceId: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
              <option value="">선택</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>{s.displayName ?? s.name}</option>
              ))}
            </select>
          </Field>
          <Field label="거래일시">
            <input type="datetime-local" value={form.transactedAt}
              onChange={(e) => setForm({ ...form, transactedAt: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
          </Field>
          <Field label="가맹점명">
            <input type="text" value={form.merchantName}
              onChange={(e) => setForm({ ...form, merchantName: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
          </Field>
          <Field label="금액">
            <input type="number" min={0} value={form.amount}
              onChange={(e) => setForm({ ...form, amount: parseInt(e.target.value || "0", 10) })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm tabular-nums" />
          </Field>
          <Field label="카테고리">
            <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
              <option value="">선택 (나중에 분류 가능)</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="상세 내역">
            <input type="text" value={form.detail} onChange={(e) => setForm({ ...form, detail: e.target.value })}
              placeholder="예: 점심 식사 4명, 노트북 어댑터 등"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
          </Field>
          <Field label="메모">
            <input type="text" value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
          </Field>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 border border-gray-300 rounded-md py-2 text-sm">취소</button>
            <button type="submit" disabled={saving}
              className="flex-1 bg-blue-600 text-white rounded-md py-2 text-sm font-medium disabled:opacity-50">
              {saving ? "저장 중..." : "저장"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  );
}
