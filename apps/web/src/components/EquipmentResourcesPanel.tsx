"use client";

// 자원-모델-분리 PDCA Phase 3b-7 (2026-05-04)
// 공용자산(차량/시설) 목록·등록·수정 — equipmentResourceApi 사용
// 공용자산 정리 (2026-05-05): EQUIPMENT 타입 폐기, 프로젝트 미연계 단순 마스터.
//   "장비"는 /equipment 페이지의 Equipment 모델로 분리.

import { useEffect, useMemo, useState } from "react";
import { equipmentResourceApi, type EquipmentResource } from "@/lib/api";

const TYPE_LABEL: Record<EquipmentResource["type"], string> = {
  VEHICLE: "🚗 차량",
  FACILITY: "🏭 시설",
};

type SortKey = "name" | "type" | "isActive";
type SortDir = "asc" | "desc";

export function EquipmentResourcesPanel({ isAdmin }: { isAdmin: boolean }) {
  const [items, setItems] = useState<EquipmentResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<EquipmentResource | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"" | EquipmentResource["type"]>("");
  const [activeFilter, setActiveFilter] = useState<"" | "true" | "false">("");

  // 컬럼 정렬 — 기본 이름 오름차순
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const sortedItems = useMemo(() => {
    const arr = [...items];
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") cmp = a.name.localeCompare(b.name, "ko");
      else if (sortKey === "type") cmp = a.type.localeCompare(b.type);
      else cmp = (a.isActive === b.isActive) ? 0 : a.isActive ? -1 : 1; // 활성이 위
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [items, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function sortIndicator(key: SortKey): string {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " ▲" : " ▼";
  }

  const load = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (typeFilter) params.type = typeFilter;
      if (activeFilter) params.isActive = activeFilter;
      if (search) params.search = search;
      const data = await equipmentResourceApi.list(params);
      setItems(data);
    } catch (err: any) {
      alert("목록 실패: " + (err.message ?? "오류"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [typeFilter, activeFilter]);

  const handleToggleActive = async (item: EquipmentResource) => {
    try {
      await equipmentResourceApi.update(item.id, { isActive: !item.isActive });
      load();
    } catch (err: any) {
      alert("변경 실패: " + (err.message ?? "오류"));
    }
  };

  const handleDelete = async (item: EquipmentResource) => {
    if (!confirm(`"${item.name}"을(를) 삭제할까요? (배정 이력이 있으면 삭제 불가)`)) return;
    try {
      await equipmentResourceApi.delete(item.id);
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
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as any)}
          className="border border-gray-300 rounded px-2 py-1 text-sm"
        >
          <option value="">전체 유형</option>
          <option value="VEHICLE">🚗 차량</option>
          <option value="FACILITY">🏭 시설</option>
        </select>
        <select
          value={activeFilter}
          onChange={(e) => setActiveFilter(e.target.value as any)}
          className="border border-gray-300 rounded px-2 py-1 text-sm"
        >
          <option value="">전체 상태</option>
          <option value="true">활성</option>
          <option value="false">비활성</option>
        </select>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
          placeholder="이름 검색"
          className="border border-gray-300 rounded px-2 py-1 text-sm"
        />
        <button onClick={load} className="text-sm border rounded px-3 py-1 hover:bg-gray-50">검색</button>
        <div className="flex-1" />
        {isAdmin && (
          <button
            onClick={() => setShowCreate(true)}
            className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            + 자원 추가
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <span className="text-4xl mb-3">🔧</span>
          <p className="text-sm">등록된 자원이 없습니다.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 select-none">
              <tr>
                <th className="text-left px-4 py-2 font-medium">
                  <button
                    type="button"
                    onClick={() => toggleSort("name")}
                    className="hover:text-gray-700 inline-flex items-center"
                  >
                    이름{sortIndicator("name")}
                  </button>
                </th>
                <th className="text-left px-4 py-2 font-medium">
                  <button
                    type="button"
                    onClick={() => toggleSort("type")}
                    className="hover:text-gray-700 inline-flex items-center"
                  >
                    유형{sortIndicator("type")}
                  </button>
                </th>
                <th className="text-left px-4 py-2 font-medium">
                  <button
                    type="button"
                    onClick={() => toggleSort("isActive")}
                    className="hover:text-gray-700 inline-flex items-center"
                  >
                    상태{sortIndicator("isActive")}
                  </button>
                </th>
                {isAdmin && <th className="text-right px-4 py-2 font-medium">관리</th>}
              </tr>
            </thead>
            <tbody>
              {sortedItems.map((r) => (
                <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-2 font-medium">{r.name}</td>
                  <td className="px-4 py-2 text-xs text-gray-600">{TYPE_LABEL[r.type]}</td>
                  <td className="px-4 py-2">
                    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium ${
                      r.isActive
                        ? "bg-green-50 text-green-700 border-green-200"
                        : "bg-gray-100 text-gray-500 border-gray-200"
                    }`}>
                      {r.isActive ? "활성" : "비활성"}
                    </span>
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-2 text-right space-x-2">
                      <button onClick={() => setEditing(r)} className="text-xs text-blue-600 hover:text-blue-800">수정</button>
                      <button onClick={() => handleToggleActive(r)} className="text-xs text-orange-600 hover:text-orange-800">
                        {r.isActive ? "비활성" : "활성"}
                      </button>
                      <button onClick={() => handleDelete(r)} className="text-xs text-red-400 hover:text-red-600">삭제</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(showCreate || editing) && (
        <EquipmentResourceForm
          item={editing}
          onClose={() => { setShowCreate(false); setEditing(null); }}
          onSuccess={() => { setShowCreate(false); setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function EquipmentResourceForm({ item, onClose, onSuccess }: {
  item: EquipmentResource | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const isEdit = !!item;
  const [name, setName] = useState(item?.name ?? "");
  const [type, setType] = useState<EquipmentResource["type"]>(item?.type ?? "VEHICLE");
  const [isActive, setIsActive] = useState(item?.isActive ?? true);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      alert("이름은 필수입니다.");
      return;
    }
    setSubmitting(true);
    try {
      if (isEdit && item) {
        await equipmentResourceApi.update(item.id, { name: name.trim(), type, isActive });
      } else {
        await equipmentResourceApi.create({ name: name.trim(), type, isActive });
      }
      onSuccess();
    } catch (err: any) {
      alert((isEdit ? "수정" : "등록") + " 실패: " + (err.message ?? "오류"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-lg w-[400px] max-w-[90vw]">
        <div className="px-5 py-3 border-b">
          <h3 className="font-semibold">{isEdit ? "공용자산 수정" : "공용자산 추가"}</h3>
        </div>
        <div className="px-5 py-4 space-y-3 text-sm">
          <div>
            <label className="block text-gray-500 text-xs mb-1">이름 *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-gray-300 rounded px-2 py-1.5"
              required
            />
          </div>
          <div>
            <label className="block text-gray-500 text-xs mb-1">유형</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as any)}
              className="w-full border border-gray-300 rounded px-2 py-1.5"
            >
              <option value="VEHICLE">🚗 차량</option>
              <option value="FACILITY">🏭 시설</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            활성
          </label>
        </div>
        <div className="px-5 py-3 border-t flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={submitting}
            className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50 disabled:opacity-50">
            취소
          </button>
          <button type="submit" disabled={submitting}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
            {submitting ? "저장 중..." : isEdit ? "수정" : "추가"}
          </button>
        </div>
      </form>
    </div>
  );
}
