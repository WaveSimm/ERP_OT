"use client";

import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { expenseApi, procurementApi } from "@/lib/api";
import { fmtDateTime24 } from "@/lib/datetime";
import { useTableSort } from "@/lib/hooks/useTableSort";
import { useBulkSelect } from "@/lib/hooks/useBulkSelect";
import ReceiptDetailModal from "@/components/expense/ReceiptDetailModal";
import SearchableSelect from "@/components/SearchableSelect";

// v1.6.2 (2026-05-15): 사업(계약) 연계 — equipment.Contract
type Contract = { id: string; contractNumber: string; name: string; client?: string; status?: string };

// 브라우저 로컬 시간대 기준 YYYY-MM-DD (한국 사용자 = KST). toISOString은 UTC라 사용 금지.
function fmtLocalYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: "미정산분류",
  CATEGORIZED: "정산분류완료",
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

// v1.6.1 (2026-05-15): 구분 옵션 — 회계 분류용. 자유 입력도 허용.
// 2026-06-12: 회계 계정 항목 20종 (목차 순서 — 사용자 지정)
const DETAIL_OPTIONS = [
  "출장여비", "여비교통비", "차량유지비", "복리후생비", "소모품비", "비품", "잡비",
  "안전관리비", "사무용품비", "광고선전비", "운반비", "접대비", "통신비", "교육훈련비",
  "도서인쇄비", "장비임차료", "특허권", "협회비", "지급수수료", "외주용역비",
];

// v1.6.3 (2026-05-16): 구분별 상세내역 안내 placeholder (구분 교체로 초기화 — 필요 시 추가)
const DETAIL_PLACEHOLDER: Record<string, string> = {};

function getDetailPlaceholder(detail?: string | null): string {
  const key = (detail ?? "").trim();
  return DETAIL_PLACEHOLDER[key] ?? "상세내역...";
}

