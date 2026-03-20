"use client";

import { Fragment, useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { resourceApi, resourceGroupApi, taskApi, userManagementApi, getUser } from "@/lib/api";
import AppLayout from "@/components/AppLayout";

const TYPE_LABELS: Record<string, string> = {
  PERSON: "👤 인력",
  EQUIPMENT: "🔧 장비",
  VEHICLE: "🚗 차량",
  FACILITY: "🏭 시설",
};

function todayStr() { return new Date().toISOString().slice(0, 10); }
function addMonths(date: string, n: number) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
}
function toDateStr(d: Date) { return d.toISOString().slice(0, 10); }
function weekRange(offsetWeeks: number): { start: string; end: string } {
  const today = new Date();
  const dow = today.getDay(); // 0=일,1=월,...,6=토
  const diffToMon = (dow === 0 ? -6 : 1 - dow); // 이번주 월요일까지 차이
  const mon = new Date(today);
  mon.setDate(today.getDate() + diffToMon + offsetWeeks * 7);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return { start: toDateStr(mon), end: toDateStr(sun) };
}

const TAB_KEY = "erp_tab_resources";
const EXPANDED_KEY = "erp_expanded_resources";
const DASH_DATE_KEY = "erp_dash_date_resources";
const DASH_EXPANDED_KEY = "erp_dash_expanded_resources";

// ─── 타입 ─────────────────────────────────────────────────────────────────────

interface Group {
  id: string;
  name: string;
  description?: string | null;
  parentId: string | null;
  sortOrder: number;
  resourceIds: string[];
  children?: Group[];
  isDept?: boolean;  // 부서 그룹 (admin에서 생성, 수정 불가)
  isProtected?: boolean; // 삭제/수정 불가 보호 그룹
}

interface Resource {
  id: string;
  name: string;
  type: string;
  userId?: string | null;
  dailyCapacityHours: number;
  isActive: boolean;
}

interface DropIndicator {
  targetId: string;
  position: "before" | "after";
}

interface DragHandlers {
  dragState: { type: "resource" | "group"; id: string } | null;
  dragOverGroupId: string | null;       // 자원 드래그 시 그룹 강조
  dropIndicator: DropIndicator | null;  // 그룹 드래그 시 삽입 위치선
  onDragStartResource: (id: string) => void;
  onDragStartGroup: (id: string, e: React.DragEvent) => void;
  onDragOverGroup: (groupId: string, e: React.DragEvent) => void;
  onDragLeaveGroup: () => void;
  onDropOnGroup: (groupId: string) => void;
  onDragEnd: () => void;
}

// ─── 트리 빌더 ────────────────────────────────────────────────────────────────

function groupSortKey(g: Group): number {
  if (g.name === "전체" || g.description === "__all__") return 0;
  if (g.isDept) return 1;
  return 2;
}

