"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { taskApi } from "@/lib/api";

const AVATAR_COLORS = [
  "bg-blue-500", "bg-emerald-500", "bg-violet-500", "bg-orange-500",
  "bg-rose-500", "bg-cyan-500", "bg-amber-500", "bg-teal-500",
];
function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

interface Props {
  task: any;
  projectId: string;
  allResources: any[];
  onRefresh: () => void;
  /** 상위 태스크용: 하위 자원 집계 목록. 제공 시 아바타 표시에 사용 */
  displayResources?: any[];
}

export default function ResourcePickerPopover({ task, projectId, allResources, onRefresh, displayResources }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // 현재 배정된 자원 ID 집합 (첫 번째 세그먼트 기준)
  const firstSeg = task.segments?.[0];
  const assignedIds = new Set<string>(
    (task.segments ?? []).flatMap((s: any) =>
      (s.assignments ?? []).map((a: any) => a.resourceId)
    )
  );

  const openPicker = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (open) { setOpen(false); return; }
    const rect = btnRef.current!.getBoundingClientRect();
    const left = Math.min(rect.left, window.innerWidth - 240 - 8);
    setPos({ top: rect.bottom + 4, left });
    setSearch("");
    setOpen(true);
  };

  // 외부 클릭 닫기
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!popoverRef.current?.contains(e.target as Node) && !btnRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const toggleResource = useCallback(async (resource: any) => {
    if (!firstSeg) return;
    setSaving(resource.id);
    try {
      if (assignedIds.has(resource.id)) {
        await taskApi.removeAssignment(projectId, task.id, firstSeg.id, resource.id);
      } else {
        await taskApi.upsertAssignment(projectId, task.id, firstSeg.id, {
          resourceId: resource.id,
          allocationMode: "PERCENT",
          allocationPercent: 100,
        });
      }
      onRefresh();
    } catch {
      // ignore
    } finally {
      setSaving(null);
    }
  }, [task, projectId, firstSeg, assignedIds, onRefresh]);

  const filtered = allResources.filter((r) =>
    r.name.toLowerCase().includes(search.toLowerCase())
  );

  // 아바타 표시용: displayResources(상위 태스크 집계) 또는 자기 세그먼트 자원
  const avatarList: any[] = displayResources ?? Array.from(
    new Map(
      (task.segments ?? []).flatMap((s: any) =>
        (s.assignments ?? []).map((a: any) => [a.resourceId, a])
      )
    ).values()
  );

  const visibleAvatars = avatarList.slice(0, 4);
  const overflowCount = avatarList.length - 4;

  return (
    <div className="flex items-center">
      {/* 배정된 아바타들 — overlap stack */}
      {visibleAvatars.map((a: any, idx: number) => {
        const name: string = a.resourceName ?? "?";
        return (
          <div
            key={a.resourceId}
            title={`${name} (${a.allocationMode === "PERCENT" ? `${a.allocationPercent ?? 100}%` : `${a.allocationHoursPerDay ?? 8}h/일`})`}
            className={`w-6 h-6 rounded-full ${avatarColor(name)} flex items-center justify-center text-white text-[9px] font-bold ring-2 ring-white shrink-0`}
            style={{ marginLeft: idx === 0 ? 0 : -8, zIndex: visibleAvatars.length - idx }}
          >
            {name.slice(0, 2)}
          </div>
        );
      })}
      {overflowCount > 0 && (
        <div
          className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-[8px] font-bold ring-2 ring-white shrink-0"
          style={{ marginLeft: -8, zIndex: 0 }}
          title={avatarList.slice(4).map((a: any) => a.resourceName ?? "?").join(", ")}
        >
          +{overflowCount}
        </div>
      )}

      {/* + 버튼 */}
      {firstSeg ? (
        <button
          ref={btnRef}
          onClick={openPicker}
          className="w-6 h-6 rounded-full border-2 border-dashed border-gray-300 flex items-center justify-center text-gray-400 hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50 transition-colors shrink-0 text-[11px] font-bold ring-2 ring-white"
          style={{ marginLeft: avatarList.length > 0 ? -8 : 0, zIndex: 0 }}
          title="자원 배정"
        >
          +
        </button>
      ) : (
        <span className="text-[10px] text-gray-300" title="세그먼트 없음">—</span>
      )}

      {/* 팝오버 */}
      {open && (
        <div
          ref={popoverRef}
          className="fixed z-[9999] w-56 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden"
          style={{ top: pos.top, left: pos.left }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-2 border-b border-gray-100">
            <input
              autoFocus
              type="text"
              placeholder="자원 검색..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="max-h-48 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-3">검색 결과 없음</p>
            ) : filtered.map((r) => {
              const isAssigned = assignedIds.has(r.id);
              const isSaving = saving === r.id;
              return (
                <button
                  key={r.id}
                  onClick={() => toggleResource(r)}
                  disabled={isSaving}
                  className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  <div className={`w-6 h-6 rounded-full ${avatarColor(r.name)} flex items-center justify-center text-white text-[10px] font-bold shrink-0`}>
                    {r.name.slice(0, 2)}
                  </div>
                  <span className={`flex-1 text-left text-xs truncate ${isAssigned ? "font-semibold text-blue-600" : "text-gray-700"}`}>
                    {r.name}
                  </span>
                  {isAssigned && (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="shrink-0 text-blue-500">
                      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                  {isSaving && (
                    <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
          {task.segments?.length > 1 && (
            <div className="px-3 py-1.5 border-t border-gray-100 text-[10px] text-gray-400">
              ※ 첫 번째 세그먼트에 배정됩니다
            </div>
          )}
        </div>
      )}
    </div>
  );
}