export default function TransactionsPage({ initialStatus = "TARGET", onChange }: { initialStatus?: string; onChange?: () => void } = {}) {
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  // v1.6.4 (2026-05-16): default = TARGET (정산대상). 가상 상태: TARGET/SETTLED/EXCLUDED/""
  const [statusFilter, setStatusFilter] = useState(initialStatus || "TARGET");

  // 부모 컴포넌트(ExpenseView)가 카드 클릭으로 initialStatus를 바꾸면 동기화
  useEffect(() => {
    setStatusFilter(initialStatus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialStatus]);
  const [importing, setImporting] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const [sources, setSources] = useState<any[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [settlements, setSettlements] = useState<any[]>([]); // DRAFT만 (dropdown 추가용)
  const [allSettlements, setAllSettlements] = useState<any[]>([]); // 모든 status (헤더 popover 필터용)
  const [settlementFilter, setSettlementFilter] = useState<string | null>(null); // 선택된 settlementId
  const [settlementFilterOpen, setSettlementFilterOpen] = useState(false);

  const [bulkContract, setBulkContract] = useState<{ id: string; number: string; name: string } | null>(null);
  const [bulkDetail, setBulkDetail] = useState("");
  const [bulkMemo, setBulkMemo] = useState("");
  const [bulkSettlementId, setBulkSettlementId] = useState(""); // "" | settlementId | "__new__" | "__clear__" | "__exclude__"
  const [bulkNewSettlementTitle, setBulkNewSettlementTitle] = useState(""); // __new__ 선택 시 prompt로 받은 제목
  const [bulkApplying, setBulkApplying] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [receiptModalId, setReceiptModalId] = useState<string | null>(null);
  const [receiptQueue, setReceiptQueue] = useState<string[]>([]);
  const receiptMultiInputRef = useRef<HTMLInputElement>(null);
  const singleReceiptInputRef = useRef<HTMLInputElement>(null);
  const [singleUploadTxId, setSingleUploadTxId] = useState<string | null>(null);

  // v1.6.4 (2026-05-16): 탭 단순화 — 정산대상/정산완료/제외/전체 + 정산분류 필터 (헤더 popover)
  const filteredItems = items.filter((t: any) => {
    // 특정 settlement 선택 시: status 탭 무시 (해당 묶음의 모든 거래 표시)
    if (settlementFilter && settlementFilter !== "__unclassified__") {
      return (t.settlementItems ?? []).some((si: any) => si.settlementId === settlementFilter);
    }
    // status 탭 필터 (미분류 + 전체에서 적용)
    if (statusFilter === "TARGET") {
      if (!(["PENDING", "CATEGORIZED"].includes(t.status) && !t.isCanceled)) return false;
    } else if (statusFilter === "UNCLASSIFIED") {
      // 미분류 — 정산분류가 '미설정'(정산묶음 미배정)인 정산대상 거래 (제외·정산완료 제외)
      if (!(["PENDING", "CATEGORIZED"].includes(t.status) && !t.isCanceled)) return false;
      if ((t.settlementItems?.length ?? 0) > 0) return false;
    } else if (statusFilter === "SETTLED") {
      if (t.status !== "SETTLED") return false;
    } else if (statusFilter === "EXCLUDED") {
      if (t.status !== "EXCLUDED") return false;
    }
    // 미분류 필터 (정산 묶음에 안 들어간 거래)
    if (settlementFilter === "__unclassified__") {
      return !t.settlementItems || t.settlementItems.length === 0;
    }
    return true;
  });

  type SortKey = "transactedAt" | "merchant" | "source" | "amount" | "contract" | "detail" | "memo" | "receipt" | "status";
  const sort = useTableSort<any, SortKey>(filteredItems, {
    initialKey: "transactedAt",
    initialDir: "desc",
    keyExtractor: (t, key) => {
      switch (key) {
        case "transactedAt": return new Date(t.transactedAt);
        case "merchant": return t.merchantName ?? "";
        case "source": return t.source?.displayName ?? t.source?.name ?? "";
        case "amount": return Number(t.amount);
        case "contract": return t.contractNumber ?? "";
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
      // v1.6.4 (2026-05-16): 가상 status → API status 매핑
      // 특정 settlement 활성 시: 모든 status fetch (어떤 status여도 표시)
      // 미분류 활성 또는 미선택 시: status 탭 그대로
      const apiStatus = (settlementFilter && settlementFilter !== "__unclassified__") ? undefined
        : statusFilter === "SETTLED" ? "SETTLED"
        : statusFilter === "EXCLUDED" ? "EXCLUDED"
        : undefined;
      const [tx, srcs, ctrs, stls, allStls] = await Promise.all([
        expenseApi.listTransactions({ ...(apiStatus && { status: apiStatus }), limit: 200 }),
        expenseApi.listSources(),
        procurementApi.getContracts({ limit: 500 }).catch(() => ({ items: [] as any[] })),
        expenseApi.listSettlements({ status: "DRAFT", limit: 100 }).catch(() => ({ items: [] as any[] })),
        expenseApi.listSettlements({ limit: 500 }).catch(() => ({ items: [] as any[] })),
      ]);
      setSettlements((stls as any).items ?? []);
      setAllSettlements((allStls as any).items ?? []);
      // v1.6.3 (2026-05-16): CASH 자동 생성 로직 제거 — race condition으로 중복 누적되던 문제 해결.
      // CASH 소스가 필요하면 카드 관리에서 명시적으로 등록.
      const allSources = [...srcs].sort((a, b) => {
        if (a.type === "CASH" && b.type !== "CASH") return -1;
        if (a.type !== "CASH" && b.type === "CASH") return 1;
        const an = a.displayName ?? a.name ?? "";
        const bn = b.displayName ?? b.name ?? "";
        return an.localeCompare(bn);
      });
      setItems(tx.items);
      setTotal(tx.total);
      setSources(allSources);
      setContracts(((ctrs as any).items ?? []) as Contract[]);
    } finally {
      setLoading(false);
      onChange?.();
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [statusFilter, settlementFilter]);

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

  // v1.6.2: contractId/Number/Name 한 번에 세팅 (snapshot 보관). contract=null이면 "— 없음 —"으로 해제.
  const updateContract = async (id: string, contract: { id: string; contractNumber: string; name: string } | null) => {
    await expenseApi.updateTransaction(id, {
      contractId: contract?.id ?? null,
      contractNumber: contract?.contractNumber ?? null,
      contractName: contract?.name ?? null,
    });
    await load();
  };

  // SearchableSelect용 옵션 로더 — 2026-06-12: 서버 검색으로 전환.
  //   계약이 3천+ 건이라 클라이언트 500건 로컬 필터로는 최신 연도(#26-) 등이 누락됨.
  //   검색어 있으면 서버에서 전체 계약(번호·명·고객·제작사·담당) 검색.
  const mapContractOpt = (c: any) => ({
    id: c.id,
    name: `${c.contractNumber} - ${c.name}`,
    ...(c.client && { sub: c.client }),
  });
  const loadContractOptions = async (q: string) => {
    const ql = q.trim();
    if (!ql) {
      // 검색어 없을 때: "없음" + 로컬 로드분(기본 노출)
      return [{ id: "__none__", name: "— 없음 —" }, ...contracts.slice(0, 50).map(mapContractOpt)];
    }
    try {
      const res: any = await procurementApi.getContracts({ search: ql, limit: 50 });
      return ((res.items ?? []) as any[]).map(mapContractOpt);
    } catch {
      // 폴백: 로컬 필터
      const qll = ql.toLowerCase();
      return contracts
        .filter((c) =>
          (c.contractNumber ?? "").toLowerCase().includes(qll) ||
          (c.name ?? "").toLowerCase().includes(qll) ||
          (c.client ?? "").toLowerCase().includes(qll),
        )
        .slice(0, 50)
        .map(mapContractOpt);
    }
  };

  const updateMemo = async (id: string, memo: string) => {
    await expenseApi.updateTransaction(id, { memo });
    await load();
  };

  const updateDetail = async (id: string, detail: string) => {
    await expenseApi.updateTransaction(id, { detail });
    await load();
  };

  // 다중 영수증 업로드 → 큐로 모달 순차 오픈
  const handleReceiptMultiUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
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
    if (fail > 0) alert(`${fail}건 업로드 실패`);
    if (uploaded.length > 0) {
      const ids = uploaded.map((r) => r.id);
      setReceiptQueue(ids.slice(1));
      setReceiptModalId(ids[0]);
    }
    if (receiptMultiInputRef.current) receiptMultiInputRef.current.value = "";
  };

  // 영수증 모달 닫기 — 큐 다음 항목 자동 오픈
  const handleReceiptModalClose = () => {
    if (receiptQueue.length > 0) {
      const next = receiptQueue[0];
      setReceiptQueue(receiptQueue.slice(1));
      setReceiptModalId(next);
    } else {
      setReceiptModalId(null);
      load(); // 모달 닫힐 때 거래 목록 새로고침 (매칭/추가 반영)
    }
  };

  // 거래 행에서 "— (영수증 없음)" 클릭 → 단일 파일 업로드 + 자동 매칭
  const triggerSingleReceiptUpload = (txId: string) => {
    setSingleUploadTxId(txId);
    singleReceiptInputRef.current?.click();
  };

  const handleSingleReceiptUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const txId = singleUploadTxId;
    if (!file || !txId) {
      if (singleReceiptInputRef.current) singleReceiptInputRef.current.value = "";
      setSingleUploadTxId(null);
      return;
    }
    const tx = items.find((t: any) => t.id === txId);
    try {
      const r = await expenseApi.uploadReceipt(file);
      // 영수증의 추출 정보를 클릭한 거래 정보로 즉시 채움 (OCR 결과는 보존만 — 백엔드가 덮어쓰지 않음)
      if (tx) {
        try {
          await expenseApi.updateReceipt(r.id, {
            extractedMerchant: tx.merchantName ?? null,
            extractedAmount: tx.amount != null ? Number(tx.amount) : null,
            extractedDate: tx.transactedAt ?? null,
          });
        } catch (err: any) {
          console.error("영수증 정보 동기화 실패:", err.message);
        }
      }
      // 즉시 매칭
      try {
        const m = await expenseApi.createMatch(txId, r.id);
        if (m?.id) await expenseApi.confirmMatch(m.id);
      } catch (err: any) {
        console.error("자동 매칭 실패:", err.message);
      }
      setReceiptModalId(r.id);
      await load();
    } catch (err: any) {
      alert("영수증 업로드 실패: " + (err.message ?? err));
    } finally {
      if (singleReceiptInputRef.current) singleReceiptInputRef.current.value = "";
      setSingleUploadTxId(null);
    }
  };

  /**
   * 거래의 정산분류 변경.
   * - "__new__": 거래의 계약-detail로 새 정산 묶음 생성
   * - "__exclude__": 정산 제외 (status=EXCLUDED + settlement 해제)
   * - "__clear__" / "": 정산 해제 (status는 contractId 유무로 자동 결정)
   * v1.6.3 (2026-05-16): __exclude__ 추가 (이전 PERSONAL 카테고리 자동 EXCLUDED 대체)
   */
  const updateSettlement = async (tx: any, settlementId: string) => {
    try {
      if (settlementId === "__new__") {
        // v1.6.3 (2026-05-16): 자동 제목 생성 폐기. 사용자가 직접 입력.
        const input = window.prompt("새 정산 묶음 제목을 입력하세요:", "");
        if (!input || !input.trim()) {
          await load(); // dropdown 원복
          return;
        }
        const created = await expenseApi.createEmptySettlement({ title: input.trim() });
        await expenseApi.setTransactionSettlement(tx.id, created.id);
      } else if (settlementId === "__exclude__") {
        await expenseApi.setTransactionSettlement(tx.id, null);
        await expenseApi.updateTransaction(tx.id, { status: "EXCLUDED" });
      } else if (settlementId === "__clear__" || settlementId === "") {
        // 정산묶음 해제 → 백엔드가 상태를 미정산분류(PENDING)로 자동 설정 (EXCLUDED였어도 해제 시 미정산분류)
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
      // 단일 일괄삭제 요청 — 거래마다 동시 DELETE를 쏘던 방식(rate-limit 폭주) 대체
      const { deleted } = await expenseApi.bulkDeleteTransactions(sel.ids);
      if (deleted < sel.count) alert(`${sel.count}건 중 ${deleted}건 삭제됨`);
      sel.clear();
      await load();
    } catch (e: any) {
      alert(`삭제 실패: ${e?.message ?? e}`);
    } finally {
      setBulkDeleting(false);
    }
  };

  const applyBulk = async () => {
    if (sel.count === 0) return;
    if (!bulkContract && !bulkDetail && !bulkMemo && !bulkSettlementId) {
      alert("사업(계약)·구분·상세내역·정산분류 중 하나는 선택해야 합니다.");
      return;
    }
    const settlementLabel = bulkSettlementId === "__new__"
      ? `정산분류: + 새 정산 「${bulkNewSettlementTitle}」`
      : bulkSettlementId === "__exclude__"
        ? "정산분류: 제외 (정산 대상에서 제외)"
        : bulkSettlementId === "__clear__"
          ? "정산분류: 미설정"
          : bulkSettlementId
            ? `정산분류: ${settlements.find((s) => s.id === bulkSettlementId)?.title ?? bulkSettlementId}`
            : "";
    const lines = [
      bulkContract && `사업(계약): ${bulkContract.number} - ${bulkContract.name}`,
      bulkDetail && `구분: ${bulkDetail}`,
      bulkMemo && `상세내역: ${bulkMemo}`,
      settlementLabel,
    ].filter(Boolean).join("\n");
    if (!confirm(`${sel.count}건의 거래에 적용하시겠습니까?\n${lines}`)) return;

    setBulkApplying(true);
    try {
      const updateData: any = {};
      if (bulkContract) {
        updateData.contractId = bulkContract.id;
        updateData.contractNumber = bulkContract.number;
        updateData.contractName = bulkContract.name;
      }
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
        // __exclude__: settlement 해제 + status=EXCLUDED
        if (bulkSettlementId === "__exclude__") {
          const results = await Promise.allSettled(
            sel.ids.map(async (id) => {
              await expenseApi.setTransactionSettlement(id, null);
              await expenseApi.updateTransaction(id, { status: "EXCLUDED" });
            }),
          );
          const failed = results.filter((r) => r.status === "rejected").length;
          if (failed > 0) alert(`제외 처리 ${failed}건 실패`);
          sel.clear();
          setBulkContract(null);
          setBulkDetail("");
          setBulkMemo("");
          setBulkSettlementId("");
          setBulkNewSettlementTitle("");
          await load();
          return;
        }
        let targetSettlementId: string | null;
        if (bulkSettlementId === "__new__") {
          // v1.6.3 (2026-05-16): 자동 제목 생성 폐기. dropdown 선택 시점에 prompt로 받은 제목 사용.
          if (!bulkNewSettlementTitle.trim()) {
            alert("새 정산 묶음 제목이 비어있습니다. 정산분류 dropdown에서 다시 선택해주세요.");
            setBulkApplying(false);
            return;
          }
          const created = await expenseApi.createEmptySettlement({ title: bulkNewSettlementTitle.trim() });
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
      setBulkContract(null);
      setBulkDetail("");
      setBulkMemo("");
      setBulkSettlementId("");
      setBulkNewSettlementTitle("");
      await load();
    } finally {
      setBulkApplying(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-6 space-y-4">
      {/* v1.6.1 (2026-05-15): 구분 dropdown 옵션 (자유 입력 + 추천) */}
      <datalist id="detail-options">
        {DETAIL_OPTIONS.map((o) => <option key={o} value={o} />)}
      </datalist>
      {importMsg && (
        <div className={`p-3 rounded-md text-sm ${importMsg.startsWith("✅") ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
          {importMsg}
        </div>
      )}

      {/* 상태 필터 + 액션 버튼 — v1.6.4 (2026-05-16): 4탭 단순화 */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-gray-500">상태:</span>
        {[
          { v: "TARGET", l: "정산대상" },
          { v: "UNCLASSIFIED", l: "미분류" },
          { v: "SETTLED", l: "정산완료" },
          { v: "EXCLUDED", l: "제외" },
          { v: "", l: "전체" },
        ].map((s) => (
          <button key={s.v} onClick={() => setStatusFilter(s.v)}
            className={`px-2.5 py-1 text-xs rounded-md ${statusFilter === s.v ? "bg-blue-600 text-white" : "border border-gray-300 text-gray-600 hover:bg-gray-50"}`}>
            {s.l}
          </button>
        ))}
        <span className="text-xs text-gray-500">
          {statusFilter === "" ? `총 ${total}건` : `${filteredItems.length}건`}
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
          <input ref={receiptMultiInputRef} type="file" multiple accept="image/*,.pdf"
            onChange={handleReceiptMultiUpload} className="hidden" id="tx-receipt-multi" />
          <label htmlFor="tx-receipt-multi"
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 cursor-pointer">
            + 영수증 업로드
          </label>
          {/* 거래 행에서 트리거하는 단일 영수증 업로드용 hidden input */}
          <input ref={singleReceiptInputRef} type="file" accept="image/*,.pdf"
            onChange={handleSingleReceiptUpload} className="hidden" />
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
        <select value={bulkSettlementId} onChange={(e) => {
            const v = e.target.value;
            if (v === "__new__") {
              const input = window.prompt("새 정산 묶음 제목을 입력하세요:", "");
              if (!input || !input.trim()) {
                // 취소 — dropdown 원복
                setBulkSettlementId("");
                setBulkNewSettlementTitle("");
                return;
              }
              setBulkSettlementId("__new__");
              setBulkNewSettlementTitle(input.trim());
            } else {
              setBulkSettlementId(v);
              setBulkNewSettlementTitle("");
            }
          }}
          disabled={sel.count === 0}
          className="text-sm border border-gray-300 rounded px-2 py-1 disabled:bg-gray-100 disabled:text-gray-400">
          <option value="">정산분류 (변경 안 함)</option>
          <option value="__clear__">— 미설정 —</option>
          <option value="__exclude__">— 제외 —</option>
          <option value="__new__">{bulkNewSettlementTitle ? `+ 새 정산: ${bulkNewSettlementTitle}` : "+ 새 정산 (제목 입력)"}</option>
          {settlements.length > 0 && <option disabled>──────────</option>}
          {settlements.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select>
        <div className="min-w-[200px]">
          <ContractCellSelect
            value={bulkContract}
            onChange={setBulkContract}
            loadOptions={loadContractOptions}
            disabled={sel.count === 0}
            placeholder="사업(계약) (변경 안 함)"
            allowClear
          />
        </div>
        <input type="text" list="detail-options" value={bulkDetail} onChange={(e) => setBulkDetail(e.target.value)}
          disabled={sel.count === 0}
          placeholder="구분 (변경 안 함)"
          className="text-sm border border-gray-300 rounded px-2 py-1 flex-1 min-w-[160px] disabled:bg-gray-100" />
        <input type="text" value={bulkMemo} onChange={(e) => setBulkMemo(e.target.value)}
          disabled={sel.count === 0}
          placeholder={bulkDetail.trim() ? getDetailPlaceholder(bulkDetail) : "상세내역 (변경 안 함)"}
          title={bulkDetail.trim() ? getDetailPlaceholder(bulkDetail) : ""}
          className="text-sm border border-gray-300 rounded px-2 py-1 flex-1 min-w-[160px] disabled:bg-gray-100" />
        <button onClick={applyBulk}
          disabled={bulkApplying || sel.count === 0 || (!bulkContract && !bulkDetail && !bulkMemo && !bulkSettlementId)}
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
        {/* 정산 진행 단계 범례 — 정산됨/입금완료 view 한정 */}
        {(statusFilter === "SETTLED") && (
          <div className="ml-auto flex items-center gap-1.5 text-[11px] text-gray-500">
            <span className="mr-1">진행 단계:</span>
            <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-700">결재중</span>
            <span className="text-gray-300">→</span>
            <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-700">결재완료</span>
            <span className="text-gray-300">→</span>
            <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-700">정산완료</span>
            <span className="ml-3 text-gray-400">|</span>
            <span className="ml-1">💡 Shift+클릭으로 범위 선택</span>
          </div>
        )}
        {statusFilter !== "SETTLED" && (
          <span className="ml-auto text-[11px] text-gray-500">💡 Shift+클릭으로 범위 선택</span>
        )}
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
              <th className="px-3 py-2 text-left">
                <SettlementHeaderFilter
                  settlements={allSettlements}
                  value={settlementFilter}
                  onChange={(id) => {
                    setSettlementFilter(id);
                    // 특정 settlement 선택 시만 status 탭 무력화 (미분류는 status 탭과 조합 가능)
                    if (id && id !== "__unclassified__") setStatusFilter("");
                  }}
                  open={settlementFilterOpen}
                  setOpen={setSettlementFilterOpen}
                />
              </th>
              <th onClick={() => sort.handleSort("contract")} className="px-3 py-2 text-left cursor-pointer hover:bg-gray-100 select-none">사업(계약){sort.sortIndicator("contract")}</th>
              <th onClick={() => sort.handleSort("detail")} className="px-3 py-2 text-left cursor-pointer hover:bg-gray-100 select-none">구분{sort.sortIndicator("detail")}</th>
              <th onClick={() => sort.handleSort("memo")} className="px-3 py-2 text-left cursor-pointer hover:bg-gray-100 select-none">상세내역{sort.sortIndicator("memo")}</th>
              <th onClick={() => sort.handleSort("receipt")} className="px-3 py-2 text-center cursor-pointer hover:bg-gray-100 select-none whitespace-nowrap">영수증{sort.sortIndicator("receipt")}</th>
              <th onClick={() => sort.handleSort("status")} className="px-3 py-2 text-center cursor-pointer hover:bg-gray-100 select-none">상태{sort.sortIndicator("status")}</th>
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
                    {(() => {
                      const currentItem = (t.settlementItems ?? [])[0];
                      const currentSettlementId = currentItem?.settlementId ?? "";
                      const currentStatus = currentItem?.settlement?.status;
                      const locked = currentStatus && currentStatus !== "DRAFT";
                      // v1.6.3: EXCLUDED 거래는 dropdown value를 __exclude__로 표시
                      const dropdownValue = t.status === "EXCLUDED" ? "__exclude__" : currentSettlementId;
                      return (
                        <select
                          value={dropdownValue}
                          onChange={(e) => updateSettlement(t, e.target.value)}
                          disabled={!!locked}
                          className={`text-xs border border-gray-300 rounded px-1.5 py-0.5 max-w-[160px] disabled:bg-gray-100 disabled:text-gray-500 ${t.status === "EXCLUDED" ? "text-gray-500" : ""}`}
                          title={locked ? `${currentStatus} 상태로 변경 불가` : ""}
                        >
                          <option value="">— 미설정 —</option>
                          <option value="__exclude__">— 제외 —</option>
                          <option value="__new__">+ 새 정산 (제목 입력)</option>
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
                  <td className="px-3 py-2">
                    <div className="min-w-[200px] max-w-[260px]">
                      <ContractCellSelect
                        value={t.contractId ? { id: t.contractId, number: t.contractNumber ?? "", name: t.contractName ?? "" } : null}
                        onChange={(c) => updateContract(t.id, c ? { id: c.id, contractNumber: c.number, name: c.name } : null)}
                        loadOptions={loadContractOptions}
                        placeholder="— 없음 —"
                        allowClear
                      />
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <input type="text" list="detail-options" defaultValue={t.detail ?? ""}
                      onBlur={(e) => e.target.value !== (t.detail ?? "") && updateDetail(t.id, e.target.value)}
                      className="text-xs border border-gray-200 rounded px-2 py-0.5 w-full max-w-[200px]"
                      placeholder="구분 선택..." />
                  </td>
                  <td className="px-3 py-2">
                    <input type="text" defaultValue={t.memo ?? ""}
                      onBlur={(e) => e.target.value !== (t.memo ?? "") && updateMemo(t.id, e.target.value)}
                      className="text-xs border border-gray-200 rounded px-2 py-0.5 w-full max-w-[260px]"
                      placeholder={getDetailPlaceholder(t.detail)}
                      title={getDetailPlaceholder(t.detail)} />
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
                      return (
                        <button onClick={(e) => { e.stopPropagation(); triggerSingleReceiptUpload(t.id); }}
                          title="영수증 업로드 + 자동 매칭"
                          className="text-xs text-gray-300 hover:text-blue-600 cursor-pointer">
                          +
                        </button>
                      );
                    })()}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {(() => {
                      // 정산됨/입금완료 필터일 때는 정산 진행 단계 표시 (3-stage: 결재중/결재완료/정산완료)
                      // RECEIVED는 legacy(현재 워크플로우에선 미사용) — 결재완료로 표시
                      if (statusFilter === "SETTLED") {
                        const s = (t.settlementItems ?? [])[0]?.settlement;
                        if (s) {
                          const stage = s.status === "SUBMITTED" ? { label: "결재중", color: "bg-blue-100 text-blue-700" }
                            : ["APPROVED", "RECEIVED"].includes(s.status) ? { label: "결재완료", color: "bg-indigo-100 text-indigo-700" }
                            : s.status === "PAID" ? { label: "정산완료", color: "bg-emerald-100 text-emerald-700" }
                            : s.status === "REJECTED" ? { label: "반려", color: "bg-red-100 text-red-700" }
                            : { label: s.status, color: "bg-gray-100 text-gray-700" };
                          return (
                            <span className={`px-2 py-0.5 text-xs rounded whitespace-nowrap ${stage.color}`}>
                              {stage.label}
                            </span>
                          );
                        }
                      }
                      return (
                        <span className={`px-2 py-0.5 text-xs rounded whitespace-nowrap ${STATUS_COLORS[t.status]}`}>
                          {STATUS_LABELS[t.status]}
                        </span>
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
          loadContractOptions={loadContractOptions}
          onClose={() => setShowManual(false)}
          onSaved={() => { setShowManual(false); load(); }}
        />
      )}

      {receiptModalId && (
        <ReceiptDetailModal
          receiptId={receiptModalId}
          onClose={handleReceiptModalClose}
          onChange={load}
          onSplit={(createdIds) => {
            // 분할된 영수증들을 큐 맨 앞에 삽입 (현재 모달 자동으로 다음으로 전환)
            setReceiptQueue([...createdIds.slice(1), ...receiptQueue]);
            setReceiptModalId(createdIds[0]);
          }}
        />
      )}
    </div>
  );
}

// 거래 셀·일괄 적용 바·수동 입력 모달에서 공통으로 쓰는 계약 SearchableSelect wrapper.
// value: { id, number, name } | null. "— 없음 —" 클리어 버튼 제공.
function ContractCellSelect({
  value, onChange, loadOptions, disabled, placeholder, allowClear,
}: {
  value: { id: string; number: string; name: string } | null;
  onChange: (v: { id: string; number: string; name: string } | null) => void;
  loadOptions: (q: string) => Promise<{ id: string; name: string; sub?: string }[]>;
  disabled?: boolean;
  placeholder?: string;
  allowClear?: boolean;
}) {
  const displayValue = value ? `${value.number} - ${value.name}` : "";
  return (
    <div className="flex items-center gap-1">
      <div className={`flex-1 ${disabled ? "opacity-50 pointer-events-none" : ""}`}>
        <SearchableSelect
          value={displayValue}
          onChange={() => { /* 직접 입력 무시 — onSelect만 사용 */ }}
          onSelect={(opt) => {
            // v1.6.4 (2026-05-16): __none__ sentinel = 미설정 처리
            if (!opt || opt.id === "__none__") { onChange(null); return; }
            // opt.name 형식: "{number} - {name}". 첫 ' - '만 split.
            const dashIdx = opt.name.indexOf(" - ");
            const number = dashIdx > 0 ? opt.name.slice(0, dashIdx) : opt.name;
            const name = dashIdx > 0 ? opt.name.slice(dashIdx + 3) : "";
            onChange({ id: opt.id, number, name });
          }}
          loadOptions={loadOptions}
          {...(placeholder !== undefined && { placeholder })}
          className="w-full text-xs border border-gray-200 rounded px-2 py-1"
        />
      </div>
      {allowClear && value && !disabled && (
        <button
          type="button"
          onClick={() => onChange(null)}
          title="없음으로 변경"
          className="text-xs text-gray-400 hover:text-red-600 px-1"
        >
          ✕
        </button>
      )}
    </div>
  );
}

function ManualTransactionModal({ sources, loadContractOptions, onClose, onSaved }: {
  sources: any[]; loadContractOptions: (q: string) => Promise<{ id: string; name: string; sub?: string }[]>; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    sourceId: sources[0]?.id ?? "", // 정렬돼서 CASH가 첫 번째로 들어와 있음
    transactedAt: new Date().toISOString().slice(0, 16),
    merchantName: "",
    amount: 0,
    contract: null as { id: string; number: string; name: string } | null,
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
        ...(form.contract && {
          contractId: form.contract.id,
          contractNumber: form.contract.number,
          contractName: form.contract.name,
        }),
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
          <Field label="사업(계약)">
            <ContractCellSelect
              value={form.contract}
              onChange={(c) => setForm({ ...form, contract: c })}
              loadOptions={loadContractOptions}
              placeholder="— 없음 — (나중에 분류 가능)"
              allowClear
            />
          </Field>
          <Field label="구분">
            <input type="text" list="detail-options" value={form.detail}
              onChange={(e) => setForm({ ...form, detail: e.target.value })}
              placeholder="구분 선택 (교통비/식비/음료/접대 등)"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
          </Field>
          <Field label="상세내역">
            <input type="text" value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })}
              placeholder={form.detail.trim() ? getDetailPlaceholder(form.detail) : "예: 점심 식사 4명, 노트북 어댑터 등"}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
            {form.detail.trim() && DETAIL_PLACEHOLDER[form.detail.trim()] && (
              <p className="text-[10px] text-gray-500 mt-1">💡 {DETAIL_PLACEHOLDER[form.detail.trim()]}</p>
            )}
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

// v1.6.4 (2026-05-16): 정산분류 헤더 클릭 popover 필터
// 정산 제목 리스트 + 검색. 선택 시 해당 settlement에 속한 거래만 표시.
const SETTLEMENT_STATUS_LABEL: Record<string, { l: string; c: string }> = {
  DRAFT:     { l: "작성중",  c: "bg-gray-100 text-gray-600" },
  SUBMITTED: { l: "결재중",  c: "bg-blue-100 text-blue-700" },
  APPROVED:  { l: "결재완료", c: "bg-indigo-100 text-indigo-700" },
  RECEIVED:  { l: "접수",    c: "bg-indigo-100 text-indigo-700" },
  PAID:      { l: "입금완료", c: "bg-emerald-100 text-emerald-700" },
  REJECTED:  { l: "반려",    c: "bg-red-100 text-red-700" },
};

function SettlementHeaderFilter({
  settlements, value, onChange, open, setOpen,
}: {
  settlements: any[];
  value: string | null;
  onChange: (id: string | null) => void;
  open: boolean;
  setOpen: (v: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const isUnclassified = value === "__unclassified__";
  const selected = (value && !isUnclassified) ? settlements.find((s) => s.id === value) : null;

  useEffect(() => {
    if (!open) return;
    if (triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left });
    }
    const onClick = (e: MouseEvent) => {
      if (popoverRef.current?.contains(e.target as Node)) return;
      if (triggerRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open, setOpen]);

  const ql = query.trim().toLowerCase();
  const filtered = ql
    ? settlements.filter((s) => (s.title ?? "").toLowerCase().includes(ql))
    : settlements;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-1 px-1 py-0.5 text-xs hover:bg-gray-100 rounded ${value ? "text-blue-700 font-medium" : "text-gray-500"}`}
      >
        <span>정산분류</span>
        {selected ? (
          <span className="ml-1 px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] max-w-[160px] truncate" title={selected.title}>
            {selected.title}
          </span>
        ) : isUnclassified ? (
          <span className="ml-1 px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-[10px]">미분류</span>
        ) : null}
        <span className="text-[10px]">▾</span>
        {value && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onChange(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onChange(null); } }}
            className="ml-0.5 text-gray-400 hover:text-red-600 cursor-pointer"
            title="필터 해제"
          >
            ✕
          </span>
        )}
      </button>
      {open && pos && typeof window !== "undefined" && createPortal(
        <div
          ref={popoverRef}
          className="bg-white border border-gray-300 rounded-lg shadow-lg p-2 w-[320px] max-h-[420px] overflow-y-auto"
          style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 9999 }}
        >
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="정산 제목 검색..."
            autoFocus
            className="w-full text-sm border border-gray-300 rounded px-2 py-1 mb-2"
          />
          <button
            type="button"
            onClick={() => { onChange(null); setOpen(false); }}
            className={`w-full text-left px-2 py-1.5 text-xs rounded ${!value ? "bg-blue-50 text-blue-700" : "text-gray-500 hover:bg-gray-50"}`}
          >
            모두 보기
          </button>
          <button
            type="button"
            onClick={() => { onChange("__unclassified__"); setOpen(false); }}
            className={`w-full text-left px-2 py-1.5 text-xs rounded ${value === "__unclassified__" ? "bg-blue-50 text-blue-700" : "text-gray-700 hover:bg-gray-50"}`}
          >
            미분류 <span className="text-[10px] text-gray-400 ml-1">(정산 묶음 없음)</span>
          </button>
          <div className="border-t border-gray-100 my-1"></div>
          {filtered.length === 0 ? (
            <div className="px-2 py-3 text-xs text-gray-400 text-center">정산이 없습니다.</div>
          ) : filtered.map((s) => {
            const meta = SETTLEMENT_STATUS_LABEL[s.status] ?? { l: s.status, c: "bg-gray-100 text-gray-600" };
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => { onChange(s.id); setOpen(false); }}
                className={`w-full text-left px-2 py-1.5 text-xs rounded flex items-center gap-2 ${value === s.id ? "bg-blue-50 text-blue-700" : "hover:bg-gray-50"}`}
                title={s.title}
              >
                <span className="flex-1 truncate">{s.title}</span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] whitespace-nowrap ${meta.c}`}>{meta.l}</span>
                <span className="text-[10px] text-gray-400 tabular-nums whitespace-nowrap">{s.totalCount ?? 0}건</span>
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}
