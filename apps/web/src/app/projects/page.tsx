"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { projectApi, userManagementApi, folderApi, templateApi } from "@/lib/api";
import AppLayout from "@/components/AppLayout";
import ProjectSummaryDrawer from "@/components/ProjectSummaryDrawer";
import TemplateWizard from "@/components/TemplateWizard";
import TemplateManagerModal from "@/components/TemplateManagerModal";
import UndoRedoControls from "@/components/UndoRedoControls";
import { usePermission } from "@/hooks/usePermission";
import { useFillHeight } from "@/hooks/useFillHeight";
import { useDragAutoScroll } from "@/hooks/useDragAutoScroll";
import { useUndoRedo } from "@/hooks/useUndoRedo";
import clsx from "clsx";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Project {
  id: string;
  name: string;
  status: string;
  ownerId?: string;
  ownerName?: string | null;
  effectiveStartDate?: string | null;
  effectiveEndDate?: string | null;
  overallProgress?: number | null;
}

interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  // 부서 기본 폴더 표시 (auth 부서 id). null이면 수동 폴더 — 이름·삭제 자유.
  departmentId?: string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ROW_H = 34;

const STATUS_CFG: Record<string, { label: string; dot: string; text: string }> = {
  PLANNING:    { label: "계획",   dot: "bg-gray-400",   text: "text-gray-500" },
  IN_PROGRESS: { label: "진행중", dot: "bg-blue-500",   text: "text-blue-600 dark:text-blue-400" },
  ON_HOLD:     { label: "보류",   dot: "bg-yellow-500", text: "text-yellow-600 dark:text-yellow-400" },
  COMPLETED:   { label: "완료",   dot: "bg-green-500",  text: "text-green-600 dark:text-green-400" },
  CANCELLED:   { label: "취소",   dot: "bg-red-400",    text: "text-red-500 dark:text-red-400" },
};

// ─── localStorage helpers (UI preferences only) ──────────────────────────────

const LS_FOLDER_OPEN = "erp_folder_open_v1";
// '내 즐겨찾기' 가상 폴더 id (실제 폴더 아님 — 사용자별 프라이빗)
const FAVORITES_FOLDER_ID = "__favorites__";

function lsGet<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback; }
  catch { return fallback; }
}
function lsSet(key: string, val: unknown) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

/** API 응답에서 projFolderMap (projectId → folderId[]) 구축 */
function buildProjFolderMap(apiFolders: any[]): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const f of apiFolders) {
    for (const item of f.projects ?? []) {
      if (!map[item.projectId]) map[item.projectId] = [];
      map[item.projectId].push(f.id);
    }
  }
  return map;
}

/** API 응답에서 folderProjOrder (folderId → projectId[]) 구축 */
function buildFolderProjOrder(apiFolders: any[]): Record<string, string[]> {
  const order: Record<string, string[]> = {};
  for (const f of apiFolders) {
    const sorted = [...(f.projects ?? [])].sort((a: any, b: any) => a.sortOrder - b.sortOrder);
    order[f.id] = sorted.map((item: any) => item.projectId);
  }
  return order;
}

