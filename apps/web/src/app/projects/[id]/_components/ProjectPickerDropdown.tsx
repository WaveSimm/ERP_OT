"use client";

import type { Dispatch, SetStateAction } from "react";
import { useRouter } from "next/navigation";
import { STATUS_LABELS } from "../_lib";

interface ProjectPickerDropdownProps {
  projectSearch: string;
  setProjectSearch: Dispatch<SetStateAction<string>>;
  allProjects: any[];
  projectId: string;
  pickerFolders: { id: string; name: string; parentId: string | null }[];
  pickerProjMap: Record<string, string[]>;
  pickerOpenFolders: Record<string, boolean>;
  setPickerOpenFolders: Dispatch<SetStateAction<Record<string, boolean>>>;
  pickerFolderProjOrder: Record<string, string[]>;
  setShowProjectPicker: Dispatch<SetStateAction<boolean>>;
  router: ReturnType<typeof useRouter>;
}

export default function ProjectPickerDropdown({
  projectSearch,
  setProjectSearch,
  allProjects,
  projectId,
  pickerFolders,
  pickerProjMap,
  pickerOpenFolders,
  setPickerOpenFolders,
  pickerFolderProjOrder,
  setShowProjectPicker,
  router,
}: ProjectPickerDropdownProps) {
  return (
    <div className="absolute top-full left-0 mt-1 w-[420px] max-w-[90vw] bg-white rounded-xl shadow-lg border border-gray-200 z-50 overflow-hidden">
      <div className="p-2 border-b border-gray-100">
        <input
          autoFocus
          type="text"
          placeholder="프로젝트 검색..."
          value={projectSearch}
          onChange={(e) => setProjectSearch(e.target.value)}
          className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <ul className="max-h-64 overflow-y-auto py-1">
        {(() => {
          const q = projectSearch.toLowerCase();

          // 검색 중일 때: 플랫 필터 리스트
          if (q) {
            const matched = allProjects.filter((p: any) => p.name.toLowerCase().includes(q));
            if (matched.length === 0) return <li className="px-4 py-3 text-sm text-gray-400 text-center">검색 결과 없음</li>;
            return matched.map((p: any) => {
              const pst = STATUS_LABELS[p.status];
              return (
                <li key={p.id}>
                  <button
                    onClick={() => { setShowProjectPicker(false); setProjectSearch(""); router.push(`/projects/${p.id}`); }}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-blue-50 flex items-center gap-2 ${p.id === projectId ? "bg-blue-50 font-semibold text-blue-700 dark:text-blue-300" : "text-gray-700"}`}
                  >
                    <span className="flex-1 truncate">{p.name}</span>
                    {pst && <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${pst.color}`}>{pst.label}</span>}
                  </button>
                </li>
              );
            });
          }

          // 트리 빌더: 폴더+프로젝트를 깊이 우선으로 flat 배열 생성
          type PickerItem =
            | { kind: "folder"; folder: { id: string; name: string }; depth: number }
            | { kind: "project"; project: any; depth: number };

          function buildItems(parentId: string | null, depth: number): PickerItem[] {
            const items: PickerItem[] = [];
            const childFolders = pickerFolders.filter(f => f.parentId === parentId);
            for (const folder of childFolders) {
              items.push({ kind: "folder", folder, depth });
              if (pickerOpenFolders[folder.id] !== false) {
                items.push(...buildItems(folder.id, depth + 1));
              }
            }
            const inFolder = parentId === null
              ? allProjects.filter((p: any) => !(pickerProjMap[p.id]?.length > 0))
              : allProjects.filter((p: any) => (pickerProjMap[p.id] ?? []).includes(parentId));
            const order = parentId ? (pickerFolderProjOrder[parentId] ?? []) : [];
            const childProjects = order.length > 0
              ? [
                  ...order.filter((id: string) => inFolder.some((p: any) => p.id === id)).map((id: string) => inFolder.find((p: any) => p.id === id)!),
                  ...inFolder.filter((p: any) => !order.includes(p.id)),
                ]
              : inFolder;
            for (const p of childProjects) {
              items.push({ kind: "project", project: p, depth });
            }
            return items;
          }

          const items = buildItems(null, 0);
          if (items.length === 0) return <li className="px-4 py-3 text-sm text-gray-400 text-center">프로젝트 없음</li>;

          return items.map((item, idx) => {
            if (item.kind === "folder") {
              const isOpen = pickerOpenFolders[item.folder.id] !== false;
              return (
                <li key={`f_${item.folder.id}`}>
                  <button
                    onClick={() => setPickerOpenFolders(prev => ({ ...prev, [item.folder.id]: !isOpen }))}
                    className="w-full text-left px-3 py-1.5 text-xs font-semibold text-gray-500 hover:bg-gray-50 flex items-center gap-1.5"
                    style={{ paddingLeft: 12 + item.depth * 14 }}
                  >
                    <span className="text-[9px] transition-transform duration-150 inline-block" style={{ transform: isOpen ? "rotate(90deg)" : "none" }}>▶</span>
                    <span>{isOpen ? "📂" : "📁"}</span>
                    <span className="truncate">{item.folder.name}</span>
                  </button>
                </li>
              );
            }
            const p = item.project;
            const pst = STATUS_LABELS[p.status];
            return (
              <li key={`p_${p.id}_${idx}`}>
                <button
                  onClick={() => { setShowProjectPicker(false); setProjectSearch(""); router.push(`/projects/${p.id}`); }}
                  className={`w-full text-left py-2 text-sm hover:bg-blue-50 flex items-center gap-2 ${p.id === projectId ? "bg-blue-50 font-semibold text-blue-700 dark:text-blue-300" : "text-gray-700"}`}
                  style={{ paddingLeft: 12 + item.depth * 14 }}
                >
                  <span className="text-gray-300 text-xs shrink-0">📄</span>
                  <span className="flex-1 truncate">{p.name}</span>
                  {pst && <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 mr-2 ${pst.color}`}>{pst.label}</span>}
                </button>
              </li>
            );
          });
        })()}
      </ul>
    </div>
  );
}