function buildTree(groups: Group[]): Group[] {
  const map = new Map<string, Group>();
  groups.forEach((g) => map.set(g.id, { ...g, children: [] }));
  const roots: Group[] = [];
  map.forEach((g) => {
    if (g.parentId && map.has(g.parentId)) map.get(g.parentId)!.children!.push(g);
    else roots.push(g);
  });
  const sort = (arr: Group[]) =>
    arr.sort((a, b) => groupSortKey(a) - groupSortKey(b) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  map.forEach((g) => sort(g.children!));
  return sort(roots);
}

// ─── 삽입 위치 표시선 ─────────────────────────────────────────────────────────

function DropLine() {
  return (
    <div className="relative h-0.5 bg-blue-500 rounded-full mx-1 my-0.5 z-10">
      <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-blue-500" />
      <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-2.5 h-2.5 rounded-full bg-blue-500" />
    </div>
  );
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────

export default function ResourcesPage() {
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState(false);
  const [tab, setTab] = useState<"list" | "dashboard">("list");
  const handleTabChange = (t: "list" | "dashboard") => {
    setTab(t); sessionStorage.setItem(TAB_KEY, t);
  };

  const [groups, setGroups] = useState<Group[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const saved = sessionStorage.getItem(EXPANDED_KEY);
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });

  // ─── 드래그 상태 ───────────────────────────────────────────────────────────
  const [dragState, setDragState] = useState<{ type: "resource" | "group"; id: string } | null>(null);
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null);

  // 모달 상태
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [memberSearch, setMemberSearch] = useState("");
  const [savingMembers, setSavingMembers] = useState(false);

  const [showCreateResource, setShowCreateResource] = useState(false);
  const [resourceForm, setResourceForm] = useState({ name: "", type: "EQUIPMENT", dailyCapacityHours: 8 });
  const [savingResource, setSavingResource] = useState(false);

  const [groupModal, setGroupModal] = useState<{ mode: "create" | "rename"; group?: Group } | null>(null);
  const [groupForm, setGroupForm] = useState({ name: "", description: "", parentId: "" });
  const [savingGroup, setSavingGroup] = useState(false);

  // 계정 연결 모달
  const [userIdModal, setUserIdModal] = useState<Resource | null>(null);
  const [userIdInput, setUserIdInput] = useState("");
  const [savingUserId, setSavingUserId] = useState(false);

  // Dashboard
  const [startDate, setStartDate] = useState<string>(() => {
    if (typeof window !== "undefined") {
      try { const s = JSON.parse(sessionStorage.getItem(DASH_DATE_KEY) ?? "null"); if (s?.startDate) return s.startDate; } catch {}
    }
    return addMonths(todayStr(), -1);
  });
  const [endDate, setEndDate] = useState<string>(() => {
    if (typeof window !== "undefined") {
      try { const s = JSON.parse(sessionStorage.getItem(DASH_DATE_KEY) ?? "null"); if (s?.endDate) return s.endDate; } catch {}
    }
    return addMonths(todayStr(), 2);
  });
  const [dashboard, setDashboard] = useState<any[]>([]);
  const [dashLoading, setDashLoading] = useState(false);
  const [expandedResources, setExpandedResources] = useState<Set<string>>(() => {
    if (typeof window !== "undefined") {
      try { const s = JSON.parse(sessionStorage.getItem(DASH_EXPANDED_KEY) ?? "null"); if (Array.isArray(s)) return new Set<string>(s); } catch {}
    }
    return new Set<string>();
  });
  const [dashDeptExpanded, setDashDeptExpanded] = useState<Set<string>>(new Set());
  const toggleDashDept = (id: string) =>
    setDashDeptExpanded((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });

  const [editingAlloc, setEditingAlloc] = useState<{
    segmentId: string; resourceId: string;
    projectId: string; taskId: string;
    mode: string; value: number;
  } | null>(null);
  const [savingAlloc, setSavingAlloc] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("erp_token");
    if (!token) { router.push("/login"); return; }
    setIsAdmin(getUser()?.role === "ADMIN");
    const savedTab = sessionStorage.getItem(TAB_KEY) as "list" | "dashboard" | null;
    if (savedTab) setTab(savedTab);
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      // ── 1. 기본 데이터 로드 ────────────────────────────────────────────────
      const [rawGroups, initialResources] = await Promise.all([
        resourceGroupApi.list(),
        resourceApi.list(),
      ]);
      let resources: Resource[] = initialResources as Resource[];
      const groups: Group[] = rawGroups as Group[];

      // ── 2. 유저 + 프로필 로드 (ADMIN 전용, 실패 허용) ─────────────────────
      let users: any[] = [];
      try {
        const usersData = await userManagementApi.list();
        // 배열 또는 { items: [] } 모두 처리
        users = Array.isArray(usersData) ? usersData : ((usersData as any).items ?? []);
      } catch { /* ADMIN 아닌 유저는 빈 배열 사용 */ }

      // ── 3. 유저를 자원으로 자동 등록 ─────────────────────────────────────
      if (users.length > 0) {
        const existingEmails = new Set(resources.map((r) => r.userId).filter(Boolean));
        const newUsers = users.filter((u: any) => u.isActive !== false && !existingEmails.has(u.email));
        if (newUsers.length > 0) {
          for (const u of newUsers) {
            try {
              const created = await resourceApi.create({ name: u.name, type: "PERSON", dailyCapacityHours: 8 });
              await resourceApi.update(created.id, { userId: u.email }).catch(() => {});
            } catch { /* 개별 실패 무시 */ }
          }
          resources = await resourceApi.list();
        }
      }

      // ── 4. 그룹 마킹 ──────────────────────────────────────────────────────
      // isDept: 어떤 유저의 profile.departmentId가 이 그룹을 가리키는 경우
      const deptGroupIds = new Set(
        users.filter((u: any) => u.profile?.departmentId).map((u: any) => u.profile.departmentId)
      );
      const markedGroups: Group[] = groups.map((g) => {
        const isDept = deptGroupIds.has(g.id) || g.description === "__dept__";
        const isProtected = isDept || g.description === "__all__" || g.name === "전체";
        return { ...g, isDept, isProtected };
      });

      // ── 5. "전체" 그룹에 활성 유저 자원 전부 동기화 ─────────────────────
      const allGroup = markedGroups.find((g) => g.name === "전체");
      if (allGroup && users.length > 0) {
        const activeEmails = new Set(
          users.filter((u: any) => u.isActive !== false).map((u: any) => u.email)
        );
        const allUserResourceIds = resources
          .filter((r) => r.userId && activeEmails.has(r.userId))
          .map((r) => r.id);
        const currentIds = [...allGroup.resourceIds].sort().join(",");
        const newIds = [...allUserResourceIds].sort().join(",");
        if (currentIds !== newIds) {
          await resourceGroupApi.setMembers(allGroup.id, allUserResourceIds).catch(() => {});
          allGroup.resourceIds = allUserResourceIds;
        }
      }

      // ── 6. 부서 그룹 구성원 자동 동기화 (ADMIN 전용) ────────────────────
      if (users.length > 0) {
        for (const g of markedGroups.filter((g) => g.isDept)) {
          const deptEmails = new Set(
            users.filter((u: any) => u.profile?.departmentId === g.id).map((u: any) => u.email)
          );
          const deptResourceIds = resources
            .filter((r) => r.userId && deptEmails.has(r.userId))
            .map((r) => r.id);
          const currentIds = [...g.resourceIds].sort().join(",");
          const newIds = [...deptResourceIds].sort().join(",");
          if (currentIds !== newIds) {
            await resourceGroupApi.setMembers(g.id, deptResourceIds).catch(() => {});
            g.resourceIds = deptResourceIds;
          }
        }
      }

      // ── 7. "전체" 그룹 자원을 부서 순서대로 정렬 ─────────────────────────
      if (allGroup) {
        const sortedDeptGroups = markedGroups
          .filter((g) => g.isDept)
          .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
        const sortedIds: string[] = [];
        const addedIds = new Set<string>();
        for (const dg of sortedDeptGroups) {
          for (const id of dg.resourceIds) {
            if (!addedIds.has(id)) { sortedIds.push(id); addedIds.add(id); }
          }
        }
        for (const id of allGroup.resourceIds) {
          if (!addedIds.has(id)) sortedIds.push(id);
        }
        allGroup.resourceIds = sortedIds;
      }

      setGroups(markedGroups);
      setResources(resources);
      setExpanded((prev) => {
        if (prev.size === 0) {
          const all = new Set<string>(markedGroups.map((x: Group) => x.id));
          try { sessionStorage.setItem(EXPANDED_KEY, JSON.stringify([...all])); } catch {}
          return all;
        }
        return prev;
      });
    } catch (e: any) {
      if (e.message !== "Unauthorized") console.error("[resources] load error:", e);
      if (e.message === "Unauthorized") return;
    } finally {
      setLoading(false);
    }
  };

  const applyDate = async (start: string, end: string) => {
    setStartDate(start);
    setEndDate(end);
    try { sessionStorage.setItem(DASH_DATE_KEY, JSON.stringify({ startDate: start, endDate: end })); } catch {}
    setDashLoading(true);
    try { setDashboard(await resourceApi.dashboard(start, end)); }
    catch (e: any) { alert(e.message ?? "대시보드 로드 실패"); }
    finally { setDashLoading(false); }
  };

  const loadDashboard = useCallback(async () => {
    setDashLoading(true);
    try { setDashboard(await resourceApi.dashboard(startDate, endDate)); }
    catch (e: any) { alert(e.message ?? "대시보드 로드 실패"); }
    finally { setDashLoading(false); }
  }, [startDate, endDate]);

  useEffect(() => { if (tab === "dashboard") loadDashboard(); }, [tab, loadDashboard]);

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { sessionStorage.setItem(EXPANDED_KEY, JSON.stringify([...next])); } catch {}
      return next;
    });

  // ─── 드래그 핸들러 ─────────────────────────────────────────────────────────

  const handleDragStartResource = (id: string) => setDragState({ type: "resource", id });

  const handleDragStartGroup = (id: string, e: React.DragEvent) => {
    e.stopPropagation();
    setDragState({ type: "group", id });
  };

  const handleDragOverGroup = (groupId: string, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!dragState) return;

    if (dragState.type === "resource") {
      setDragOverGroupId(groupId);
      setDropIndicator(null);
    } else if (dragState.type === "group") {
      if (dragState.id === groupId) return;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const position: "before" | "after" = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
      setDropIndicator({ targetId: groupId, position });
      setDragOverGroupId(null);
    }
  };

  const handleDragLeaveGroup = () => {
    setDragOverGroupId(null);
    // dropIndicator는 유지 (flickering 방지)
  };

  const handleDropOnGroup = async (targetGroupId: string) => {
    if (!dragState) return;
    const indicator = dropIndicator;
    setDragOverGroupId(null);
    setDropIndicator(null);

    if (dragState.type === "resource") {
      const targetGroup = groups.find((g) => g.id === targetGroupId);
      if (!targetGroup || targetGroup.resourceIds.includes(dragState.id)) {
        setDragState(null); return;
      }
      try {
        await resourceGroupApi.setMembers(targetGroupId, [...targetGroup.resourceIds, dragState.id]);
        await load();
      } catch (e: any) { alert(e.message ?? "추가 실패"); }

    } else if (dragState.type === "group") {
      if (dragState.id === targetGroupId) { setDragState(null); return; }
      const draggedGroup = groups.find((g) => g.id === dragState.id);
      const targetGroup = groups.find((g) => g.id === targetGroupId);
      if (!draggedGroup || !targetGroup || draggedGroup.parentId !== targetGroup.parentId) {
        setDragState(null); return;
      }

      // 같은 레벨 형제 그룹을 현재 sortOrder로 정렬
      const siblings = groups
        .filter((g) => g.parentId === draggedGroup.parentId)
        .sort((a, b) => a.sortOrder - b.sortOrder);

      // 드래그 대상을 제거
      const without = siblings.filter((g) => g.id !== dragState.id);

      // 삽입 위치 결정
      const targetIdx = without.findIndex((g) => g.id === targetGroupId);
      const insertIdx = (indicator?.position === "before") ? targetIdx : targetIdx + 1;
      without.splice(insertIdx, 0, draggedGroup);

      // sortOrder가 변경된 항목만 업데이트
      const updates = without
        .map((g, i) => ({ id: g.id, sortOrder: i }))
        .filter((u) => {
          const orig = siblings.find((s) => s.id === u.id);
          return orig?.sortOrder !== u.sortOrder;
        });

      if (updates.length > 0) {
        try {
          await Promise.all(updates.map((u) => resourceGroupApi.update(u.id, { sortOrder: u.sortOrder })));
          await load();
        } catch (e: any) { alert(e.message ?? "순서 변경 실패"); }
      }
    }

    setDragState(null);
  };

  const handleDragEnd = () => {
    setDragState(null);
    setDragOverGroupId(null);
    setDropIndicator(null);
  };

  const dnd: DragHandlers = {
    dragState, dragOverGroupId, dropIndicator,
    onDragStartResource: handleDragStartResource,
    onDragStartGroup: handleDragStartGroup,
    onDragOverGroup: handleDragOverGroup,
    onDragLeaveGroup: handleDragLeaveGroup,
    onDropOnGroup: handleDropOnGroup,
    onDragEnd: handleDragEnd,
  };

  // ─── 멤버 편집 ───────────────────────────────────────────────────────────

  const openMemberModal = (group: Group) => {
    setEditingGroup(group);
    setCheckedIds(new Set(group.resourceIds));
    setMemberSearch("");
  };

  const toggleMember = (id: string) =>
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const saveMembers = async () => {
    if (!editingGroup) return;
    setSavingMembers(true);
    try {
      await resourceGroupApi.setMembers(editingGroup.id, [...checkedIds]);
      setEditingGroup(null);
      await load();
    } catch (e: any) { alert(e.message ?? "저장 실패"); }
    finally { setSavingMembers(false); }
  };

  // ─── 자원 추가 ───────────────────────────────────────────────────────────

  const handleCreateResource = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingResource(true);
    try {
      await resourceApi.create({
        name: resourceForm.name.trim(),
        type: resourceForm.type,
        dailyCapacityHours: resourceForm.dailyCapacityHours,
      });
      setShowCreateResource(false);
      setResourceForm({ name: "", type: "PERSON", dailyCapacityHours: 8 });
      await load();
    } catch (e: any) { alert(e.message ?? "생성 실패"); }
    finally { setSavingResource(false); }
  };

  // ─── 그룹 생성/수정 ──────────────────────────────────────────────────────

  const openCreateGroup = (parentId = "") => {
    setGroupModal({ mode: "create" });
    setGroupForm({ name: "", description: "", parentId });
  };

  const openRenameGroup = (group: Group) => {
    setGroupModal({ mode: "rename", group });
    setGroupForm({ name: group.name, description: group.description ?? "", parentId: group.parentId ?? "" });
  };

  const handleSaveGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingGroup(true);
    try {
      if (groupModal?.mode === "create") {
        await resourceGroupApi.create({
          name: groupForm.name,
          description: groupForm.description || undefined,
          parentId: groupForm.parentId || undefined,
        });
      } else if (groupModal?.group) {
        await resourceGroupApi.update(groupModal.group.id, { name: groupForm.name });
      }
      setGroupModal(null);
      await load();
    } catch (e: any) { alert(e.message ?? "저장 실패"); }
    finally { setSavingGroup(false); }
  };

  const handleDeleteGroup = async (group: Group) => {
    if (group.isProtected) { alert(group.isDept ? "부서 그룹은 사용자 관리에서 관리합니다." : "이 그룹은 삭제할 수 없습니다."); return; }
    if (!confirm(`"${group.name}" 그룹을 삭제할까요?`)) return;
    try { await resourceGroupApi.delete(group.id); await load(); }
    catch (e: any) { alert(e.message ?? "삭제 실패"); }
  };

  const handleToggleActive = async (id: string, isActive: boolean) => {
    try { await resourceApi.update(id, { isActive: !isActive }); await load(); }
    catch (e: any) { alert(e.message); }
  };

  const handleOpenUserIdModal = (resource: Resource) => {
    setUserIdModal(resource);
    setUserIdInput(resource.userId ?? "");
  };

  const handleSaveUserId = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userIdModal) return;
    setSavingUserId(true);
    try {
      await resourceApi.update(userIdModal.id, { userId: userIdInput.trim() || null });
      await load();
      setUserIdModal(null);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSavingUserId(false);
    }
  };

  // ─── 렌더 데이터 ─────────────────────────────────────────────────────────

  const tree = buildTree(groups);
  const resourceMap = new Map(resources.map((r) => [r.id, r]));
  const allGroupedIds = new Set(groups.flatMap((g) => g.resourceIds));
  const ungrouped = resources.filter((r) => !allGroupedIds.has(r.id));
  const rootGroups = groups.filter((g) => !g.parentId);
  const filteredForModal = resources.filter((r) =>
    r.name.toLowerCase().includes(memberSearch.toLowerCase())
  );

  const utilizationColor = (pct: number) => {
    if (pct > 100) return "bg-red-500";
    if (pct >= 80) return "bg-orange-400";
    if (pct >= 20) return "bg-blue-500";
    return "bg-gray-300";
  };
  const utilizationBg = (pct: number) => {
    if (pct > 100) return "bg-red-50";
    if (pct >= 80) return "bg-orange-50";
    return "";
  };

  const toggleResourceExpand = (id: string) =>
    setExpandedResources((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { sessionStorage.setItem(DASH_EXPANDED_KEY, JSON.stringify([...next])); } catch {}
      return next;
    });

  const saveAllocation = async () => {
    if (!editingAlloc) return;
    setSavingAlloc(true);
    try {
      const { segmentId, resourceId, projectId, taskId, mode, value } = editingAlloc;
      await taskApi.upsertAssignment(projectId, taskId, segmentId, {
        resourceId,
        allocationMode: mode as "PERCENT" | "HOURS",
        ...(mode === "PERCENT" ? { allocationPercent: value } : { allocationHoursPerDay: value }),
      });
      setEditingAlloc(null);
      await loadDashboard();
    } catch (e: any) {
      alert(e.message ?? "저장 실패");
    } finally {
      setSavingAlloc(false);
    }
  };

  const renderDashCard = (r: any) => {
    const isOpen = expandedResources.has(r.resourceId);
    const pct: number = r.totalAllocationPercent;
    return (
      <div key={r.resourceId} className={`bg-white rounded-xl border overflow-hidden transition-all ${
        pct > 100 ? "border-red-200" : pct >= 80 ? "border-orange-200" : "border-gray-200"
      }`}>
        <div
          className={`flex items-center gap-3 px-4 py-3 cursor-pointer select-none hover:bg-gray-50 ${utilizationBg(pct)}`}
          onClick={() => toggleResourceExpand(r.resourceId)}
        >
          <span className="text-gray-400 text-xs w-4 shrink-0">{isOpen ? "▾" : "▸"}</span>
          <span className="text-base shrink-0">{r.type === "PERSON" ? "👤" : "🔧"}</span>
          <span className="font-semibold text-gray-900 w-32 shrink-0 truncate">{r.resourceName}</span>
          <span className="text-xs text-gray-400"><strong className="text-gray-600">{r.dailyCapacityHours}h/일</strong></span>
          <div className="flex-1 flex items-center gap-3 min-w-0">
            <div className="flex-1 h-2.5 bg-gray-200 rounded-full overflow-hidden min-w-0">
              <div className={`h-full rounded-full transition-all ${utilizationColor(pct)}`}
                style={{ width: `${Math.min(pct, 100)}%` }} />
            </div>
            <span className={`font-bold text-sm w-12 text-right shrink-0 ${pct > 100 ? "text-red-600" : "text-gray-700"}`}>
              {pct.toFixed(0)}%
            </span>
          </div>
          <div className="shrink-0">
            {pct > 100
              ? <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full font-medium">과부하</span>
              : pct < 20
              ? <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full">여유</span>
              : <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full font-medium">정상</span>}
          </div>
          <span className="text-xs text-gray-400 shrink-0 w-16 text-right">
            {r.assignments.length}개 배정
          </span>
        </div>
        {isOpen && (
          <div className="border-t border-gray-100">
            {r.assignments.length === 0 ? (
              <div className="px-6 py-4 text-sm text-gray-400 text-center">배정된 작업이 없습니다</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100 text-xs text-gray-500">
                    <th className="text-left px-6 py-2 font-medium">프로젝트</th>
                    <th className="text-left px-3 py-2 font-medium">태스크 / 세그먼트</th>
                    <th className="text-left px-3 py-2 font-medium w-40">기간</th>
                    <th className="text-left px-3 py-2 font-medium w-36">배정율</th>
                  </tr>
                </thead>
                <tbody>
                  {[...r.assignments].sort((a: any, b: any) =>
                    a.projectName.localeCompare(b.projectName) ||
                    (a.taskSortOrder ?? 0) - (b.taskSortOrder ?? 0)
                  ).map((a: any) => {
                    const isEditing =
                      editingAlloc?.segmentId === a.segmentId &&
                      editingAlloc?.resourceId === r.resourceId;
                    const displayVal = a.allocationMode === "PERCENT"
                      ? `${a.allocationPercent ?? 0}%`
                      : `${a.allocationHoursPerDay ?? 0}h/day (${a.effectivePercent}%)`;
                    return (
                      <tr key={a.segmentId} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                        <td className="px-6 py-1.5">
                          <button
                            onClick={() => {
                              sessionStorage.setItem(`erp_tab_${a.projectId}`, "tasks");
                              router.push(`/projects/${a.projectId}`);
                            }}
                            className="text-blue-600 font-medium hover:text-blue-800 hover:underline text-left"
                          >
                            {a.projectName}
                          </button>
                        </td>
                        <td className="px-3 py-1.5 text-gray-700 text-xs whitespace-nowrap">
                          <span className="font-medium">{a.taskName}</span>
                          <span className="text-gray-300 mx-1">·</span>
                          <span className="text-gray-400">{a.segmentName}</span>
                        </td>
                        <td className="px-3 py-1.5 text-gray-500 text-xs whitespace-nowrap">
                          {a.startDate.slice(5)} ~ {a.endDate.slice(5)}
                        </td>
                        <td className="px-3 py-1.5">
                          {isEditing ? (
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                min={0}
                                max={a.allocationMode === "PERCENT" ? 100 : 24}
                                step={a.allocationMode === "PERCENT" ? 5 : 0.5}
                                value={editingAlloc!.value}
                                onChange={(e) => setEditingAlloc((prev) => prev ? { ...prev, value: Number(e.target.value) } : null)}
                                onBlur={saveAllocation}
                                onFocus={(e) => (e.target as HTMLInputElement).select()}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") saveAllocation();
                                  if (e.key === "Escape") setEditingAlloc(null);
                                }}
                                className="w-20 px-2 py-1 border border-blue-400 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                autoFocus
                              />
                              <span className="text-xs text-gray-500">{a.allocationMode === "PERCENT" ? "%" : "h/day"}</span>
                            </div>
                          ) : (
                            <button
                              onClick={() => setEditingAlloc({
                                segmentId: a.segmentId,
                                resourceId: r.resourceId,
                                projectId: a.projectId,
                                taskId: a.taskId,
                                mode: a.allocationMode,
                                value: a.allocationMode === "PERCENT"
                                  ? (a.allocationPercent ?? 0)
                                  : (a.allocationHoursPerDay ?? 0),
                              })}
                              className="text-sm font-semibold text-gray-800 hover:text-blue-600 hover:bg-blue-50 px-2 py-0.5 rounded transition-colors"
                              title="클릭하여 수정"
                            >
                              {displayVal}
                              <span className="text-xs text-gray-300 ml-1">✎</span>
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto px-6 py-6">
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-gray-900">자원 관리</h2>
            <p className="text-sm text-gray-500">그룹명 클릭으로 구성원 편집 · 드래그로 순서/그룹 변경</p>
          </div>
          {isAdmin && (
            <div className="flex gap-2">
              <button onClick={() => openCreateGroup()}
                className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50">
                + 사용자 그룹 추가
              </button>
              <button onClick={() => setShowCreateResource(true)}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700">
                + 자원 추가
              </button>
            </div>
          )}
        </div>

        {/* 탭 */}
        <div className="flex gap-1 border-b border-gray-200 mb-6">
          {(["list", "dashboard"] as const).map((t) => (
            <button key={t} onClick={() => handleTabChange(t)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === t ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"
              }`}>
              {t === "list" ? "👥 자원 목록" : "📊 운영 현황"}
            </button>
          ))}
        </div>

        {/* 목록 탭 */}
        {tab === "list" && (
          loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
            </div>
          ) : (
            <div onDragOver={(e) => e.preventDefault()}>
              {[0, 1, 2].map((sectionKey) => {
                const section = tree.filter((g) => groupSortKey(g) === sectionKey);
                if (section.length === 0) return null;
                return (
                  <div key={sectionKey} style={{ marginTop: sectionKey > 0 ? 12 : 0 }}>
                    {section.map((group) => (
                      <Fragment key={group.id}>
                        {dropIndicator?.targetId === group.id && dropIndicator.position === "before" && <DropLine />}
                        <div className="mb-0.5">
                          <GroupNode
                            group={group} expanded={expanded} resourceMap={resourceMap} dnd={dnd}
                            onToggle={toggleExpand} onToggleActive={handleToggleActive}
                            onDelete={handleDeleteGroup} onRename={openRenameGroup}
                            onEditMembers={openMemberModal} onEditUserId={isAdmin ? handleOpenUserIdModal : undefined}
                            isAdmin={isAdmin} depth={0}
                          />
                        </div>
                        {dropIndicator?.targetId === group.id && dropIndicator.position === "after" && <DropLine />}
                      </Fragment>
                    ))}
                  </div>
                );
              })}

              {/* 미분류 */}
              {ungrouped.length > 0 && (
                <div className="bg-white rounded-xl border border-dashed border-gray-300 overflow-hidden" style={{ marginTop: 12 }}>
                  <div className="px-4 py-3 bg-gray-50 flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-500">📂 미분류</span>
                    <span className="text-xs text-gray-400">{ungrouped.length}명</span>
                  </div>
                  <ResourceRows resources={ungrouped} dnd={dnd} onToggleActive={handleToggleActive} onEditUserId={isAdmin ? handleOpenUserIdModal : undefined} isAdmin={isAdmin} />
                </div>
              )}

              {tree.length === 0 && ungrouped.length === 0 && (
                <div className="text-center py-20">
                  <div className="text-5xl mb-4">👥</div>
                  <p className="text-gray-500 mb-4">등록된 자원이 없습니다.</p>
                  <button onClick={() => setShowCreateResource(true)} className="text-blue-600 hover:underline font-medium">
                    첫 자원 추가하기 →
                  </button>
                </div>
              )}

              {/* 드래그 중 안내 토스트 */}
              {dragState && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-xs px-4 py-2 rounded-full shadow-lg pointer-events-none z-50">
                  {dragState.type === "resource"
                    ? "그룹 헤더 위에 놓으면 해당 그룹에 추가됩니다"
                    : "원하는 위치에 놓으면 그 사이에 삽입됩니다"}
                </div>
              )}
            </div>
          )
        )}

        {/* 운영 현황 탭 */}
        {tab === "dashboard" && (
          <div>
            {/* 날짜 필터 */}
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              {/* 빠른 선택 버튼 */}
              {[
                { label: "오늘", onClick: () => { const t = todayStr(); applyDate(t, t); } },
                { label: "지난주", onClick: () => { const r = weekRange(-1); applyDate(r.start, r.end); } },
                { label: "이번주", onClick: () => { const r = weekRange(0); applyDate(r.start, r.end); } },
                { label: "다음주", onClick: () => { const r = weekRange(1); applyDate(r.start, r.end); } },
              ].map(({ label, onClick }) => (
                <button key={label} onClick={onClick}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-600 transition-colors">
                  {label}
                </button>
              ))}
              <div className="flex-1" />
              {/* 날짜 직접 입력 + 조회 (오른쪽) */}
              <input type="date" value={startDate} onChange={(e) => {
                setStartDate(e.target.value);
                try { sessionStorage.setItem(DASH_DATE_KEY, JSON.stringify({ startDate: e.target.value, endDate })); } catch {}
              }} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <span className="text-gray-400 text-sm">~</span>
              <input type="date" value={endDate} onChange={(e) => {
                setEndDate(e.target.value);
                try { sessionStorage.setItem(DASH_DATE_KEY, JSON.stringify({ startDate, endDate: e.target.value })); } catch {}
              }} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <button onClick={loadDashboard} disabled={dashLoading}
                className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                {dashLoading ? "조회 중..." : "조회"}
              </button>
              <button onClick={() => {
                const allIds = [
                  ...groups.filter((g) => g.isDept || (!g.isDept && g.description !== "__all__" && g.name !== "전체")).map((g) => g.id),
                  "__dash_unassigned__",
                ];
                const allOpen = allIds.every((id) => dashDeptExpanded.has(id));
                setDashDeptExpanded(allOpen ? new Set() : new Set(allIds));
              }} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-600 transition-colors">
                {(() => {
                  const allIds = [
                    ...groups.filter((g) => g.isDept || (!g.isDept && g.description !== "__all__" && g.name !== "전체")).map((g) => g.id),
                    "__dash_unassigned__",
                  ];
                  return allIds.length > 0 && allIds.every((id) => dashDeptExpanded.has(id)) ? "전체 닫기" : "전체 펼치기";
                })()}
              </button>
            </div>

            {dashLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
              </div>
            ) : dashboard.length === 0 ? (
              <div className="text-center py-16 text-gray-400">활성 자원이 없거나 배정 데이터가 없습니다.</div>
            ) : (
              <div className="space-y-1">
                {(() => {
                  const deptGroups = groups
                    .filter((g) => g.isDept)
                    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
                  const customGroups = groups
                    .filter((g) => !g.isDept && g.description !== "__all__" && g.name !== "전체")
                    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
                  const allGroupedIds = new Set([...deptGroups, ...customGroups].flatMap((g) => g.resourceIds));

                  const sections: { id: string; name: string; items: any[] }[] = [
                    ...deptGroups.map((g) => ({
                      id: g.id,
                      name: g.name,
                      items: dashboard.filter((r: any) => g.resourceIds.includes(r.resourceId)),
                    })),
                    ...customGroups.map((g) => ({
                      id: g.id,
                      name: g.name,
                      items: dashboard.filter((r: any) => g.resourceIds.includes(r.resourceId)),
                    })),
                    {
                      id: "__dash_unassigned__",
                      name: "미분류",
                      items: dashboard.filter((r: any) => !allGroupedIds.has(r.resourceId)),
                    },
                  ].filter((s) => s.items.length > 0);

                  return sections.map((section) => {
                    const isOpen = dashDeptExpanded.has(section.id);
                    return (
                      <div key={section.id} className="mb-1">
                        <button
                          onClick={() => toggleDashDept(section.id)}
                          className="w-full flex items-center gap-2 px-4 py-3 bg-gray-50 rounded-xl border border-gray-200 text-left hover:bg-gray-100 transition-colors"
                        >
                          <span className="text-gray-400 text-xs">{isOpen ? "▾" : "▸"}</span>
                          <span className="font-semibold text-gray-700 text-sm">{section.name}</span>
                          <span className="text-xs text-gray-400">{section.items.length}명</span>
                        </button>
                        {isOpen && (
                          <div className="mt-1 pl-4 space-y-1">
                            {section.items.map(renderDashCard)}
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── 멤버 편집 모달 ─────────────────────────────────────────────────────── */}
      {editingGroup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[80vh]">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between shrink-0">
              <div>
                <h3 className="font-semibold text-gray-900">{editingGroup.name} 구성원 편집</h3>
                <p className="text-xs text-gray-500 mt-0.5">체크박스로 여러 명을 선택할 수 있습니다</p>
              </div>
              <button onClick={() => setEditingGroup(null)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="px-6 py-3 border-b border-gray-100 shrink-0">
              <input type="text" placeholder="이름으로 검색..." value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="px-6 py-2 border-b border-gray-100 flex items-center gap-3 shrink-0 bg-gray-50">
              <span className="text-xs text-gray-500 flex-1">{checkedIds.size}명 선택됨 / 전체 {resources.length}명</span>
              <button onClick={() => setCheckedIds(new Set(resources.map((r) => r.id)))} className="text-xs text-blue-600 hover:underline">전체 선택</button>
              <span className="text-gray-300">|</span>
              <button onClick={() => setCheckedIds(new Set())} className="text-xs text-gray-500 hover:underline">전체 해제</button>
            </div>
            <div className="overflow-y-auto flex-1 px-2 py-2">
              {filteredForModal.length === 0
                ? <p className="text-center text-sm text-gray-400 py-8">검색 결과가 없습니다</p>
                : filteredForModal.map((r) => (
                  <label key={r.id} className={`flex items-center gap-3 px-4 py-2.5 rounded-lg cursor-pointer transition-colors ${
                    checkedIds.has(r.id) ? "bg-blue-50" : "hover:bg-gray-50"
                  }`}>
                    <input type="checkbox" checked={checkedIds.has(r.id)} onChange={() => toggleMember(r.id)}
                      className="w-4 h-4 rounded text-blue-600 accent-blue-600" />
                    <span className="text-base">{r.type === "PERSON" ? "👤" : "🔧"}</span>
                    <span className="flex-1 text-sm font-medium text-gray-800">{r.name}</span>
                    <span className="text-xs text-gray-400">{r.dailyCapacityHours}h/day</span>
                    {!r.isActive && <span className="text-xs bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded">비활성</span>}
                  </label>
                ))}
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex gap-3 shrink-0">
              <button onClick={() => setEditingGroup(null)}
                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">취소</button>
              <button onClick={saveMembers} disabled={savingMembers}
                className="flex-1 bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
                {savingMembers ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 자원 추가 모달 ─────────────────────────────────────────────────────── */}
      {showCreateResource && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">자원 추가</h3>
              <button onClick={() => setShowCreateResource(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <form onSubmit={handleCreateResource} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">이름 *</label>
                <input type="text" value={resourceForm.name}
                  onChange={(e) => setResourceForm({ ...resourceForm, name: e.target.value })}
                  required placeholder="홍길동"
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">유형</label>
                <select value={resourceForm.type} onChange={(e) => setResourceForm({ ...resourceForm, type: e.target.value })}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm">
                  <option value="EQUIPMENT">🔧 장비</option>
                  <option value="VEHICLE">🚗 차량</option>
                  <option value="FACILITY">🏭 시설</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">일일 가용시간</label>
                <input type="number" min={1} max={24} value={resourceForm.dailyCapacityHours}
                  onChange={(e) => setResourceForm({ ...resourceForm, dailyCapacityHours: Number(e.target.value) })}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowCreateResource(false)}
                  className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">취소</button>
                <button type="submit" disabled={savingResource || !resourceForm.name.trim()}
                  className="flex-1 bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
                  {savingResource ? "저장 중..." : "추가"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── 그룹 추가/수정 모달 ─────────────────────────────────────────────────── */}
      {groupModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">
                {groupModal.mode === "create" ? "그룹 추가" : "그룹 이름 수정"}
              </h3>
              <button onClick={() => setGroupModal(null)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <form onSubmit={handleSaveGroup} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">그룹 이름 *</label>
                <input type="text" value={groupForm.name}
                  onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
                  required placeholder="개발팀" autoFocus
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
              </div>
              {groupModal.mode === "create" && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">설명</label>
                    <input type="text" value={groupForm.description}
                      onChange={(e) => setGroupForm({ ...groupForm, description: e.target.value })}
                      placeholder="선택 입력"
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">상위 그룹</label>
                    <select value={groupForm.parentId} onChange={(e) => setGroupForm({ ...groupForm, parentId: e.target.value })}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm">
                      <option value="">최상위 그룹</option>
                      {rootGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                  </div>
                </>
              )}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setGroupModal(null)}
                  className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">취소</button>
                <button type="submit" disabled={savingGroup || !groupForm.name.trim()}
                  className="flex-1 bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
                  {savingGroup ? "저장 중..." : "저장"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── 계정 연결 모달 ───────────────────────────────────────────────────── */}
      {userIdModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">계정 연결 — {userIdModal.name}</h3>
              <button onClick={() => setUserIdModal(null)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <form onSubmit={handleSaveUserId} className="p-6 space-y-4">
              <p className="text-xs text-gray-500">
                로그인 이메일 주소를 입력하세요.<br/>
                예: <code className="bg-gray-100 px-1 rounded">hong@company.com</code>
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">로그인 이메일</label>
                <input
                  type="email" value={userIdInput}
                  onChange={(e) => setUserIdInput(e.target.value)}
                  placeholder="hong@company.com"
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setUserIdModal(null)}
                  className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">취소</button>
                <button type="submit" disabled={savingUserId}
                  className="flex-1 bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
                  {savingUserId ? "저장 중..." : "저장"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppLayout>
  );
}

// ─── GroupNode ────────────────────────────────────────────────────────────────

function GroupNode({
  group, expanded, resourceMap, dnd,
  onToggle, onToggleActive, onDelete, onRename, onEditMembers, onEditUserId, isAdmin, depth,
}: {
  group: Group;
  expanded: Set<string>;
  resourceMap: Map<string, Resource>;
  dnd: DragHandlers;
  onToggle: (id: string) => void;
  onToggleActive: (id: string, isActive: boolean) => void;
  onDelete: (g: Group) => void;
  onRename: (g: Group) => void;
  onEditMembers: (g: Group) => void;
  onEditUserId?: (r: Resource) => void;
  isAdmin?: boolean;
  depth: number;
}) {
  const isOpen = expanded.has(group.id);
  const isBeingDragged = dnd.dragState?.id === group.id && dnd.dragState?.type === "group";
  const isResourceDropTarget = dnd.dragOverGroupId === group.id;
  const draggedResourceAlreadyIn =
    dnd.dragState?.type === "resource" && group.resourceIds.includes(dnd.dragState.id);

  const directResources = group.resourceIds
    .map((id) => resourceMap.get(id))
    .filter((r): r is Resource => !!r);
  if (group.name !== "전체" && group.description !== "__all__") {
    directResources.sort((a, b) => a.name.localeCompare(b.name));
  }

  const totalCount =
    directResources.length +
    (group.children?.reduce((s, c) => s + c.resourceIds.length, 0) ?? 0);

  return (
    <div className={`transition-opacity ${isBeingDragged ? "opacity-40" : ""}`}>
      <div className={`bg-white rounded-xl border overflow-hidden transition-all ${
        isResourceDropTarget
          ? draggedResourceAlreadyIn
            ? "border-gray-300 ring-2 ring-gray-200"
            : "border-blue-400 ring-2 ring-blue-200 shadow-md"
          : "border-gray-200"
      }`}>
        {/* 그룹 헤더 — 드롭 존 */}
        <div
          className="flex items-center gap-2 px-4 py-3 bg-gray-50 border-b border-gray-200 cursor-pointer select-none hover:bg-gray-100 transition-colors"
          onClick={() => onToggle(group.id)}
          onDragOver={(e) => dnd.onDragOverGroup(group.id, e)}
          onDragLeave={dnd.onDragLeaveGroup}
          onDrop={() => dnd.onDropOnGroup(group.id)}
        >
          {/* 드래그 핸들 — 보호 그룹(전체/부서)은 순서 변경 불가 */}
          {isAdmin && !group.isProtected ? (
            <div
              draggable
              onDragStart={(e) => dnd.onDragStartGroup(group.id, e)}
              onDragEnd={dnd.onDragEnd}
              onClick={(e) => e.stopPropagation()}
              className="text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing px-0.5 shrink-0 select-none text-lg leading-none"
              title="드래그하여 순서 변경"
            >
              ⠿
            </div>
          ) : (
            <span className="px-0.5 shrink-0 select-none text-lg leading-none text-transparent">⠿</span>
          )}

          <span className="text-gray-400 text-xs w-4 shrink-0">
            {isOpen ? "▾" : "▸"}
          </span>

          {/* 그룹명 — 부서 그룹은 클릭 비활성 */}
          <span className="flex items-center gap-1.5 flex-1 min-w-0">
            <span className="text-base shrink-0">{depth === 0 ? "🏢" : "📁"}</span>
            <span className="font-semibold text-gray-800 text-sm truncate">{group.name}</span>
            {isResourceDropTarget && !draggedResourceAlreadyIn && (
              <span className="text-xs bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded shrink-0">여기에 추가</span>
            )}
            {isResourceDropTarget && draggedResourceAlreadyIn && (
              <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded shrink-0">이미 소속됨</span>
            )}
          </span>
          {isAdmin && !group.isProtected && (
            <button
              onClick={(e) => { e.stopPropagation(); onEditMembers(group); }}
              className="text-xs text-blue-500 hover:text-blue-700 px-2 py-0.5 rounded hover:bg-blue-50 shrink-0 font-medium"
            >
              편집
            </button>
          )}

          {group.description && !group.isDept && <span className="text-xs text-gray-400 hidden sm:inline shrink-0">{group.description}</span>}
          <span className="text-xs text-gray-400 shrink-0">{totalCount}명</span>

          {/* 수정/삭제 — isProtected(부서+전체) 모두 삭제 불가, isDept는 수정도 불가 */}
          {isAdmin && !group.isProtected && (
            <div className="flex gap-1 shrink-0">
              <button onClick={(e) => { e.stopPropagation(); onRename(group); }}
                className="text-xs text-gray-400 hover:text-blue-600 px-1.5 py-0.5 rounded hover:bg-blue-50">수정</button>
              <button onClick={(e) => { e.stopPropagation(); onDelete(group); }}
                className="text-xs text-gray-400 hover:text-red-600 px-1.5 py-0.5 rounded hover:bg-red-50">삭제</button>
            </div>
          )}
          {group.isProtected && (
            <span
              title={group.isDept ? "부서 그룹은 사용자 관리에서 편집합니다" : "이 그룹은 삭제할 수 없습니다"}
              className="text-xs text-gray-400 shrink-0"
            >🔒</span>
          )}
        </div>

        {/* 펼친 내용 */}
        {isOpen && (
          <div>
            {/* 하위 그룹 — 삽입 위치선 포함 */}
            {(group.children?.length ?? 0) > 0 && (
              <div className="p-3 space-y-0 bg-gray-50/40">
                {group.children!.map((child) => (
                  <Fragment key={child.id}>
                    {dnd.dropIndicator?.targetId === child.id && dnd.dropIndicator.position === "before" && <DropLine />}
                    <div className="mb-2">
                      <GroupNode
                        group={child} expanded={expanded} resourceMap={resourceMap} dnd={dnd}
                        onToggle={onToggle} onToggleActive={onToggleActive}
                        onDelete={onDelete} onRename={onRename} onEditMembers={onEditMembers} onEditUserId={onEditUserId}
                        isAdmin={isAdmin} depth={depth + 1}
                      />
                    </div>
                    {dnd.dropIndicator?.targetId === child.id && dnd.dropIndicator.position === "after" && <DropLine />}
                  </Fragment>
                ))}
              </div>
            )}

            {directResources.length > 0 && (
              <div className="pl-10">
                <ResourceRows resources={directResources} dnd={dnd} onToggleActive={onToggleActive} onEditUserId={onEditUserId} isAdmin={isAdmin} />
              </div>
            )}

            {(group.children?.length ?? 0) === 0 && directResources.length === 0 && (
              group.isDept ? (
                <div className="px-4 py-5 text-center text-sm text-gray-400">
                  구성원이 없습니다. 사용자 관리에서 부서를 지정하세요
                </div>
              ) : (
                <div className="px-4 py-5 text-center text-sm text-gray-400 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => onEditMembers(group)}>
                  구성원이 없습니다. 클릭하거나 자원을 드래그하여 추가하세요
                </div>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── ResourceRows ─────────────────────────────────────────────────────────────

function ResourceRows({ resources, dnd, onToggleActive, onEditUserId, isAdmin }: {
  resources: Resource[];
  dnd: DragHandlers;
  onToggleActive: (id: string, isActive: boolean) => void;
  onEditUserId?: (resource: Resource) => void;
  isAdmin?: boolean;
}) {
  return (
    <table className="w-full text-sm">
      <tbody>
        {resources.map((r) => {
          const isBeingDragged = dnd.dragState?.id === r.id && dnd.dragState?.type === "resource";
          return (
            <tr key={r.id}
              draggable={isAdmin ? true : undefined}
              onDragStart={isAdmin ? () => dnd.onDragStartResource(r.id) : undefined}
              onDragEnd={isAdmin ? dnd.onDragEnd : undefined}
              className={`border-b border-gray-100 last:border-0 transition-opacity ${
                isBeingDragged ? "opacity-40" : "hover:bg-gray-50"
              }`}
            >
              <td className="pl-4 pr-1 py-2.5 w-6">
                {isAdmin ? (
                  <span className="text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing select-none"
                    title="드래그하여 다른 그룹에 추가">⠿</span>
                ) : (
                  <span className="select-none text-transparent">⠿</span>
                )}
              </td>
              <td className="px-2 py-2.5 font-medium text-gray-900">
                <span className="mr-1">{r.type === "PERSON" ? "👤" : "🔧"}</span>{r.name}
              </td>
              <td className="px-2 py-2.5 text-gray-500 text-xs">{TYPE_LABELS[r.type] ?? r.type}</td>
              <td className="px-2 py-2.5 text-gray-500 text-xs">{r.dailyCapacityHours}h/day</td>
              <td className="px-2 py-2.5 text-xs">
                {onEditUserId ? (
                  r.userId ? (
                    <button onClick={() => onEditUserId(r)}
                      className="text-blue-600 hover:text-blue-800 font-mono bg-blue-50 px-1.5 py-0.5 rounded max-w-[120px] truncate block"
                      title={r.userId}>
                      {r.userId}
                    </button>
                  ) : (
                    <button onClick={() => onEditUserId(r)}
                      className="text-gray-400 hover:text-blue-600 underline">
                      계정 연결
                    </button>
                  )
                ) : (
                  <span className="text-gray-400 font-mono">{r.userId ?? "—"}</span>
                )}
              </td>
              <td className="px-2 py-2.5">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  r.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                }`}>{r.isActive ? "활성" : "비활성"}</span>
              </td>
              <td className="px-4 py-2.5 text-right">
                {isAdmin && (
                  <button onClick={() => onToggleActive(r.id, r.isActive)}
                    className="text-xs text-gray-400 hover:text-gray-700 underline">
                    {r.isActive ? "비활성화" : "활성화"}
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