function fmtDate(s?: string | null) {
  if (!s) return "—";
  const d = new Date(s);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProjectsPage() {
  const router = useRouter();
  const { isManager, isOperator } = usePermission();

  // API data
  const [projects, setProjects] = useState<Project[]>([]);
  const { ref: tableBoxRef, maxHeight: tableMaxH } = useFillHeight();
  const [summaryId, setSummaryId] = useState<string | null>(null); // 프로젝트 요약 드로어
  const [showTemplateWizard, setShowTemplateWizard] = useState(false); // 새 프로젝트 - 템플릿으로 만들기
  const [showTemplateManager, setShowTemplateManager] = useState(false); // 템플릿 관리
  // 템플릿 저장 (기존 프로젝트 → 템플릿)
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [saveTplProjectId, setSaveTplProjectId] = useState("");
  const [saveTplName, setSaveTplName] = useState("");
  const [saveTplCategory, setSaveTplCategory] = useState("");
  const [saveTplIncludeAssignments, setSaveTplIncludeAssignments] = useState(false);
  const [saveTplLoading, setSaveTplLoading] = useState(false);
  const [saveTplError, setSaveTplError] = useState("");
  const [tplNames, setTplNames] = useState<string[]>([]);       // 기존 템플릿 이름 (검색/중복확인)
  const [tplCategories, setTplCategories] = useState<string[]>([]); // 기존 카테고리 (검색/재사용)
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState("");

  // Tree state (DB-backed, openFolders is UI-only localStorage)
  const [folders, setFolders]             = useState<Folder[]>([]);
  const [projFolderMap, setProjFolderMap] = useState<Record<string, string[]>>({});
  const [openFolders, setOpenFolders]     = useState<Record<string, boolean>>({});
  const [favoriteIds, setFavoriteIds]     = useState<string[]>([]); // 내 즐겨찾기 projectId (사용자별 프라이빗)

  // Drag state
  const [dragging, setDragging]     = useState<{ type: "project" | "folder"; id: string; fromFolderId?: string } | null>(null);
  const dropHandledRef = useRef(false);
  const [dropTarget, setDropTarget] = useState<string | "root" | null>(null); // "into" 대상 폴더 id
  const [dropGap, setDropGap]       = useState<{ id: string; pos: "before" | "after" } | null>(null); // 폴더 순서 변경용 갭
  const [projGap, setProjGap]       = useState<{ folderId: string; refId: string; pos: "before" | "after" } | null>(null); // 프로젝트 순서 변경용 갭
  const [folderProjOrder, setFolderProjOrder] = useState<Record<string, string[]>>({}); // folderId → projectId[]

  // Owner edit
  const [allEmployees, setAllEmployees] = useState<{ id: string; name: string }[]>([]);
  const [ownerEditId, setOwnerEditId]   = useState<string | null>(null); // 편집 중인 projectId
  const [ownerSearch, setOwnerSearch]   = useState("");
  const [ownerDropPos, setOwnerDropPos] = useState<{ top: number; left: number } | null>(null);
  const ownerDropRef = useRef<HTMLDivElement>(null);

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

  // Load folders from DB
  const loadFolders = useCallback(async () => {
    try {
      const apiFolders = await folderApi.list();
      setFolders(apiFolders.map((f: any) => ({ id: f.id, name: f.name, parentId: f.parentId ?? null, departmentId: f.departmentId ?? null })));
      setProjFolderMap(buildProjFolderMap(apiFolders));
      setFolderProjOrder(buildFolderProjOrder(apiFolders));
    } catch { /* ignore — folders just won't show */ }
    // 내 즐겨찾기 (사용자별)
    folderApi.favorites().then((r) => setFavoriteIds(r.projectIds ?? [])).catch(() => {});
  }, []);

  // 즐겨찾기 토글 (낙관적 업데이트 + 실패 시 롤백)
  const isFavorite = (projectId: string) => favoriteIds.includes(projectId);
  const handleToggleFavorite = async (projectId: string) => {
    const fav = favoriteIds.includes(projectId);
    const prev = favoriteIds;
    setFavoriteIds(fav ? favoriteIds.filter((id) => id !== projectId) : [projectId, ...favoriteIds]);
    try {
      if (fav) await folderApi.removeFavorite(projectId);
      else await folderApi.addFavorite(projectId);
    } catch {
      setFavoriteIds(prev);
    }
  };

  // Undo / Redo (shared hook) — onError에서 loadFolders/load를 ref로 참조
  const loadRef = useRef<() => void>(() => {});
  const loadFoldersRef = useRef<() => void>(() => {});
  const { push: pushUndo, undo: handleUndo, redo: handleRedo, undoCount, redoCount, undoLabel, redoLabel, toast } =
    useUndoRedo({ onError: () => { loadFoldersRef.current(); loadRef.current(); } });

  // Init
  useEffect(() => {
    setOpenFolders(lsGet<Record<string, boolean>>(LS_FOLDER_OPEN, {}));
  }, []);

  const toggleOpen = (id: string) => {
    setOpenFolders(prev => {
      const next = { ...prev, [id]: !(prev[id] !== false) };
      lsSet(LS_FOLDER_OPEN, next);
      return next;
    });
  };

  // Load projects — 항상 전체 로드, 필터링은 클라이언트에서 처리
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await projectApi.list();
      setProjects(r.items);
      setTotal(r.total);
    } catch (e: any) {
      if (e.message === "Unauthorized") return;
    } finally {
      setLoading(false);
    }
  }, []);

  // Ref 업데이트 (useUndoRedo onError 콜백용)
  loadRef.current = load;
  loadFoldersRef.current = loadFolders;

  useEffect(() => {
    const token = localStorage.getItem("erp_user");
    if (!token) { router.push("/login"); return; }
    load();
    loadFolders();
    userManagementApi.members(true).then(setAllEmployees).catch(() => {});
  }, [load, loadFolders, router]);

  // owner 드롭다운 외부 클릭 시 닫기
  useEffect(() => {
    if (!ownerEditId) return;
    const handler = (e: MouseEvent) => {
      if (ownerDropRef.current && !ownerDropRef.current.contains(e.target as Node)) {
        setOwnerEditId(null);
        setOwnerDropPos(null);
        setOwnerSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ownerEditId]);

  const handleOwnerChange = async (projectId: string, newOwnerId: string, newOwnerName: string) => {
    const proj = projects.find(p => p.id === projectId);
    const oldOwnerId = proj?.ownerId;
    const oldOwnerName = proj?.ownerName ?? null;
    setProjects(prev => prev.map(p => p.id === projectId ? { ...p, ownerId: newOwnerId, ownerName: newOwnerName } : p));
    setOwnerEditId(null);
    setOwnerDropPos(null);
    setOwnerSearch("");
    try {
      await projectApi.update(projectId, { ownerId: newOwnerId });
      pushUndo({
        label: `소유자 "${oldOwnerName ?? "없음"}" → "${newOwnerName}"`,
        undo: async () => {
          await projectApi.update(projectId, { ownerId: oldOwnerId ?? null });
          setProjects(prev => prev.map(p => p.id === projectId ? { ...p, ownerId: oldOwnerId, ownerName: oldOwnerName } : p));
        },
        redo: async () => {
          await projectApi.update(projectId, { ownerId: newOwnerId });
          setProjects(prev => prev.map(p => p.id === projectId ? { ...p, ownerId: newOwnerId, ownerName: newOwnerName } : p));
        },
      });
    } catch {
      load();
    }
  };

  // Create project
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const name = newName.trim();
      const desc = newDesc || undefined;
      const p = await projectApi.create({ name, description: desc });
      setShowCreate(false);
      setNewName(""); setNewDesc("");
      pushUndo({
        label: `프로젝트 "${name}" 생성`,
        undo: async () => {
          await projectApi.delete(p.id);
          load();
        },
        redo: async () => {
          await projectApi.create({ name, description: desc });
          load();
        },
      });
      router.push(`/projects/${p.id}`);
    } catch (e: any) { alert(e.message ?? "생성 실패"); }
    finally { setCreating(false); }
  };

  // Create folder
  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    const name = newFolderName.trim();
    const parentId = newFolderParent;
    try {
      const created = await folderApi.create({ name, parentId: parentId ?? undefined });
      const folder: Folder = { id: created.id, name: created.name, parentId: created.parentId ?? null };
      setFolders(prev => [...prev, folder]);
      if (parentId) {
        setOpenFolders(prev => { const n = { ...prev, [parentId]: true }; lsSet(LS_FOLDER_OPEN, n); return n; });
      }
      pushUndo({
        label: `폴더 "${name}" 생성`,
        undo: async () => {
          await folderApi.remove(folder.id);
          setFolders(prev => prev.filter(f => f.id !== folder.id));
          setProjFolderMap(prev => {
            const n = { ...prev };
            Object.keys(n).forEach(pid => { n[pid] = n[pid].filter(fid => fid !== folder.id); });
            return n;
          });
        },
        redo: async () => {
          const re = await folderApi.create({ name, parentId: parentId ?? undefined });
          // id가 달라지므로 갱신
          folder.id = re.id;
          setFolders(prev => [...prev, { id: re.id, name, parentId: parentId }]);
        },
      });
    } catch { /* ignore */ }
    setNewFolderName(""); setShowNewFolder(false);
  };

  // Delete project
  const handleDeleteProject = async (e: React.MouseEvent, p: Project) => {
    e.stopPropagation();
    if (!confirm(`"${p.name}" 프로젝트를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
    try {
      await projectApi.delete(p.id);
      // 폴더 맵에서도 제거 (DB cascade 가 처리하지만 UI 즉시 반영)
      setProjFolderMap(prev => { const n = { ...prev }; delete n[p.id]; return n; });
      load();
    } catch (err: any) {
      alert(err.message ?? "삭제 실패");
    }
  };

  // Delete folder (cascade delete in DB removes children + items)
  const handleDeleteFolder = async (id: string) => {
    if (!confirm("폴더를 삭제하시겠습니까? 하위 폴더와 프로젝트 매핑도 함께 삭제됩니다.")) return;
    // 삭제 전 스냅샷 저장 (undo 복원용)
    const snapshot = folders.find(f => f.id === id);
    if (!snapshot) return;
    const childFolders = folders.filter(f => f.parentId === id);
    const mappedProjects: { projectId: string }[] = [];
    Object.entries(projFolderMap).forEach(([pid, fids]) => {
      if (fids.includes(id)) mappedProjects.push({ projectId: pid });
    });

    try {
      await folderApi.remove(id);
      setFolders(prev => prev.filter(f => f.id !== id && f.parentId !== id));
      setProjFolderMap(prev => {
        const n = { ...prev };
        Object.keys(n).forEach(pid => { n[pid] = n[pid].filter(fid => fid !== id); });
        return n;
      });
      pushUndo({
        label: `폴더 "${snapshot.name}" 삭제`,
        undo: async () => {
          // 폴더 재생성
          const re = await folderApi.create({ name: snapshot.name, parentId: snapshot.parentId ?? undefined });
          const newId = re.id;
          setFolders(prev => [...prev, { id: newId, name: snapshot.name, parentId: snapshot.parentId }]);
          // 프로젝트 매핑 복원
          for (const mp of mappedProjects) {
            await folderApi.addProject(newId, mp.projectId);
          }
          await loadFolders();
        },
        redo: async () => {
          // 현재 폴더 목록에서 해당 이름 찾아 삭제
          const cur = folders.find(f => f.name === snapshot.name);
          if (cur) {
            await folderApi.remove(cur.id);
            await loadFolders();
          }
        },
      });
    } catch { loadFolders(); }
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

  const confirmPicker = async () => {
    if (!pickerFolderId) return;
    const fid = pickerFolderId;
    const folderName = folders.find(f => f.id === fid)?.name ?? fid;
    const promises: Promise<any>[] = [];
    const newMap = { ...projFolderMap };
    const added: string[] = [];
    const removed: string[] = [];

    projects.forEach(p => {
      const current = newMap[p.id] ?? [];
      const hasFolder = current.includes(fid);
      const shouldHave = pickerSelected.has(p.id);
      if (shouldHave && !hasFolder) {
        newMap[p.id] = [...current, fid];
        promises.push(folderApi.addProject(fid, p.id));
        added.push(p.id);
      }
      if (!shouldHave && hasFolder) {
        newMap[p.id] = current.filter(f => f !== fid);
        promises.push(folderApi.removeProject(fid, p.id));
        removed.push(p.id);
      }
    });

    setProjFolderMap(newMap);
    setOpenFolders(prev => { const n = { ...prev, [fid]: true }; lsSet(LS_FOLDER_OPEN, n); return n; });
    setPickerFolderId(null);

    try {
      await Promise.all(promises);
      if (added.length || removed.length) {
        pushUndo({
          label: `"${folderName}" 프로젝트 변경 (${added.length}추가, ${removed.length}제거)`,
          undo: async () => {
            const ops: Promise<any>[] = [];
            added.forEach(pid => ops.push(folderApi.removeProject(fid, pid)));
            removed.forEach(pid => ops.push(folderApi.addProject(fid, pid)));
            await Promise.all(ops);
            await loadFolders();
          },
          redo: async () => {
            const ops: Promise<any>[] = [];
            added.forEach(pid => ops.push(folderApi.addProject(fid, pid)));
            removed.forEach(pid => ops.push(folderApi.removeProject(fid, pid)));
            await Promise.all(ops);
            await loadFolders();
          },
        });
      }
    } catch { loadFolders(); }
  };

  // Remove project from a specific folder
  const removeFromFolder = async (projectId: string, folderId: string, skipUndo = false) => {
    setProjFolderMap(prev => {
      const current = prev[projectId] ?? [];
      return { ...prev, [projectId]: current.filter(fid => fid !== folderId) };
    });
    try {
      await folderApi.removeProject(folderId, projectId);
      if (!skipUndo) {
        const projName = projects.find(p => p.id === projectId)?.name ?? projectId;
        const folderName = folders.find(f => f.id === folderId)?.name ?? folderId;
        pushUndo({
          label: `"${projName}" → "${folderName}" 제거`,
          undo: async () => {
            await folderApi.addProject(folderId, projectId);
            setProjFolderMap(prev => ({ ...prev, [projectId]: [...(prev[projectId] ?? []), folderId] }));
          },
          redo: async () => {
            await folderApi.removeProject(folderId, projectId);
            setProjFolderMap(prev => ({
              ...prev,
              [projectId]: (prev[projectId] ?? []).filter(fid => fid !== folderId),
            }));
          },
        });
      }
    } catch { loadFolders(); }
  };

  // Drag & drop
  // 드래그 중 자동 스크롤 — 목록은 내부 박스(tableBoxRef)가 스크롤됨
  const { start: startAutoScroll, stop: stopAutoScroll } = useDragAutoScroll({ getContainer: () => tableBoxRef.current });
  const clearDrag = () => { setDragging(null); setDropTarget(null); setDropGap(null); setProjGap(null); stopAutoScroll(); };

  const onDragStart = (type: "project" | "folder", id: string, fromFolderId?: string) => {
    setDragging({ type, id, fromFolderId });
    startAutoScroll();
  };

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

  const onFolderDrop = async (e: React.DragEvent, folder: Folder) => {
    e.preventDefault(); e.stopPropagation();
    if (!dragging) { clearDrag(); return; }

    if (dragging.type === "project") {
      const pid = dragging.id;
      const current = projFolderMap[pid] ?? [];
      if (!current.includes(folder.id)) {
        setProjFolderMap(prev => ({ ...prev, [pid]: [...(prev[pid] ?? []), folder.id] }));
        folderApi.addProject(folder.id, pid).catch(() => loadFolders());
        const projName = projects.find(p => p.id === pid)?.name ?? pid;
        pushUndo({
          label: `"${projName}" → "${folder.name}" 추가`,
          undo: async () => {
            await folderApi.removeProject(folder.id, pid);
            setProjFolderMap(prev => ({ ...prev, [pid]: (prev[pid] ?? []).filter(fid => fid !== folder.id) }));
          },
          redo: async () => {
            await folderApi.addProject(folder.id, pid);
            setProjFolderMap(prev => ({ ...prev, [pid]: [...(prev[pid] ?? []), folder.id] }));
          },
        });
      }
    } else if (dragging.type === "folder" && dragging.id !== folder.id) {
      if (dropGap) {
        if (isDesc(dragging.id, folder.id)) { clearDrag(); return; }
        const without = folders.filter(f => f.id !== dragging.id);
        const targetIdx = without.findIndex(f => f.id === dropGap.id);
        const insertIdx = dropGap.pos === "before" ? targetIdx : targetIdx + 1;
        const moved = { ...folders.find(f => f.id === dragging.id)!, parentId: folder.parentId };
        without.splice(insertIdx, 0, moved);
        setFolders(without);
        // Update parent + reorder via API
        folderApi.update(dragging.id, { parentId: folder.parentId ?? "" }).catch(() => loadFolders());
        const siblings = without.filter(f => f.parentId === folder.parentId).map(f => f.id);
        folderApi.reorderFolders(siblings).catch(() => {});
      } else {
        if (!isDesc(dragging.id, folder.id)) {
          const oldParentId = folders.find(f => f.id === dragging.id)?.parentId ?? null;
          const movedId = dragging.id;
          const movedName = folders.find(f => f.id === movedId)?.name ?? movedId;
          setFolders(prev => prev.map(f => f.id === movedId ? { ...f, parentId: folder.id } : f));
          folderApi.update(movedId, { parentId: folder.id }).catch(() => loadFolders());
          pushUndo({
            label: `폴더 "${movedName}" 이동`,
            undo: async () => {
              await folderApi.update(movedId, { parentId: oldParentId ?? "" });
              setFolders(prev => prev.map(f => f.id === movedId ? { ...f, parentId: oldParentId } : f));
            },
            redo: async () => {
              await folderApi.update(movedId, { parentId: folder.id });
              setFolders(prev => prev.map(f => f.id === movedId ? { ...f, parentId: folder.id } : f));
            },
          });
        }
      }
    }
    dropHandledRef.current = true;
    clearDrag();
  };

  const onRootDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (!dragging) { clearDrag(); return; }
    if (dragging.type === "project") {
      if (dragging.fromFolderId) {
        removeFromFolder(dragging.id, dragging.fromFolderId);
      }
    } else {
      setFolders(prev => prev.map(f => f.id === dragging.id ? { ...f, parentId: null } : f));
      folderApi.update(dragging.id, { parentId: "" }).catch(() => loadFolders()); // empty string → null in backend
    }
    dropHandledRef.current = true;
    clearDrag();
  };

  const onDragEnd = () => {
    // 드롭이 처리되지 않은 경우(영역 밖으로 드래그) → 출발 폴더에서만 제거
    if (!dropHandledRef.current && dragging?.type === "project" && dragging.fromFolderId) {
      removeFromFolder(dragging.id, dragging.fromFolderId);
    }
    dropHandledRef.current = false;
    clearDrag();
  };

  // 폴더 내 프로젝트 순서 드래그
  const getOrderedChildProjects = (folderId: string): Project[] => {
    const inFolder = filteredProjects.filter(p => (projFolderMap[p.id] ?? []).includes(folderId));
    const order = folderProjOrder[folderId];
    if (!order?.length) return inFolder;
    const idSet = new Set(inFolder.map(p => p.id));
    return [
      ...order.filter(id => idSet.has(id)).map(id => inFolder.find(p => p.id === id)!),
      ...inFolder.filter(p => !order.includes(p.id)),
    ];
  };

  const onProjRowDragOver = (e: React.DragEvent, targetProjId: string, folderId: string) => {
    e.preventDefault(); e.stopPropagation();
    if (dragging?.type !== "project") return;
    setDropTarget(null); setDropGap(null);
    const rect = e.currentTarget.getBoundingClientRect();
    const pos: "before" | "after" = (e.clientY - rect.top) / rect.height < 0.5 ? "before" : "after";
    setProjGap({ folderId, refId: targetProjId, pos });
  };

  const onProjRowDrop = (e: React.DragEvent, folderId: string) => {
    e.preventDefault(); e.stopPropagation();
    if (!dragging || dragging.type !== "project" || !projGap) { clearDrag(); return; }

    const ordered = getOrderedChildProjects(folderId).map(p => p.id);
    const srcIdx  = ordered.indexOf(dragging.id);
    const refIdx  = ordered.indexOf(projGap.refId);
    if (srcIdx === -1 || refIdx === -1 || srcIdx === refIdx) { clearDrag(); return; }

    const newOrder = ordered.filter(id => id !== dragging.id);
    const adjustedRef = newOrder.indexOf(projGap.refId);
    const insertIdx = projGap.pos === "before" ? adjustedRef : adjustedRef + 1;
    newOrder.splice(Math.max(0, insertIdx), 0, dragging.id);

    setFolderProjOrder(prev => ({ ...prev, [folderId]: newOrder }));
    folderApi.reorderProjects(folderId, newOrder).catch(() => loadFolders());
    dropHandledRef.current = true;
    clearDrag();
  };

  // ─── Row renderers ───────────────────────────────────────────────────────────

  const renderProject = (p: Project, depth: number, folderId?: string) => {
    const st = STATUS_CFG[p.status] ?? STATUS_CFG.PLANNING;
    const prog = p.overallProgress ?? null;
    const isDragging = dragging?.type === "project" && dragging.id === p.id;
    const ownerDisplay = p.ownerName || "—";
    const showGapBefore = folderId && projGap?.folderId === folderId && projGap.refId === p.id && projGap.pos === "before";
    const showGapAfter  = folderId && projGap?.folderId === folderId && projGap.refId === p.id && projGap.pos === "after";

    return (
      <div key={folderId ? `${p.id}__${folderId}` : p.id}>
        {showGapBefore && <div className="h-0.5 bg-blue-500 rounded mx-3 -mb-px relative z-10" />}
        <div
          className={clsx(
            "flex items-center border-b border-gray-100 group/row cursor-pointer transition-colors",
            isDragging ? "opacity-30" : "hover:bg-blue-50/40 dark:hover:bg-blue-500/10",
          )}
          style={{ height: ROW_H }}
          draggable={folderId !== FAVORITES_FOLDER_ID}
          onDragStart={() => onDragStart("project", p.id, folderId)}
          onDragEnd={onDragEnd}
          onDragOver={folderId && folderId !== FAVORITES_FOLDER_ID ? (e) => onProjRowDragOver(e, p.id, folderId) : undefined}
          onDrop={folderId && folderId !== FAVORITES_FOLDER_ID ? (e) => onProjRowDrop(e, folderId) : undefined}
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
          {/* 즐겨찾기 토글 — 즐겨찾기 시 항상 표시, 아니면 hover 시 표시 */}
          <button
            onClick={e => { e.stopPropagation(); handleToggleFavorite(p.id); }}
            className={clsx(
              "ml-1 w-5 h-5 flex items-center justify-center rounded shrink-0 transition-all text-sm leading-none",
              isFavorite(p.id)
                ? "text-yellow-400 hover:text-yellow-500"
                : "text-gray-300 hover:text-yellow-400 opacity-0 group-hover/row:opacity-100",
            )}
            title={isFavorite(p.id) ? "즐겨찾기 해제" : "즐겨찾기 추가"}
          >
            {isFavorite(p.id) ? "★" : "☆"}
          </button>
          {/* 프로젝트 요약 버튼 — 항상 표시, 진한 파랑 */}
          <button
            onClick={e => { e.stopPropagation(); setSummaryId(p.id); }}
            className="ml-1.5 px-1.5 h-5 flex items-center justify-center rounded border border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-300 bg-blue-50 hover:bg-blue-100 dark:hover:bg-blue-900 hover:border-blue-300 shrink-0 transition-colors text-[11px] font-medium"
            title="프로젝트 요약 보기"
          >
            요약
          </button>
          {/* 폴더에서 제거 버튼 (실제 폴더만 — 즐겨찾기는 ★로 해제) */}
          {folderId && folderId !== FAVORITES_FOLDER_ID && (
            <button
              onClick={e => { e.stopPropagation(); removeFromFolder(p.id, folderId); }}
              className="opacity-0 group-hover/row:opacity-100 ml-1 w-4 h-4 flex items-center justify-center rounded text-gray-300 hover:text-red-400 hover:bg-red-50 shrink-0 transition-all"
              title="이 폴더에서 제거"
            >
              ×
            </button>
          )}
        </div>
        {/* Owner — 클릭 시 드롭다운 (portal 렌더) */}
        <div className="w-[100px] shrink-0 px-2" onClick={e => e.stopPropagation()}>
          <button
            className="w-full text-center text-xs text-gray-500 truncate hover:text-blue-600 hover:bg-blue-50 rounded px-1 py-0.5 transition-colors"
            onClick={(e) => {
              if (ownerEditId === p.id) {
                setOwnerEditId(null);
                setOwnerDropPos(null);
              } else {
                const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                setOwnerDropPos({ top: rect.bottom + 4, left: rect.left });
                setOwnerEditId(p.id);
                setOwnerSearch("");
              }
            }}
            title="클릭해서 소유자 변경"
          >
            {ownerDisplay}
          </button>
        </div>
        {/* Progress */}
        <div className="w-[100px] shrink-0 flex items-center justify-center gap-1.5 px-2">
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
        <div className="w-[96px] shrink-0 px-2 text-xs text-gray-400 text-center">{fmtDate(p.effectiveStartDate)}</div>
        {/* End */}
        <div className="w-[96px] shrink-0 px-2 text-xs text-gray-400 text-center">{fmtDate(p.effectiveEndDate)}</div>
        {/* Status */}
        <div className="w-[80px] shrink-0 px-2 flex items-center justify-center gap-1">
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
        {showGapAfter && <div className="h-0.5 bg-blue-500 rounded mx-3 -mt-px relative z-10" />}
      </div>
    );
  };

  const renderFolder = (folder: Folder, depth: number): React.ReactNode => {
    const isOpen       = openFolders[folder.id] !== false;
    const isDept       = !!folder.departmentId; // 부서 기본 폴더 — 이름·삭제 잠금(자동 동기화)
    const isDropping   = dropTarget === folder.id;
    const childFolders  = folders.filter(f => f.parentId === folder.id);
    const childProjects = getOrderedChildProjects(folder.id);
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
            isDropping ? "bg-blue-50 outline outline-1 outline-blue-300 outline-offset-[-1px]" : "hover:bg-gray-50/60 dark:hover:bg-gray-500/10",
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
                const newName = renameVal.trim();
                if (newName && newName !== folder.name) {
                  const oldName = folder.name;
                  const fid = folder.id;
                  setFolders(prev => prev.map(f => f.id === fid ? { ...f, name: newName } : f));
                  folderApi.update(fid, { name: newName }).catch(() => loadFolders());
                  pushUndo({
                    label: `"${oldName}" → "${newName}" 이름 변경`,
                    undo: async () => {
                      await folderApi.update(fid, { name: oldName });
                      setFolders(prev => prev.map(f => f.id === fid ? { ...f, name: oldName } : f));
                    },
                    redo: async () => {
                      await folderApi.update(fid, { name: newName });
                      setFolders(prev => prev.map(f => f.id === fid ? { ...f, name: newName } : f));
                    },
                  });
                }
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
              className="text-[13px] font-semibold text-gray-700 flex items-center gap-1.5 flex-1 truncate leading-none cursor-pointer hover:text-blue-600"
              onClick={e => { e.stopPropagation(); openPicker(folder.id); }}
              onDoubleClick={e => { if (isDept) return; e.stopPropagation(); setRenamingId(folder.id); setRenameVal(folder.name); }}
              title={isDept ? "부서 기본 폴더 — 클릭: 타 부서 프로젝트 추가" : "클릭: 프로젝트 추가 / 더블클릭: 이름 변경"}
            >
              <span className="truncate">{folder.name}</span>
              {isDept && (
                <span className="text-[10px] font-medium bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded-full shrink-0" title="부서 기본 폴더 (자동 구성)">부서</span>
              )}
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
            {!isDept && (
              <>
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
              </>
            )}
          </div>
        </div>

        {/* 갭 인디케이터 — after */}
        {dropGap?.id === folder.id && dropGap.pos === "after" && (
          <div className="h-0.5 bg-blue-500 rounded mx-3 -mt-px relative z-10" />
        )}

        {/* Children */}
        {isOpen && (
          <div
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDropTarget(folder.id); setDropGap(null); }}
            onDrop={(e) => onFolderDrop(e, folder)}
          >
            {childFolders.map(cf => renderFolder(cf, depth + 1))}
            {childProjects.map(p => renderProject(p, depth + 1, folder.id))}
            {childFolders.length === 0 && childProjects.length === 0 && (
              <div className="h-8 flex items-center text-xs text-gray-300 italic" style={{ paddingLeft: 28 + (depth + 1) * 18 }}>
                드래그하여 프로젝트 추가
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // ─── Filtered & tree ─────────────────────────────────────────────────────────

  const filteredProjects = search
    ? projects.filter(p => p.name.toLowerCase().includes(search.toLowerCase()))
    : projects;

  const displayTotal = search ? filteredProjects.length : total;

  const rootFolders  = folders.filter(f => f.parentId === null);
  // 복제 개념: 폴더에 넣어도 루트에는 그대로 유지 (한 프로젝트가 루트 + 여러 폴더에 동시 존재)
  // 루트(폴더 밖)에 표시되는 프로젝트만 이름 오름차순 자동정렬. 폴더 내부는 수동 순서 유지(getOrderedChildProjects).
  const rootProjects = [...filteredProjects].sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const isRootDrop   = dropTarget === "root" && dragging !== null;

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-4">

        {/* Toolbar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900">프로젝트</h1>
            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{displayTotal}</span>
            {/* Undo / Redo */}
            <div className="ml-2">
              <UndoRedoControls undoCount={undoCount} redoCount={redoCount} undoLabel={undoLabel} redoLabel={redoLabel} toast={null} onUndo={handleUndo} onRedo={handleRedo} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="프로젝트 검색..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={undefined}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-44"
            />
            {isManager && (
              <button
                onClick={() => {
                  setSaveTplProjectId(""); setSaveTplName(""); setSaveTplCategory(""); setSaveTplIncludeAssignments(false); setSaveTplError(""); setShowSaveTemplate(true);
                  templateApi.list().then((l: any[]) => {
                    setTplNames(Array.from(new Set(l.map((t) => t.name).filter(Boolean))));
                    setTplCategories(Array.from(new Set(l.map((t) => t.category).filter(Boolean))));
                  }).catch(() => {});
                }}
                className="px-3 py-1.5 border border-orange-300 dark:border-orange-700 text-orange-700 dark:text-orange-400 rounded-lg text-sm hover:bg-orange-50 dark:hover:bg-orange-950 flex items-center gap-1.5 transition-colors"
                title="기존 프로젝트를 템플릿으로 저장"
              >
                <span>💾</span> 템플릿저장
              </button>
            )}
            {isManager && (
              <button
                onClick={() => setShowTemplateManager(true)}
                className="px-3 py-1.5 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50 flex items-center gap-1.5 transition-colors"
                title="템플릿 수정/삭제"
              >
                <span>⚙️</span> 템플릿관리
              </button>
            )}
            <button
              onClick={() => { setNewFolderParent(null); setShowNewFolder(true); }}
              className="px-3 py-1.5 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50 flex items-center gap-1.5 transition-colors"
            >
              <span>📁</span> 새폴더
            </button>
            {isOperator && (
              <button
                onClick={() => setShowCreate(true)}
                className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors flex items-center gap-1.5"
              >
                + 새 프로젝트
              </button>
            )}
          </div>
        </div>

        {/* Tree table */}
        <div ref={tableBoxRef} className="bg-white rounded-xl border border-gray-200 overflow-auto" style={{ maxHeight: tableMaxH }}>
          {/* Column headers */}
          <div
            className="sticky top-0 z-10 flex items-center border-b border-gray-200 bg-gray-50 text-[11px] font-semibold text-gray-400 uppercase tracking-wider"
            style={{ height: 30 }}
          >
            <div className="flex-1 pl-4">프로젝트명</div>
            <div className="w-[100px] shrink-0 px-2 text-center">소유자</div>
            <div className="w-[100px] shrink-0 px-2 text-center">진도율</div>
            <div className="w-[96px] shrink-0 px-2 text-center">시작일</div>
            <div className="w-[96px] shrink-0 px-2 text-center">종료일</div>
            <div className="w-[80px] shrink-0 px-2 text-center">상태</div>
            {/* 행의 삭제 버튼(Actions) 컬럼과 정렬 맞춤 */}
            <div className="w-[36px] shrink-0" />
          </div>

          {/* Body */}
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full" />
            </div>
          ) : (
            <div
              className={clsx("min-h-[160px] transition-colors", isRootDrop && "bg-blue-50/30 dark:bg-blue-500/10")}
              onDragOver={e => { e.preventDefault(); setDropTarget("root"); setDropGap(null); }}
              onDrop={onRootDrop}
            >
              {/* ⭐ 내 즐겨찾기 — 사용자별 프라이빗 (내 계정에서만 보임) */}
              {(() => {
                const favProjects = favoriteIds
                  .map((id) => filteredProjects.find((p) => p.id === id))
                  .filter((p): p is Project => !!p);
                const open = openFolders[FAVORITES_FOLDER_ID] !== false;
                return (
                  <div>
                    <div
                      className="flex items-center border-b border-gray-100 cursor-pointer hover:bg-yellow-50/50 select-none"
                      style={{ height: ROW_H }}
                      onClick={() => toggleOpen(FAVORITES_FOLDER_ID)}
                    >
                      <div className="flex-1 min-w-0 flex items-center gap-1.5" style={{ paddingLeft: 10 }}>
                        <span className="text-gray-400 shrink-0 text-xs w-3">{open ? "▼" : "▶"}</span>
                        <span className="shrink-0">⭐</span>
                        <span className="text-[13px] font-semibold text-gray-700 truncate">내 즐겨찾기</span>
                        <span className="text-[11px] text-gray-400 bg-gray-100 px-1.5 rounded-full shrink-0">{favProjects.length}</span>
                        <span className="text-[10px] text-gray-300 shrink-0">나만 보임</span>
                      </div>
                    </div>
                    {open && (favProjects.length > 0
                      ? favProjects.map((p) => renderProject(p, 1, FAVORITES_FOLDER_ID))
                      : <div className="text-[12px] text-gray-400 py-2" style={{ paddingLeft: 40 }}>프로젝트의 ☆ 아이콘을 눌러 즐겨찾기에 추가하세요.</div>
                    )}
                  </div>
                );
              })()}

              {rootFolders.map(f => renderFolder(f, 0))}
              {rootProjects.map(p => renderProject(p, 0))}

              {rootFolders.length === 0 && rootProjects.length === 0 && (
                <div className="text-center py-14 text-gray-400 text-sm">
                  프로젝트가 없습니다.{" "}
                  <button onClick={() => setShowCreate(true)} className="text-blue-600 dark:text-blue-400 hover:underline">
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
            {dragging.type === "project" && dragging.fromFolderId
              ? "폴더 영역 밖으로 드래그하면 해당 폴더에서만 제거"
              : dragging.type === "project"
              ? "폴더 위에 놓으면 추가"
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
        const filtered = projects
          .filter(p => !pickerSearch || p.name.toLowerCase().includes(pickerSearch.toLowerCase()))
          .sort((a, b) => a.name.localeCompare(b.name, "ko"));
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
                  <span className="ml-auto text-[11px] text-blue-600 dark:text-blue-400 font-medium">{pickerSelected.size}개 선택됨</span>
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
                          "flex items-center gap-3 px-5 cursor-pointer hover:bg-blue-50/50 dark:hover:bg-blue-500/10 transition-colors border-b border-gray-50",
                          checked && "bg-blue-50/30 dark:bg-blue-500/10"
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
            {/* 템플릿으로 만들기 옵션 */}
            <div className="px-6 pt-4">
              <button
                type="button"
                onClick={() => { setShowCreate(false); setShowTemplateWizard(true); }}
                className="w-full flex items-center justify-between gap-2 px-4 py-2.5 border border-green-300 bg-green-50 text-green-700 rounded-lg text-sm font-medium hover:bg-green-100 transition-colors"
              >
                <span>📋 템플릿으로 만들기</span>
                <span className="text-green-500">→</span>
              </button>
              <div className="flex items-center gap-2 my-3">
                <div className="flex-1 h-px bg-gray-200" />
                <span className="text-xs text-gray-400">또는 빈 프로젝트</span>
                <div className="flex-1 h-px bg-gray-200" />
              </div>
            </div>
            <form onSubmit={handleCreate} className="px-6 pb-6 space-y-4">
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

      {/* ── Owner 드롭다운 (portal — overflow-hidden 컨테이너 밖에서 렌더) ── */}
      {ownerEditId && ownerDropPos && typeof document !== "undefined" && createPortal(
        <div
          ref={ownerDropRef}
          style={{ position: "fixed", top: ownerDropPos.top, left: ownerDropPos.left }}
          className="z-[9999] bg-white border border-gray-200 rounded-xl shadow-lg w-56 overflow-hidden"
        >
          <div className="p-2 border-b border-gray-100">
            <input
              autoFocus
              type="text"
              placeholder="이름 검색..."
              value={ownerSearch}
              onChange={e => setOwnerSearch(e.target.value)}
              autoComplete="off"
              className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              onClick={e => e.stopPropagation()}
            />
          </div>
          <ul className="max-h-48 overflow-y-auto py-1">
            {(() => {
              const editingProject = projects.find(p => p.id === ownerEditId);
              const filtered = allEmployees.filter(u => !ownerSearch || u.name.includes(ownerSearch));
              return filtered.length === 0
                ? <li className="px-3 py-2 text-sm text-gray-400 text-center">검색 결과 없음</li>
                : filtered.map(u => (
                    <li key={u.id}>
                      <button
                        className={clsx(
                          "w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 transition-colors",
                          u.id === editingProject?.ownerId ? "font-semibold text-blue-600 dark:text-blue-400" : "text-gray-700"
                        )}
                        onClick={() => handleOwnerChange(ownerEditId, u.id, u.name)}
                      >
                        {u.name}
                      </button>
                    </li>
                  ));
            })()}
          </ul>
        </div>,
        document.body
      )}
      {/* ── Undo/Redo toast ────────────────────────────────────────────── */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] bg-gray-900 text-white text-sm px-4 py-2 rounded-lg shadow-lg">
          {toast}
        </div>
      )}

      {/* 프로젝트 요약 드로어 */}
      {summaryId && (
        <ProjectSummaryDrawer
          projectId={summaryId}
          onRename={async (name) => { await projectApi.update(summaryId, { name }); await load(); }}
          onClose={() => setSummaryId(null)}
        />
      )}

      {/* 새 프로젝트 - 템플릿으로 만들기 */}
      {showTemplateWizard && (
        <TemplateWizard projectId="" onClose={() => setShowTemplateWizard(false)} onSuccess={() => { setShowTemplateWizard(false); load(); }} />
      )}

      {/* 템플릿 관리 */}
      {showTemplateManager && <TemplateManagerModal onClose={() => setShowTemplateManager(false)} />}

      {/* 템플릿 저장 모달 (기존 프로젝트 선택 → 템플릿) */}
      {showSaveTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowSaveTemplate(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">템플릿 저장</h2>
                <p className="text-xs text-gray-500 mt-0.5">기존 프로젝트 구조를 템플릿으로 저장합니다</p>
              </div>
              <button onClick={() => setShowSaveTemplate(false)} className="text-gray-400 hover:text-gray-600 text-xl font-light">×</button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">원본 프로젝트 <span className="text-red-500">*</span></label>
                <select
                  value={saveTplProjectId}
                  onChange={e => setSaveTplProjectId(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white"
                >
                  <option value="">프로젝트 선택...</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">템플릿 이름 <span className="text-red-500">*</span></label>
                <input type="text" value={saveTplName} onChange={e => setSaveTplName(e.target.value)}
                  list="save-tpl-names" autoComplete="off"
                  placeholder="템플릿 이름 입력 (기존 이름 검색)"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-500" />
                <datalist id="save-tpl-names">{tplNames.map(n => <option key={n} value={n} />)}</datalist>
                {saveTplName.trim() && tplNames.some(n => n.toLowerCase() === saveTplName.trim().toLowerCase()) && (
                  <p className="text-[11px] text-red-500 dark:text-red-400 mt-1">이미 존재하는 이름입니다.</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">카테고리 <span className="text-red-500">*</span></label>
                <input type="text" value={saveTplCategory} onChange={e => setSaveTplCategory(e.target.value)}
                  list="save-tpl-categories" autoComplete="off"
                  placeholder="예: 건설, IT, 제조 (기존 카테고리 검색)"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-500" />
                <datalist id="save-tpl-categories">{tplCategories.map(c => <option key={c} value={c} />)}</datalist>
              </div>
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input type="checkbox" checked={saveTplIncludeAssignments} onChange={e => setSaveTplIncludeAssignments(e.target.checked)}
                  className="w-4 h-4 rounded accent-orange-500" />
                <span className="text-sm text-gray-700">자원 배정 포함</span>
              </label>
              {saveTplError && <p className="text-sm text-red-500 dark:text-red-400">{saveTplError}</p>}
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100 bg-gray-50">
              <button onClick={() => setShowSaveTemplate(false)} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-100">취소</button>
              <button
                disabled={saveTplLoading}
                onClick={async () => {
                  if (!saveTplProjectId) { setSaveTplError("원본 프로젝트를 선택해주세요."); return; }
                  if (!saveTplName.trim()) { setSaveTplError("템플릿 이름을 입력해주세요."); return; }
                  if (!saveTplCategory.trim()) { setSaveTplError("카테고리를 입력해주세요."); return; }
                  setSaveTplLoading(true); setSaveTplError("");
                  try {
                    await templateApi.saveAsTemplate(saveTplProjectId, {
                      name: saveTplName.trim(),
                      category: saveTplCategory.trim(),
                      includeAssignments: saveTplIncludeAssignments,
                    });
                    setShowSaveTemplate(false);
                    alert("템플릿으로 저장되었습니다.");
                  } catch (e: any) {
                    setSaveTplError(e.message ?? "저장 실패");
                  } finally {
                    setSaveTplLoading(false);
                  }
                }}
                className="px-4 py-2 text-sm bg-orange-600 text-white rounded-lg font-medium hover:bg-orange-700 disabled:opacity-50"
              >
                {saveTplLoading ? "저장 중..." : "템플릿 저장"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
