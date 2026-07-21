"use client";

// 자원-모델-분리 PDCA Phase 3b-7 (2026-05-04)
// 공용자산(차량/시설) 목록·등록·수정 — equipmentResourceApi 사용
// 공용자산 정리 (2026-05-05): EQUIPMENT 타입 폐기, 프로젝트 미연계 단순 마스터.
//   "장비"는 /equipment 페이지의 Equipment 모델로 분리.

import { useEffect, useState } from "react";
import Link from "next/link";
import { equipmentResourceApi, type EquipmentResource } from "@/lib/api";
import { useDragAutoScroll } from "@/hooks/useDragAutoScroll";

// EQUIPMENT는 폐기된 레거시 타입(2026-05-05) — 신규는 VEHICLE/FACILITY만이라 Partial.
const TYPE_LABEL: Partial<Record<EquipmentResource["type"], string>> = {
  VEHICLE: "🚗 차량",
  FACILITY: "🏭 시설",
};

export function EquipmentResourcesPanel({ isAdmin }: { isAdmin: boolean }) {
  const [items, setItems] = useState<EquipmentResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<EquipmentResource | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"" | EquipmentResource["type"]>("");
  const [activeFilter, setActiveFilter] = useState<"" | "true" | "false">("");

  // 수동 정렬 — 목록은 백엔드 sortOrder 순서 그대로 표시. 행 드래그로 변경 → 예약 목록에 반영.
  // 필터/검색 적용 중엔 부분 재정렬 방지를 위해 비활성. (프로젝트 태스크 드래그와 동일 방식)
  const canReorder = isAdmin && !search && !typeFilter && !activeFilter;

  const [dragId, setDragId] = useState<string | null>(null);
  const [dropGap, setDropGap] = useState<{ id: string; pos: "before" | "after" } | null>(null);
  const { start: startAutoScroll, stop: stopAutoScroll } = useDragAutoScroll();  // window 스크롤
  const clearDrag = () => { setDragId(null); setDropGap(null); stopAutoScroll(); };

  const onDragStart = (e: React.DragEvent, id: string) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = "move";
    startAutoScroll(e.clientY);
  };
  const onRowDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    if (!dragId || id === dragId) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const pos = (e.clientY - rect.top) / rect.height < 0.5 ? "before" : "after";
    if (dropGap?.id !== id || dropGap.pos !== pos) setDropGap({ id, pos });
  };
  const onRowDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    if (!dragId || !dropGap) { clearDrag(); return; }
    const ids = items.map((r) => r.id);
    const without = ids.filter((x) => x !== dragId);
    const targetIdx = without.indexOf(dropGap.id);
    if (targetIdx === -1) { clearDrag(); return; }
    const insertAt = dropGap.pos === "before" ? targetIdx : targetIdx + 1;
    const newOrder = [...without];
    newOrder.splice(insertAt, 0, dragId);
    clearDrag();
    if (newOrder.join() === ids.join()) return; // 순서 변화 없음
    const reordered = newOrder.map((id) => items.find((r) => r.id === id)!);
    setItems(reordered); // 낙관적 반영
    try {
      await equipmentResourceApi.reorder(newOrder);
    } catch (err: any) {
      alert("순서 변경 실패: " + (err.message ?? "오류"));
      load();
    }
  };

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
                {isAdmin && <th className="px-2 py-2 font-medium w-14 text-center">순서</th>}
                <th className="text-left px-4 py-2 font-medium">이름</th>
                <th className="text-left px-4 py-2 font-medium">유형</th>
                <th className="text-left px-4 py-2 font-medium">상태</th>
                {isAdmin && <th className="text-right px-4 py-2 font-medium">관리</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr
                  key={r.id}
                  draggable={canReorder}
                  onDragStart={canReorder ? (e) => onDragStart(e, r.id) : undefined}
                  onDragOver={canReorder ? (e) => onRowDragOver(e, r.id) : undefined}
                  onDrop={canReorder ? onRowDrop : undefined}
                  onDragEnd={canReorder ? clearDrag : undefined}
                  className={`border-t border-gray-100 hover:bg-gray-50 transition-opacity ${
                    dragId === r.id ? "opacity-40" : ""
                  } ${
                    dropGap?.id === r.id
                      ? dropGap.pos === "before"
                        ? "border-t-2 border-t-blue-500"
                        : "border-b-2 border-b-blue-500"
                      : ""
                  }`}
                >
                  {isAdmin && (
                    <td className="px-2 py-2 text-center whitespace-nowrap">
                      {canReorder ? (
                        <span className="text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing select-none"
                          title="드래그하여 순서 변경">⠿</span>
                      ) : (
                        <span className="text-gray-300 text-xs" title="필터·검색 해제 후 순서 변경 가능">–</span>
                      )}
                    </td>
                  )}
                  <td className="px-4 py-2 font-medium">
                    {r.type === "VEHICLE" ? (
                      <Link
                        href={`/management/equipment-resources/${r.id}`}
                        className="text-gray-900 dark:text-gray-100 hover:text-blue-600 hover:underline"
                        title="상세 이력 보기"
                      >
                        {r.name} <span className="text-gray-400">›</span>
                      </Link>
                    ) : (
                      r.name
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-600">{TYPE_LABEL[r.type] ?? r.type}</td>
                  <td className="px-4 py-2">
                    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium ${
                      r.isActive
                        ? "bg-green-50 text-green-700 border-green-200 dark:text-green-300"
                        : "bg-gray-100 text-gray-500 border-gray-200"
                    }`}>
                      {r.isActive ? "활성" : "비활성"}
                    </span>
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-2 text-right space-x-2">
                      <button onClick={() => setEditing(r)} className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800">수정</button>
                      <button onClick={() => handleToggleActive(r)} className="text-xs text-orange-600 dark:text-orange-400 hover:text-orange-800">
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
