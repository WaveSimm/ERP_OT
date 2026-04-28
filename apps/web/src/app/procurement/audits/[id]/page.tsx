"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { auditApi } from "@/lib/api";
import Pagination from "@/components/Pagination";

const ITEM_STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-gray-100 text-gray-600",
  MATCHED: "bg-green-100 text-green-700",
  MISMATCHED: "bg-red-100 text-red-700",
  MISSING: "bg-orange-100 text-orange-700",
};
const ITEM_STATUS_LABELS: Record<string, string> = { PENDING: "미확인", MATCHED: "일치", MISMATCHED: "불일치", MISSING: "누락" };
const AUDIT_STATUS_LABELS: Record<string, string> = { PLANNED: "예정", IN_PROGRESS: "진행중", PAUSED: "일시정지", CANCELLED: "취소", COMPLETED: "완료" };
const AUDIT_STATUS_COLORS: Record<string, string> = { PLANNED: "text-gray-600", IN_PROGRESS: "text-yellow-600", PAUSED: "text-blue-600", CANCELLED: "text-red-600", COMPLETED: "text-green-600" };

type SortKey = "inventoryNo" | "location";

export default function AuditDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const [audit, setAudit] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("inventoryNo");
  const [groupByLocation, setGroupByLocation] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQty, setEditQty] = useState("");
  const [acting, setActing] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 100;

  const load = useCallback(async () => {
    try { setAudit(await auditApi.getById(id)); }
    catch { }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const handleAction = async (action: () => Promise<any>) => {
    try { await action(); load(); }
    catch (e: any) { alert(e.message); }
  };

  const quickAction = async (itemId: string, action: "MATCHED" | "MISSING" | "PENDING", systemQty?: number) => {
    setActing(itemId);
    try {
      if (action === "PENDING") {
        await auditApi.resetItem(itemId);
      } else {
        await auditApi.checkItem(itemId, {
          actualQuantity: action === "MATCHED" ? (systemQty ?? 1) : 0,
        });
      }
      load();
    } catch (e: any) { alert(e.message); }
    finally { setActing(null); }
  };

  const submitMismatch = async (itemId: string) => {
    if (editQty === "") return;
    setActing(itemId);
    try {
      await auditApi.checkItem(itemId, { actualQuantity: Number(editQty) });
      setEditingId(null);
      setEditQty("");
      load();
    } catch (e: any) { alert(e.message); }
    finally { setActing(null); }
  };

  const allItems: any[] = audit?.items || [];

  // 필터 + 검색
  const filtered = useMemo(() => {
    return allItems.filter((i: any) => {
      if (filter && i.status !== filter) return false;
      if (search) {
        const q = search.toLowerCase();
        const invNo = (i.inventoryItem?.inventoryNo || "").toLowerCase();
        const name = (i.inventoryItem?.productMaster?.name || "").toLowerCase();
        const loc = (i.systemLocation || "").toLowerCase();
        if (!invNo.includes(q) && !name.includes(q) && !loc.includes(q)) return false;
      }
      return true;
    });
  }, [allItems, filter, search]);

  // 정렬
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (sortBy === "location") {
        const la = (a.systemLocation || "").localeCompare(b.systemLocation || "");
        if (la !== 0) return la;
      }
      return (a.inventoryItem?.inventoryNo || "").localeCompare(b.inventoryItem?.inventoryNo || "");
    });
  }, [filtered, sortBy]);

  // 페이지네이션
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const paged = useMemo(() => {
    if (groupByLocation) return sorted; // 그룹핑 시 전체 (그룹 내에서 페이징하면 복잡)
    const start = (page - 1) * PAGE_SIZE;
    return sorted.slice(start, start + PAGE_SIZE);
  }, [sorted, page, groupByLocation]);

  // 필터/검색 변경 시 페이지 리셋
  const setFilterAndReset = (f: string) => { setFilter(f); setPage(1); };
  const setSearchAndReset = (s: string) => { setSearch(s); setPage(1); };

  // 창고별 그룹핑
  const grouped = useMemo(() => {
    if (!groupByLocation) return null;
    const map: Record<string, any[]> = {};
    sorted.forEach((item) => {
      const loc = item.systemLocation || "위치미상";
      if (!map[loc]) map[loc] = [];
      map[loc].push(item);
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [sorted, groupByLocation]);

  const stats = useMemo(() => ({
    total: allItems.length,
    checked: allItems.filter((i: any) => i.status !== "PENDING").length,
    matched: allItems.filter((i: any) => i.status === "MATCHED").length,
    mismatched: allItems.filter((i: any) => i.status === "MISMATCHED").length,
    missing: allItems.filter((i: any) => i.status === "MISSING").length,
  }), [allItems]);

  if (loading) return <div className="text-center py-12 text-gray-400">로딩 중...</div>;
  if (!audit) return <div className="text-center py-12 text-red-500">실사를 찾을 수 없습니다.</div>;

  const isEditable = audit.status === "IN_PROGRESS" || audit.status === "PAUSED";

  const renderItem = (item: any) => {
    const disabled = acting === item.id;
    const isEditing = editingId === item.id;

    return (
      <div key={item.id} className={`bg-white border rounded-lg p-3 flex items-center gap-3 ${disabled ? "opacity-50" : ""}`}>
        {/* 상태 뱃지 */}
        <span className={`text-xs px-2 py-1 rounded whitespace-nowrap w-14 text-center ${ITEM_STATUS_COLORS[item.status]}`}>
          {ITEM_STATUS_LABELS[item.status]}
        </span>

        {/* 재고 정보 — 클릭 시 재고 상세 */}
        <div className="flex-1 min-w-0 cursor-pointer group" onClick={() => {
          if (item.inventoryItem?.id) router.push(`/procurement/inventory/${item.inventoryItem.id}`);
        }}>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium font-mono text-blue-600 group-hover:underline">{item.inventoryItem?.inventoryNo}</span>
            <span className="text-xs text-gray-400 truncate">{item.systemLocation || "위치미상"}</span>
          </div>
          <div className="text-xs text-gray-500 truncate group-hover:text-blue-500">{item.inventoryItem?.productMaster?.name || "-"}</div>
          <div className="text-xs text-gray-400">
            수량: {item.systemQuantity}개
            {item.actualQuantity !== null && item.status !== "MATCHED" && (
              <span className="text-red-600"> → 실제: {item.actualQuantity}개</span>
            )}
          </div>
        </div>

        {/* 액션 버튼 (진행중/일시정지일 때만) */}
        {isEditable && (
          <div className="flex items-center gap-1 shrink-0">
            {/* 불일치 수량 입력 */}
            {isEditing ? (
              <div className="flex items-center gap-1">
                <input type="number" value={editQty} onChange={(e) => setEditQty(e.target.value)}
                  className="w-16 border rounded px-2 py-1 text-xs" placeholder="수량"
                  autoFocus onKeyDown={(e) => { if (e.key === "Enter") submitMismatch(item.id); if (e.key === "Escape") { setEditingId(null); setEditQty(""); } }} />
                <button onClick={() => submitMismatch(item.id)} disabled={disabled || editQty === ""}
                  className="px-2 py-1 text-xs bg-red-600 text-white rounded disabled:opacity-30">확인</button>
                <button onClick={() => { setEditingId(null); setEditQty(""); }}
                  className="px-1.5 py-1 text-xs text-gray-400 hover:text-gray-600">&times;</button>
              </div>
            ) : (
              <>
                <button onClick={() => quickAction(item.id, "PENDING")} disabled={disabled}
                  className={`px-2 py-1 text-xs rounded border ${item.status === "PENDING" ? "bg-gray-200 text-gray-700 font-medium" : "text-gray-400 hover:bg-gray-100"}`}>
                  미확인</button>
                <button onClick={() => quickAction(item.id, "MISSING", 0)} disabled={disabled}
                  className={`px-2 py-1 text-xs rounded border ${item.status === "MISSING" ? "bg-orange-200 text-orange-800 font-medium" : "text-orange-500 hover:bg-orange-50"}`}>
                  누락</button>
                <button onClick={() => { setEditingId(item.id); setEditQty(""); }} disabled={disabled}
                  className={`px-2 py-1 text-xs rounded border ${item.status === "MISMATCHED" ? "bg-red-200 text-red-800 font-medium" : "text-red-500 hover:bg-red-50"}`}>
                  불일치</button>
                <button onClick={() => quickAction(item.id, "MATCHED", item.systemQuantity)} disabled={disabled}
                  className={`px-2 py-1 text-xs rounded border ${item.status === "MATCHED" ? "bg-green-200 text-green-800 font-medium" : "text-green-600 hover:bg-green-50"}`}>
                  일치</button>
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold">{audit.name}</h2>
          <div className="text-sm text-gray-500">
            <span className={`font-medium ${AUDIT_STATUS_COLORS[audit.status]}`}>{AUDIT_STATUS_LABELS[audit.status]}</span> · 예정: {new Date(audit.plannedDate).toLocaleDateString("ko-KR")}
          </div>
        </div>
        <div className="flex gap-2">
          {audit.status === "PLANNED" && (<>
            <button onClick={() => handleAction(() => auditApi.cancel(id))} className="px-4 py-2 border border-red-300 text-red-600 rounded-lg text-sm hover:bg-red-50">취소</button>
            <button onClick={() => handleAction(() => auditApi.start(id))} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">실사 시작</button>
          </>)}
          {audit.status === "IN_PROGRESS" && (<>
            <button onClick={() => handleAction(() => auditApi.pause(id))} className="px-4 py-2 border border-blue-300 text-blue-600 rounded-lg text-sm hover:bg-blue-50">일시정지</button>
            <button onClick={() => handleAction(() => auditApi.cancel(id))} className="px-4 py-2 border border-red-300 text-red-600 rounded-lg text-sm hover:bg-red-50">취소</button>
            <button onClick={() => handleAction(() => auditApi.complete(id))} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm">완료</button>
          </>)}
          {audit.status === "PAUSED" && (<>
            <button onClick={() => handleAction(() => auditApi.resume(id))} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">재개</button>
            <button onClick={() => handleAction(() => auditApi.cancel(id))} className="px-4 py-2 border border-red-300 text-red-600 rounded-lg text-sm hover:bg-red-50">취소</button>
          </>)}
        </div>
      </div>

      {/* 진행 통계 */}
      <div className="grid grid-cols-5 gap-3 mb-6">
        <div className="bg-white border rounded-lg p-3 text-center">
          <div className="text-xs text-gray-500">전체</div><div className="text-lg font-bold">{stats.total}</div>
        </div>
        <div className="bg-white border rounded-lg p-3 text-center">
          <div className="text-xs text-gray-500">확인</div><div className="text-lg font-bold text-blue-600">{stats.checked}</div>
        </div>
        <div className="bg-white border rounded-lg p-3 text-center">
          <div className="text-xs text-gray-500">일치</div><div className="text-lg font-bold text-green-600">{stats.matched}</div>
        </div>
        <div className="bg-white border rounded-lg p-3 text-center">
          <div className="text-xs text-gray-500">불일치</div><div className="text-lg font-bold text-red-600">{stats.mismatched}</div>
        </div>
        <div className="bg-white border rounded-lg p-3 text-center">
          <div className="text-xs text-gray-500">누락</div><div className="text-lg font-bold text-orange-600">{stats.missing}</div>
        </div>
      </div>

      {/* 검색 + 정렬 + 필터 */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <input type="text" placeholder="재고번호, 품명, 창고 검색..." value={search}
          onChange={(e) => setSearchAndReset(e.target.value)}
          className="border rounded-lg px-3 py-1.5 text-sm w-56" />
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortKey)}
          className="border rounded-lg px-3 py-1.5 text-sm">
          <option value="inventoryNo">재고번호순</option>
          <option value="location">창고순</option>
        </select>
        <button onClick={() => setGroupByLocation((v) => !v)}
          className={`px-3 py-1.5 rounded-lg text-sm border ${groupByLocation ? "bg-blue-600 text-white border-blue-600" : "hover:bg-gray-50"}`}>
          창고별 그룹
        </button>
        <span className="text-xs text-gray-400 ml-1">{filtered.length}/{allItems.length}건</span>
      </div>
      <div className="flex gap-2 mb-4">
        {["", "PENDING", "MATCHED", "MISMATCHED", "MISSING"].map((f) => (
          <button key={f} onClick={() => setFilterAndReset(f)}
            className={`px-3 py-1 rounded-full text-xs ${filter === f ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600"}`}>
            {f ? ITEM_STATUS_LABELS[f] : "전체"}
          </button>
        ))}
      </div>

      {/* 항목 목록 */}
      {grouped ? (
        <div className="space-y-4">
          {grouped.map(([loc, locItems]) => (
            <div key={loc}>
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-sm font-semibold text-gray-700">{loc}</h3>
                <span className="text-xs text-gray-400">{locItems.length}건</span>
                <span className="text-xs text-green-600">{locItems.filter((i: any) => i.status !== "PENDING").length}건 확인</span>
              </div>
              <div className="space-y-2">{locItems.map(renderItem)}</div>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="space-y-2">{paged.map(renderItem)}</div>
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} total={sorted.length} className="mt-6 mb-4 border rounded-lg" />
        </>
      )}

    </div>
  );
}
