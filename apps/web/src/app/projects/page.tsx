"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { projectApi } from "@/lib/api";
import AppLayout from "@/components/AppLayout";
import clsx from "clsx";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Project {
  id: string;
  name: string;
  status: string;
  ownerId?: string;
  effectiveStartDate?: string | null;
  effectiveEndDate?: string | null;
  overallProgress?: number;
}

interface Folder {
  id: string;
  name: string;
  parentId: string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ROW_H = 34;

const STATUS_CFG: Record<string, { label: string; dot: string; text: string }> = {
  PLANNING:    { label: "계획",   dot: "bg-gray-400",   text: "text-gray-500" },
  IN_PROGRESS: { label: "진행중", dot: "bg-blue-500",   text: "text-blue-600" },
  ON_HOLD:     { label: "보류",   dot: "bg-yellow-500", text: "text-yellow-600" },
  COMPLETED:   { label: "완료",   dot: "bg-green-500",  text: "text-green-600" },
  CANCELLED:   { label: "취소",   dot: "bg-red-400",    text: "text-red-500" },
};

// ─── localStorage helpers ─────────────────────────────────────────────────────

const LS_FOLDERS     = "erp_folders_v1";
const LS_PROJ_FOLDER = "erp_proj_folder_v2"; // v2: string[] per project
const LS_FOLDER_OPEN = "erp_folder_open_v1";

function lsGet<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback; }
  catch { return fallback; }
}
function lsSet(key: string, val: unknown) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

// 구버전(string|null) → 신버전(string[]) 자동 마이그레이션
function loadProjFolderMap(): Record<string, string[]> {
  const raw = lsGet<Record<string, unknown>>(LS_PROJ_FOLDER, {});
  const result: Record<string, string[]> = {};
  Object.entries(raw).forEach(([k, v]) => {
    if (Array.isArray(v)) result[k] = v;
    else if (typeof v === "string") result[k] = [v];
  });
  return result;
}

