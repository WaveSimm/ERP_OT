"use client";

// 자원-모델-분리 PDCA Phase 3b-4b (2026-05-04)
// 외부 자원(외주/협력업체) 목록·등록·archive 탭

import { useEffect, useState } from "react";
import { externalPersonApi, type ExternalPerson } from "@/lib/api";
import { ExternalPersonForm } from "@/components/ExternalPersonForm";
import { fmtDate } from "@/lib/datetime";

export function ExternalPersonsPanel({ isAdmin }: { isAdmin: boolean }) {
  const [items, setItems] = useState<ExternalPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"ACTIVE" | "ARCHIVED" | "ALL">("ACTIVE");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<ExternalPerson | null>(null);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (statusFilter !== "ALL") params.status = statusFilter;
      if (search) params.search = search;
      const data = await externalPersonApi.list(params);
      setItems(data);
    } catch (err: any) {
      alert("외부 자원 목록 실패: " + (err.message ?? "오류"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [statusFilter]);

  const handleArchive = async (p: ExternalPerson) => {
    if (!confirm(`${p.name}님의 계약을 종료 처리하시겠습니까?`)) return;
    try {
      await externalPersonApi.archive(p.id);
      load();
    } catch (err: any) {
      alert("종료 실패: " + (err.message ?? "오류"));
    }
  };

  const handleReactivate = async (p: ExternalPerson) => {
    if (!confirm(`${p.name}님을 다시 활성화하시겠습니까?`)) return;
    try {
      await externalPersonApi.reactivate(p.id);
      load();
    } catch (err: any) {
      alert("재활성 실패: " + (err.message ?? "오류"));
    }
  };

  const handleDelete = async (p: ExternalPerson) => {
    if (!confirm(`${p.name}을(를) 삭제하시겠습니까?\n(배정 이력이 있으면 삭제 불가, 종료 처리 권장)`)) return;
    try {
      await externalPersonApi.delete(p.id);
      load();
    } catch (err: any) {
      alert("삭제 실패: " + (err.message ?? "오류"));
    }
  };

  return (
    <div>
      {/* 툴바 */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-sm text-gray-500">전체 {items.length}건</span>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as any)}
          className="border border-gray-300 rounded px-2 py-1 text-sm"
        >
          <option value="ACTIVE">활성</option>
          <option value="ARCHIVED">종료</option>
          <option value="ALL">전체</option>
        </select>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
          placeholder="이름·업체 검색"
          className="border border-gray-300 rounded px-2 py-1 text-sm"
        />
        <button onClick={load} className="text-sm border rounded px-3 py-1 hover:bg-gray-50">검색</button>
        <div className="flex-1" />
        {isAdmin && (
          <button
            onClick={() => setCreating(true)}
            className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            + 외부 자원 등록
          </button>
        )}
      </div>

      {/* 목록 */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <span className="text-4xl mb-3">🤝</span>
          <p className="text-sm">등록된 외부 자원이 없습니다.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="text-left px-4 py-2 font-medium">이름</th>
                <th className="text-left px-4 py-2 font-medium">업체</th>
                <th className="text-left px-4 py-2 font-medium">연락처</th>
                <th className="text-left px-4 py-2 font-medium">계약기간</th>
                <th className="text-left px-4 py-2 font-medium">상태</th>
                {isAdmin && <th className="text-right px-4 py-2 font-medium">관리</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-2 font-medium">{p.name}</td>
                  <td className="px-4 py-2 text-gray-600">{p.company ?? "-"}</td>
                  <td className="px-4 py-2 text-xs text-gray-500">
                    {p.contactEmail && <div>{p.contactEmail}</div>}
                    {p.contactPhone && <div>{p.contactPhone}</div>}
                    {!p.contactEmail && !p.contactPhone && <span>-</span>}
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500">
                    {p.contractStart || p.contractEnd ? (
                      <>
                        {p.contractStart ? fmtDate(p.contractStart) : "?"}
                        {" ~ "}
                        {p.contractEnd ? fmtDate(p.contractEnd) : "?"}
                      </>
                    ) : "-"}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium ${
                      p.status === "ACTIVE"
                        ? "bg-green-50 text-green-700 border-green-200"
                        : "bg-gray-100 text-gray-500 border-gray-200"
                    }`}>
                      {p.status === "ACTIVE" ? "활성" : "종료"}
                    </span>
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-2 text-right space-x-2">
                      <button onClick={() => setEditing(p)} className="text-xs text-blue-600 hover:text-blue-800">수정</button>
                      {p.status === "ACTIVE" ? (
                        <button onClick={() => handleArchive(p)} className="text-xs text-orange-600 hover:text-orange-800">종료</button>
                      ) : (
                        <button onClick={() => handleReactivate(p)} className="text-xs text-emerald-600 hover:text-emerald-800">활성</button>
                      )}
                      <button onClick={() => handleDelete(p)} className="text-xs text-red-400 hover:text-red-600">삭제</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 모달 */}
      {(creating || editing) && (
        <ExternalPersonForm
          person={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSuccess={() => { setCreating(false); setEditing(null); load(); }}
        />
      )}
    </div>
  );
}