function fmtDate(s?: string | null) {
  if (!s) return "—";
  const d = new Date(s);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProjectsPage() {
  const router = useRouter();

  // API data
  const [projects, setProjects] = useState<Project[]>([]);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState("");

  // Tree state (localStorage)
  const [folders, setFolders]             = useState<Folder[]>([]);
  const [projFolderMap, setProjFolderMap] = useState<Record<string, string[]>>({});
  const [openFolders, setOpenFolders]     = useState<Record<string, boolean>>({});

  // Drag state
  const [dragging, setDragging]     = useState<{ type: "project" | "folder"; id: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | "root" | null>(null); // "into" 대상 폴더 id
  const [dropGap, setDropGap]       = useState<{ id: string; pos: "before" | "after" } | null>(null); // 순서 변경용 갭

  // Modals
  const [showCreate, setShowCreate]           = useState(false);
  const [newName, setNewName]                 = useState("");
  const [newDesc, setNewDesc]                 = useState("");
  const [creating, setCreating]               = useState(false);
  const [showNewFolder, setShowNewFolder]     = useState(false);
  const [newFolderName, setNewFolderName]     = useState("");
  const [newFolderParent, setNewFolderParent] = useState<string | null>(null);

  // Rename
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal]   = useState("");

  // Folder project picker
  const [pickerFolderId, setPickerFolderId] = useState<string | null>(null);
  const [pickerSearch, setPickerSearch]     = useState("");
  const [pickerSelected, setPickerSelected] = useState<Set<string>>(new Set());

  // Init localStorage
  useEffect(() => {
    setFolders(lsGet<Folder[]>(LS_FOLDERS, []));
    setProjFolderMap(loadProjFolderMap());
    setOpenFolders(lsGet<Record<string, boolean>>(LS_FOLDER_OPEN, {}));
  }, []);

  // Persist helpers
  const updateFolders = (f: Folder[]) => { setFolders(f); lsSet(LS_FOLDERS, f); };
  const updateMap = (m: Record<string, string[]>) => { setProjFolderMap(m); lsSet(LS_PROJ_FOLDER, m); };
  const toggleOpen = (id: string) => {
    setOpenFolders(prev => {
      const next = { ...prev, [id]: !(prev[id] !== false) };
      lsSet(LS_FOLDER_OPEN, next);
      return next;
    });
  };

  // Load projects
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await projectApi.list(search ? { search } : undefined);
      setProjects(r.items);
      setTotal(r.total);
    } catch (e: any) {
      if (e.message === "Unauthorized") return;
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const token = localStorage.getItem("erp_token");
    if (!token) { router.push("/login"); return; }
    load();
  }, [load, router]);

  // Create project
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const p = await projectApi.create({ name: newName, description: newDesc || undefined });
      setShowCreate(false);
      setNewName(""); setNewDesc("");
      router.push(`/projects/${p.id}`);
    } catch (e: any) { alert(e.message ?? "생성 실패"); }
    finally { setCreating(false); }
  };

  // Create folder
  const handleCreateFolder = () => {
    if (!newFolderName.trim()) return;
    const f: Folder = { id: `f_${Date.now()}`, name: newFolderName.trim(), parentId: newFolderParent };
    updateFolders([...folders, f]);
    if (newFolderParent) {
      setOpenFolders(prev => { const n = { ...prev, [newFolderParent!]: true }; lsSet(LS_FOLDER_OPEN, n); return n; });
    }
    setNewFolderName(""); setShowNewFolder(false);
  };

  // Delete project
  const handleDeleteProject = async (e: React.MouseEvent, p: Project) => {
    e.stopPropagation();
    if (!confirm(`"${p.name}" 프로젝트를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
    try {
      await projectApi.delete(p.id);
      // 폴더 맵에서도 제거
      const newMap = { ...projFolderMap };
      delete newMap[p.id];
      updateMap(newMap);
      load();
    } catch (err: any) {
      alert(err.message ?? "삭제 실패");
    }
  };

  // Delete folder (move children up, remove from project map)
  const handleDeleteFolder = (id: string) => {
    if (!confirm("폴더를 삭제하시겠습니까? 하위 항목은 상위로 이동됩니다.")) return;
    const folder = folders.find(f => f.id === id)!;
    updateFolders(
      folders.filter(f => f.id !== id)
             .map(f => f.parentId === id ? { ...f, parentId: folder.parentId } : f)
    );
    const newMap = { ...projFolderMap };
    Object.keys(newMap).forEach(pid => {
      newMap[pid] = newMap[pid].filter(fid => fid !== id);
    });
    updateMap(newMap);
  };

  // Open folder project picker
  const openPicker = (folderId: string) => {
    const current = new Set(projFolderMap[folderId] ? [] : []); // start fresh — we'll use per-project map
    // collect all projects already in this folder
    const already = new Set(projects.filter(p => (projFolderMap[p.id] ?? []).includes(folderId)).map(p => p.id));
    setPickerSelected(already);
    setPickerSearch("");
    setPickerFolderId(folderId);
  };

  const confirmPicker = () => {
    if (!pickerFolderId) return;
    const newMap = { ...projFolderMap };
    projects.forEach(p => {
      const current = newMap[p.id] ?? [];
      const hasFolder = current.includes(pickerFolderId);
      const shouldHave = pickerSelected.has(p.id);
      if (shouldHave && !hasFolder) newMap[p.id] = [...current, pickerFolderId];
      if (!shouldHave && hasFolder)  newMap[p.id] = current.filter(fid => fid !== pickerFolderId);
    });
    updateMap(newMap);
    // open the folder so added projects are visible
    setOpenFolders(prev => { const n = { ...prev, [pickerFolderId]: true }; lsSet(LS_FOLDER_OPEN, n); return n; });
    setPickerFolderId(null);
  };

  // Remove project from a specific folder
  const removeFromFolder = (projectId: string, folderId: string) => {
    const current = projFolderMap[projectId] ?? [];
    updateMap({ ...projFolderMap, [projectId]: current.filter(fid => fid !== folderId) });
  };

  // Drag & drop
  const clearDrag = () => { setDragging(null); setDropTarget(null); setDropGap(null); };

  const onDragStart = (type: "project" | "folder", id: string) => setDragging({ type, id });

  const onFolderDragOver = (e: React.DragEvent, folder: Folder) => {
    e.preventDefault(); e.stopPropagation();
    if (dragging?.type === "folder") {
      // 구역 감지: 상단 30% → before, 중간 → into, 하단 30% → after
      const ratio = (e.clientY - e.currentTarget.getBoundingClientRect().top) / (e.currentTarget as HTMLElement).offsetHeight;
      if (ratio < 0.3) {
        setDropGap({ id: folder.id, pos: "before" }); setDropTarget(null);
      } else if (ratio > 0.7) {
        setDropGap({ id: folder.id, pos: "after" }); setDropTarget(null);
      } else {
        setDropTarget(folder.id); setDropGap(null);
      }
    } else {
      setDropTarget(folder.id); setDropGap(null);
    }
  };

  const isDesc = (checkId: string, targetId: string | null): boolean => {
    if (!targetId) return false;
    if (checkId === targetId) return true;
    return isDesc(checkId, folders.find(f => f.id === targetId)?.parentId ?? null);
  };

  const onFolderDrop = (e: React.DragEvent, folder: Folder) => {
    e.preventDefault(); e.stopPropagation();
    if (!dragging) { clearDrag(); return; }

    if (dragging.type === "project") {
      const current = projFolderMap[dragging.id] ?? [];
      if (!current.includes(folder.id)) {
        updateMap({ ...projFolderMap, [dragging.id]: [...current, folder.id] });
      }
    } else if (dragging.type === "folder" && dragging.id !== folder.id) {
      if (dropGap) {
        // 갭 드롭: 같은 레벨로 이동 후 순서 조정
        if (isDesc(dragging.id, folder.id)) { clearDrag(); return; }
        const without = folders.filter(f => f.id !== dragging.id);
        const targetIdx = without.findIndex(f => f.id === dropGap.id);
        const insertIdx = dropGap.pos === "before" ? targetIdx : targetIdx + 1;
        const moved = { ...folders.find(f => f.id === dragging.id)!, parentId: folder.parentId };
        without.splice(insertIdx, 0, moved);
        updateFolders(without);
      } else {
        // 중간 드롭: 자식으로 이동
        if (!isDesc(dragging.id, folder.id)) {
          updateFolders(folders.map(f => f.id === dragging.id ? { ...f, parentId: folder.id } : f));
        }
      }
    }
    clearDrag();
  };

  const onRootDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (!dragging) { clearDrag(); return; }
    if (dragging.type === "project") {
      updateMap({ ...projFolderMap, [dragging.id]: [] });
    } else {
      updateFolders(folders.map(f => f.id === dragging.id ? { ...f, parentId: null } : f));
    }
    clearDrag();
  };

  const onDragEnd = () => clearDrag();

  // ─── Row renderers ───────────────────────────────────────────────────────────

  const renderProject = (p: Project, depth: number, folderId?: string) => {
    const st = STATUS_CFG[p.status] ?? STATUS_CFG.PLANNING;
    const prog = p.overallProgress ?? null;
    const isDragging = dragging?.type === "project" && dragging.id === p.id;
    const ownerDisplay = p.ownerId ? p.ownerId.slice(-8) : "—";

    return (
      <div
        key={folderId ? `${p.id}__${folderId}` : p.id}
        className={clsx(
          "flex items-center border-b border-gray-100 group/row cursor-pointer transition-colors",
          isDragging ? "opacity-30" : "hover:bg-blue-50/40",
        )}
        style={{ height: ROW_H }}
        draggable
        onDragStart={() => onDragStart("project", p.id)}
        onDragEnd={onDragEnd}
        onClick={() => router.push(`/projects/${p.id}`)}
      >
        {/* Name */}
        <div
          className="flex-1 min-w-0 flex items-center gap-1.5"
          style={{ paddingLeft: 10 + depth * 18 }}
        >
          <span className="w-3 h-px bg-gray-200 shrink-0" />
          <span className="text-gray-300 shrink-0 text-xs">📄</span>
          <span className="text-[13px] text-gray-800 truncate group-hover/row:text-blue-600 transition-colors leading-none">
            {p.name}
          </span>
          {/* 폴더에서 제거 버튼 */}
          {folderId && (
            <button
              onClick={e => { e.stopPropagation(); removeFromFolder(p.id, folderId); }}
              className="opacity-0 group-hover/row:opacity-100 ml-1 w-4 h-4 flex items-center justify-center rounded text-gray-300 hover:text-red-400 hover:bg-red-50 shrink-0 transition-all"
              title="이 폴더에서 제거"
            >
              ×
            </button>
          )}
        </div>
        {/* Owner */}
        <div className="w-[100px] shrink-0 px-2 text-xs text-gray-400 truncate">{ownerDisplay}</div>
        {/* Progress */}
        <div className="w-[100px] shrink-0 flex items-center gap-1.5 px-2">
          {prog !== null ? (
            <>
              <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full" style={{ width: `${prog}%` }} />
              </div>
              <span className="text-[11px] text-gray-500 w-7 text-right shrink-0">{Math.round(prog)}%</span>
            </>
          ) : (
            <span className="text-xs text-gray-200">—</span>
          )}
        </div>
        {/* Start */}
        <div className="w-[96px] shrink-0 px-2 text-xs text-gray-400">{fmtDate(p.effectiveStartDate)}</div>
        {/* End */}
        <div className="w-[96px] shrink-0 px-2 text-xs text-gray-400">{fmtDate(p.effectiveEndDate)}</div>
        {/* Status */}
        <div className="w-[80px] shrink-0 px-2 flex items-center gap-1">
          <span className={clsx("w-1.5 h-1.5 rounded-full shrink-0", st.dot)} />
          <span className={clsx("text-[11px] font-medium", st.text)}>{st.label}</span>
        </div>
        {/* Actions */}
        <div className="w-[36px] shrink-0 flex items-center justify-center opacity-0 group-hover/row:opacity-100 transition-opacity">
          <button
            onClick={(e) => handleDeleteProject(e, p)}
            className="w-6 h-6 flex items-center justify-center rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
            title="프로젝트 삭제"
          >
            🗑
          </button>
        </div>
      </div>
    );
  };

  const renderFolder = (folder: Folder, depth: number): React.ReactNode => {
    const isOpen       = openFolders[folder.id] !== false;
    const isDropping   = dropTarget === folder.id;
    const childFolders  = folders.filter(f => f.parentId === folder.id);
    const childProjects = filteredProjects.filter(p => (projFolderMap[p.id] ?? []).includes(folder.id));
    const childCount    = childFolders.length + childProjects.length;

    return (
      <div key={folder.id}>
        {/* 갭 인디케이터 — before */}
        {dropGap?.id === folder.id && dropGap.pos === "before" && (
          <div className="h-0.5 bg-blue-500 rounded mx-3 -mb-px relative z-10" />
        )}

        {/* Folder row */}
        <div
          className={clsx(
            "flex items-center border-b border-gray-100 group/row select-none transition-colors",
            isDropping ? "bg-blue-50 outline outline-1 outline-blue-300 outline-offset-[-1px]" : "hover:bg-gray-50/60",
          )}
          style={{ height: ROW_H, paddingLeft: 8 + depth * 18 }}
          draggable
          onDragStart={(e) => { e.stopPropagation(); onDragStart("folder", folder.id); }}
          onDragOver={(e) => onFolderDragOver(e, folder)}
          onDrop={(e) => onFolderDrop(e, folder)}
          onDragEnd={onDragEnd}
        >
          {/* Expand toggle */}
          <button
            className="w-5 h-5 flex items-center justify-center text-gray-300 hover:text-gray-600 shrink-0 mr-0.5"
            onClick={() => toggleOpen(folder.id)}
          >
            <span className={clsx("text-[9px] transition-transform duration-150 inline-block", isOpen ? "rotate-90" : "")}>▶</span>
          </button>
          <span className="mr-1.5 text-sm shrink-0">{isOpen ? "📂" : "📁"}</span>

          {/* Name / rename */}
          {/* Click folder name → project picker */}
          {renamingId === folder.id ? (
            <input
              autoFocus
              value={renameVal}
              onChange={e => setRenameVal(e.target.value)}
              onBlur={() => {
                if (renameVal.trim()) updateFolders(folders.map(f => f.id === folder.id ? { ...f, name: renameVal.trim() } : f));
                setRenamingId(null);
              }}
              onKeyDown={e => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setRenamingId(null);
              }}
              onClick={e => e.stopPropagation()}
              className="text-[13px] font-semibold text-gray-700 bg-white border border-blue-400 rounded px-1.5 py-0 focus:outline-none flex-1 max-w-[220px]"
            />
          ) : (
            <span
              className="text-[13px] font-semibold text-gray-700 flex-1 truncate leading-none cursor-pointer hover:text-blue-600"
              onClick={e => { e.stopPropagation(); openPicker(folder.id); }}
              onDoubleClick={e => { e.stopPropagation(); setRenamingId(folder.id); setRenameVal(folder.name); }}
              title="클릭: 프로젝트 추가 / 더블클릭: 이름 변경"
            >
              {folder.name}
            </span>
          )}

          {/* Count badge */}
          {childCount > 0 && (
            <span className="text-[11px] text-gray-300 mr-2 shrink-0">{childCount}</span>
          )}

          {/* Hover actions */}
          <div className="opacity-0 group-hover/row:opacity-100 flex items-center gap-0.5 mr-2 shrink-0 transition-opacity">
            <button
              onClick={e => { e.stopPropagation(); setNewFolderParent(folder.id); setShowNewFolder(true); }}
              className="text-[11px] text-gray-400 hover:text-blue-600 px-1.5 py-0.5 rounded hover:bg-blue-50"
              title="하위 폴더"
            >
              +폴더
            </button>
            <button
              onClick={e => { e.stopPropagation(); setRenamingId(folder.id); setRenameVal(folder.name); }}
              className="text-[11px] text-gray-400 hover:text-gray-700 px-1.5 py-0.5 rounded hover:bg-gray-100"
            >
              수정
            </button>
            <button
              onClick={e => { e.stopPropagation(); handleDeleteFolder(folder.id); }}
              className="text-[11px] text-gray-300 hover:text-red-500 px-1.5 py-0.5 rounded hover:bg-red-50"
            >
              삭제
            </button>
          </div>
        </div>

        {/* 갭 인디케이터 — after */}
        {dropGap?.id === folder.id && dropGap.pos === "after" && (
          <div className="h-0.5 bg-blue-500 rounded mx-3 -mt-px relative z-10" />
        )}

        {/* Children */}
        {isOpen && (
          <div>
            {childFolders.map(cf => renderFolder(cf, depth + 1))}
            {childProjects.map(p => renderProject(p, depth + 1, folder.id))}
          </div>
        )}
      </div>
    );
  };

  // ─── Filtered & tree ─────────────────────────────────────────────────────────

  const filteredProjects = search
    ? projects.filter(p => p.name.toLowerCase().includes(search.toLowerCase()))
    : projects;

  const rootFolders  = folders.filter(f => f.parentId === null);
  // 어떤 폴더에도 속하지 않은 프로젝트만 루트에 표시
  const rootProjects = filteredProjects.filter(p => !(projFolderMap[p.id]?.length > 0));
  const isRootDrop   = dropTarget === "root" && dragging !== null;

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto px-6 py-4">

        {/* Toolbar */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-gray-900">프로젝트</h2>
            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{total}</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="프로젝트 검색..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === "Enter" && load()}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-44"
            />
            <button
              onClick={() => { setNewFolderParent(null); setShowNewFolder(true); }}
              className="px-3 py-1.5 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50 flex items-center gap-1.5 transition-colors"
            >
              <span>📁</span> 폴더
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors flex items-center gap-1.5"
            >
              + 새 프로젝트
            </button>
          </div>
        </div>

        {/* Tree table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {/* Column headers */}
          <div
            className="flex items-center border-b border-gray-200 bg-gray-50/80 text-[11px] font-semibold text-gray-400 uppercase tracking-wider"
            style={{ height: 30 }}
          >
            <div className="flex-1 pl-4">프로젝트명</div>
            <div className="w-[100px] shrink-0 px-2">소유자</div>
            <div className="w-[100px] shrink-0 px-2">진도율</div>
            <div className="w-[96px] shrink-0 px-2">시작일</div>
            <div className="w-[96px] shrink-0 px-2">종료일</div>
            <div className="w-[80px] shrink-0 px-2">상태</div>
          </div>

          {/* Body */}
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full" />
            </div>
          ) : (
            <div
              className={clsx("min-h-[160px] transition-colors", isRootDrop && "bg-blue-50/30")}
              onDragOver={e => { e.preventDefault(); setDropTarget("root"); setDropGap(null); }}
              onDrop={onRootDrop}
            >
              {rootFolders.map(f => renderFolder(f, 0))}
              {rootProjects.map(p => renderProject(p, 0))}

              {rootFolders.length === 0 && rootProjects.length === 0 && (
                <div className="text-center py-14 text-gray-400 text-sm">
                  프로젝트가 없습니다.{" "}
                  <button onClick={() => setShowCreate(true)} className="text-blue-600 hover:underline">
                    만들기 →
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Drag hint */}
        {dragging && (
          <p className="text-xs text-gray-400 mt-2 text-center">
            {dragging.type === "project"
              ? "폴더 위에 놓으면 추가 / 빈 영역에 놓으면 모든 폴더에서 제거"
              : "폴더 위에 놓으면 이동됩니다"}
          </p>
        )}
      </div>

      {/* ── Folder create modal ─────────────────────────────────────────────── */}
      {showNewFolder && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-5 w-80">
            <h3 className="font-semibold text-gray-900 mb-3 text-sm">
              {newFolderParent
                ? `"${folders.find(f => f.id === newFolderParent)?.name}" 안에 폴더 추가`
                : "최상위 폴더 추가"}
            </h3>
            <input
              autoFocus
              type="text"
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleCreateFolder(); if (e.key === "Escape") setShowNewFolder(false); }}
              placeholder="폴더 이름..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3"
            />
            <div className="flex gap-2">
              <button
                onClick={() => { setShowNewFolder(false); setNewFolderName(""); }}
                className="flex-1 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
              >취소</button>
              <button
                onClick={handleCreateFolder}
                disabled={!newFolderName.trim()}
                className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-blue-700"
              >확인</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Folder project picker modal ─────────────────────────────────────── */}
      {pickerFolderId && (() => {
        const folder = folders.find(f => f.id === pickerFolderId);
        const filtered = projects.filter(p =>
          !pickerSearch || p.name.toLowerCase().includes(pickerSearch.toLowerCase())
        );
        const allChecked = filtered.length > 0 && filtered.every(p => pickerSelected.has(p.id));
        return (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md flex flex-col" style={{ maxHeight: "80vh" }}>
              {/* Header */}
              <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between shrink-0">
                <div>
                  <h3 className="font-semibold text-gray-900 text-sm">📁 {folder?.name}</h3>
                  <p className="text-[11px] text-gray-400 mt-0.5">프로젝트 선택 후 확인을 누르세요</p>
                </div>
                <button onClick={() => setPickerFolderId(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
              </div>

              {/* Search */}
              <div className="px-5 py-3 border-b border-gray-100 shrink-0">
                <input
                  autoFocus
                  type="text"
                  value={pickerSearch}
                  onChange={e => setPickerSearch(e.target.value)}
                  placeholder="프로젝트 검색..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Select all */}
              <div className="px-5 py-2 border-b border-gray-100 shrink-0 flex items-center gap-2">
                <input
                  type="checkbox"
                  id="picker-all"
                  checked={allChecked}
                  onChange={() => {
                    const ids = filtered.map(p => p.id);
                    setPickerSelected(prev => {
                      const next = new Set(prev);
                      if (allChecked) ids.forEach(id => next.delete(id));
                      else ids.forEach(id => next.add(id));
                      return next;
                    });
                  }}
                  className="w-3.5 h-3.5 accent-blue-600"
                />
                <label htmlFor="picker-all" className="text-[12px] text-gray-500 cursor-pointer select-none">
                  전체 선택 ({filtered.length})
                </label>
                {pickerSelected.size > 0 && (
                  <span className="ml-auto text-[11px] text-blue-600 font-medium">{pickerSelected.size}개 선택됨</span>
                )}
              </div>

              {/* Project list */}
              <div className="overflow-y-auto flex-1">
                {filtered.length === 0 ? (
                  <p className="text-center text-sm text-gray-400 py-10">검색 결과가 없습니다</p>
                ) : (
                  filtered.map(p => {
                    const st = STATUS_CFG[p.status] ?? STATUS_CFG.PLANNING;
                    const checked = pickerSelected.has(p.id);
                    return (
                      <label
                        key={p.id}
                        className={clsx(
                          "flex items-center gap-3 px-5 cursor-pointer hover:bg-blue-50/50 transition-colors border-b border-gray-50",
                          checked && "bg-blue-50/30"
                        )}
                        style={{ height: 40 }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setPickerSelected(prev => {
                            const next = new Set(prev);
                            checked ? next.delete(p.id) : next.add(p.id);
                            return next;
                          })}
                          className="w-3.5 h-3.5 accent-blue-600 shrink-0"
                        />
                        <span className="flex-1 text-[13px] text-gray-800 truncate">{p.name}</span>
                        <span className={clsx("text-[11px] shrink-0", st.text)}>{st.label}</span>
                      </label>
                    );
                  })
                )}
              </div>

              {/* Footer */}
              <div className="px-5 py-3 border-t border-gray-200 flex gap-2 shrink-0">
                <button
                  onClick={() => setPickerFolderId(null)}
                  className="flex-1 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
                >취소</button>
                <button
                  onClick={confirmPicker}
                  className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                >확인</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Project create modal ────────────────────────────────────────────── */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">새 프로젝트 만들기</h3>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            <form onSubmit={handleCreate} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">프로젝트명 *</label>
                <input
                  autoFocus
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="예: 신공장 A동 배관 공사"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">설명</label>
                <textarea
                  value={newDesc}
                  onChange={e => setNewDesc(e.target.value)}
                  rows={2}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  placeholder="간략한 설명"
                />
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setShowCreate(false)}
                  className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">
                  취소
                </button>
                <button type="submit" disabled={creating || !newName.trim()}
                  className="flex-1 bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
                  {creating ? "생성 중..." : "만들기"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
