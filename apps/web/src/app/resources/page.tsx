"use client";

import { Fragment, useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { resourceApi, resourceGroupApi, taskApi, userManagementApi, getUser } from "@/lib/api";
import AppLayout from "@/components/AppLayout";
import AttendanceOverview from "@/components/AttendanceOverview";
import OrgChart from "@/components/OrgChart";
import { DateInput } from "@/components/ui/DateInput";
import { ResourceTimeline, ResourceLoadLegend } from "@/components/ResourceTimeline";
import { ExternalPersonsPanel } from "@/components/ExternalPersonsPanel";
import { useHolidaysMap } from "@/hooks/useHolidaysMap";
import ReservationContainer from "@/components/equipment-reservation/ReservationContainer";

const TYPE_LABELS: Record<string, string> = {
  PERSON: "👤 인력",
  EQUIPMENT: "🔧 장비",
  VEHICLE: "🚗 차량",
  FACILITY: "🏭 시설",
};

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
function monthRange(offsetMonths: number): { start: string; end: string } {
  const d = new Date();
  d.setMonth(d.getMonth() + offsetMonths);
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { start: toDateStr(start), end: toDateStr(end) };
}

const TAB_KEY = "erp_tab_resources";
const EXPANDED_KEY = "erp_expanded_resources";
const DASH_DATE_KEY = "erp_dash_date_resources";
const DASH_EXPANDED_KEY = "erp_dash_expanded_resources";
const DASH_DEPT_EXPANDED_KEY = "erp_dash_dept_expanded_resources";

// ─── 타입 ─────────────────────────────────────────────────────────────────────

interface Group {
  id: string;
  name: string;
  description?: string | null;
  parentId: string | null;
  sortOrder: number;
  resourceIds: string[];                     // legacy Resource.id (Phase 4 제거 예정)
  personUserIds?: string[];                  // 자원-모델-분리 PDCA Phase 3a-4
  externalPersonIds?: string[];
  equipmentResourceIds?: string[];
  children?: Group[];
  isDept?: boolean;
  isProtected?: boolean;
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

// 자원-모델-분리 PDCA Phase 3b-5: 그룹의 멤버 ID 검사 (legacy + polymorphic 모두)
function groupHasResource(g: Group, resourceId: string): boolean {
  if (g.resourceIds.includes(resourceId)) return true;
  if (g.personUserIds?.includes(resourceId)) return true;
  if (g.externalPersonIds?.includes(resourceId)) return true;
  if (g.equipmentResourceIds?.includes(resourceId)) return true;
  return false;
}

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

// 인력자원(people) 탭은 폐기 — /admin/users로 이동 (2026-05-04)
type ResourceTab = "dashboard" | "external" | "attendance" | "orgchart" | "reservation";

export default function ResourcesPage() {
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState(false);
  const [resourceTab, setResourceTab] = useState<ResourceTab>("attendance");

  // 회사달력 v1.2 — 한국 공휴일·자체 휴일 (KASI 자동 갱신 포함)
  const holidays = useHolidaysMap();

  // 탭 복원: SSR 이후 클라이언트에서만 실행 (hydration 안전)
  useEffect(() => {
    const urlTab = new URLSearchParams(window.location.search).get("tab");
    if (urlTab) {
      // 폐기된 인력자원(users/list/people) URL은 사용자 관리 페이지로 redirect
      if (urlTab === "users" || urlTab === "list" || urlTab === "people") {
        router.replace("/admin/users");
        return;
      }
      // 공용자산 탭은 /admin/equipment-resources로 이동 (2026-05-05)
      if (urlTab === "equipment") {
        router.replace("/admin/equipment-resources");
        return;
      }
      const resolved: ResourceTab =
        urlTab === "attendance" ? "attendance"
        : urlTab === "orgchart" ? "orgchart"
        : urlTab === "reservation" ? "reservation"
        : urlTab === "external" ? "external"
        : urlTab === "dashboard" ? "dashboard" : "dashboard";
      setResourceTab(resolved);
      try { sessionStorage.setItem(TAB_KEY, resolved); } catch {}
      window.history.replaceState(null, "", window.location.pathname);
    } else {
      try {
        const saved = sessionStorage.getItem(TAB_KEY);
        if (saved === "attendance") setResourceTab("attendance");
        else if (saved === "orgchart") setResourceTab("orgchart");
        else if (saved === "reservation") setResourceTab("reservation");
        else if (saved === "external") setResourceTab("external");
        else if (saved === "dashboard") setResourceTab("dashboard");
        // 폐기된 "equipment" 저장값은 무시 — 기본 dashboard로 폴백
      } catch {}
    }
  }, [router]);

  const [groups, setGroups] = useState<Group[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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
  const [selectedUserId, setSelectedUserId] = useState("");
  const [userSearchQuery, setUserSearchQuery] = useState("");
  const [savingUserId, setSavingUserId] = useState(false);
  const [authUsers, setAuthUsers] = useState<{ id: string; email: string; name: string }[]>([]);

  // Dashboard
  // 초기 기본 기간: 이번주 월요일 ~ 다음주 일요일 (2주)
  const [startDate, setStartDate] = useState<string>(weekRange(0).start);
  const [endDate, setEndDate] = useState<string>(weekRange(1).end);
  const [dashboard, setDashboard] = useState<any[]>([]);
  const [dashLoading, setDashLoading] = useState(false);
  const [expandedResources, setExpandedResources] = useState<Set<string>>(new Set());
  const [dashDeptExpanded, setDashDeptExpanded] = useState<Set<string>>(new Set());
  const toggleDashDept = (id: string) =>
    setDashDeptExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      try { sessionStorage.setItem(DASH_DEPT_EXPANDED_KEY, JSON.stringify([...next])); } catch {}
      return next;
    });

  const [editingAlloc, setEditingAlloc] = useState<{
    segmentId: string; resourceId: string;
    projectId: string; taskId: string;
    mode: string; value: number;
  } | null>(null);
  const [savingAlloc, setSavingAlloc] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("erp_user");
    if (!token) { router.push("/login"); return; }
    setIsAdmin(getUser()?.role === "ADMIN");
    // sessionStorage 복원 (hydration 이후 클라이언트에서만)
    try {
      const savedExpanded = sessionStorage.getItem(EXPANDED_KEY);
      if (savedExpanded) setExpanded(new Set<string>(JSON.parse(savedExpanded)));
      const savedDate = sessionStorage.getItem(DASH_DATE_KEY);
      if (savedDate) {
        const { startDate: s, endDate: e } = JSON.parse(savedDate);
        if (s) setStartDate(s);
        if (e) setEndDate(e);
      }
      const savedDashExp = sessionStorage.getItem(DASH_EXPANDED_KEY);
      if (savedDashExp) setExpandedResources(new Set<string>(JSON.parse(savedDashExp)));
      const savedDeptExp = sessionStorage.getItem(DASH_DEPT_EXPANDED_KEY);
      if (savedDeptExp) setDashDeptExpanded(new Set<string>(JSON.parse(savedDeptExp)));
    } catch {}
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
      const resources: Resource[] = initialResources as Resource[];
      const groups: Group[] = rawGroups as Group[];

      // ── 2. 유저 + 프로필 로드 (ADMIN 전용, 실패 허용) ─────────────────────
      let users: any[] = [];
      try {
        const usersData = await userManagementApi.list();
        // 배열 또는 { items: [] } 모두 처리
        users = Array.isArray(usersData) ? usersData : ((usersData as any).items ?? []);
        setAuthUsers(users.map((u: any) => ({ id: u.id, email: u.email, name: u.name })));
      } catch { /* ADMIN 아닌 유저는 빈 배열 사용 */ }

      // ⚠️ 자원-모델-분리 PDCA Phase 3b-4a (2026-05-04): PERSON Resource 자동 등록 폐기.
      //   인력은 auth_users가 단일 source. dashboard API가 auth_users를 직접 표시.
      //   기존 PERSON Resource 63건은 Phase 4에서 일괄 정리.

      // ── 4. 그룹 마킹 ──────────────────────────────────────────────────────
      // isDept: description === "__dept__" 또는 부서명과 일치하는 그룹
      const deptNames = new Set(
        users.filter((u: any) => u.profile?.departmentName).map((u: any) => u.profile.departmentName)
      );
      const markedGroups: Group[] = groups.map((g) => {
        const isDept = g.description === "__dept__" || deptNames.has(g.name);
        const isProtected = isDept || g.description === "__all__" || g.name === "전체";
        return { ...g, isDept, isProtected };
      });

      // ── 5. "전체" 그룹에 활성 유저 자원 전부 동기화 ─────────────────────
      const allGroup = markedGroups.find((g) => g.name === "전체");
      if (allGroup && users.length > 0) {
        // 자원-모델-분리 Phase 4: PERSON Resource 폐기 → 멤버는 auth user id(personUserId)로 직접 동기화.
        // (구 코드는 폐기된 resources[]에서 id를 뽑아 멤버를 전부 비워버렸음 — 부서/전체 사라짐 회귀)
        const allUserIds = users
          .filter((u: any) => u.isActive !== false)
          .map((u: any) => u.id);
        const currentIds = [...(allGroup.personUserIds ?? [])].sort().join(",");
        const newIds = [...allUserIds].sort().join(",");
        if (currentIds !== newIds) {
          await resourceGroupApi.setMembers(allGroup.id, allUserIds).catch(() => {});
          allGroup.personUserIds = allUserIds;
        }
      }

      // ── 6. 부서 그룹 구성원 자동 동기화 (ADMIN 전용) ────────────────────
      if (users.length > 0) {
        for (const g of markedGroups.filter((g) => g.isDept)) {
          // 멤버 = 해당 부서명 auth user의 id(personUserId). setMembers가 PERSON으로 해석해 저장.
          const deptUserIds = users
            .filter((u: any) => u.profile?.departmentName === g.name)
            .map((u: any) => u.id);
          const currentIds = [...(g.personUserIds ?? [])].sort().join(",");
          const newIds = [...deptUserIds].sort().join(",");
          if (currentIds !== newIds) {
            await resourceGroupApi.setMembers(g.id, deptUserIds).catch(() => {});
            g.personUserIds = deptUserIds;
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
          for (const id of (dg.personUserIds ?? [])) {
            if (!addedIds.has(id)) { sortedIds.push(id); addedIds.add(id); }
          }
        }
        for (const id of (allGroup.personUserIds ?? [])) {
          if (!addedIds.has(id)) sortedIds.push(id);
        }
        allGroup.personUserIds = sortedIds;
      }

      setGroups(markedGroups);
      setResources(resources);
      setExpanded((prev) => {
        const hasSaved = (() => { try { return sessionStorage.getItem(EXPANDED_KEY) !== null; } catch { return false; } })();
        if (!hasSaved) {
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

  // 기간 설정만 담당(persist). 실제 재조회는 아래 useEffect(startDate/endDate 의존)가 처리.
  const applyDate = (start: string, end: string) => {
    setStartDate(start);
    setEndDate(end);
    try { sessionStorage.setItem(DASH_DATE_KEY, JSON.stringify({ startDate: start, endDate: end })); } catch {}
  };

  // 간트 방식: 현재 선택 구간 길이만큼 앞(-1)/뒤(+1)로 이동
  const shiftRange = (dir: -1 | 1) => {
    if (!startDate || !endDate) return;
    const s = new Date(startDate), e = new Date(endDate);
    const days = Math.round((e.getTime() - s.getTime()) / 86400000) + 1; // 포함 일수
    s.setDate(s.getDate() + dir * days);
    e.setDate(e.getDate() + dir * days);
    applyDate(toDateStr(s), toDateStr(e));
  };

  const loadDashboard = useCallback(async () => {
    setDashLoading(true);
    try { setDashboard(await resourceApi.dashboard(startDate, endDate)); }
    catch (e: any) { alert(e.message ?? "대시보드 로드 실패"); }
    finally { setDashLoading(false); }
  }, [startDate, endDate]);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  // 운영 현황 탭: 첫 방문 시 전체 펼치기 (저장된 값 없을 때만)
  useEffect(() => {
    if (dashboard.length === 0 || groups.length === 0) return;
    const hasSaved = (() => { try { return sessionStorage.getItem(DASH_DEPT_EXPANDED_KEY) !== null; } catch { return false; } })();
    if (!hasSaved) {
      const allIds = [
        ...groups.filter((g) => g.isDept || (!g.isDept && g.description !== "__all__" && g.name !== "전체")).map((g) => g.id),
        "__dash_unassigned__",
      ];
      const all = new Set<string>(allIds);
      setDashDeptExpanded(all);
      try { sessionStorage.setItem(DASH_DEPT_EXPANDED_KEY, JSON.stringify([...all])); } catch {}
    }
  }, [dashboard, groups]);

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
    setSelectedUserId(resource.userId ?? "");
    setUserSearchQuery("");
  };

  const handleSaveUserId = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userIdModal) return;
    setSavingUserId(true);
    try {
      await resourceApi.update(userIdModal.id, { userId: selectedUserId.trim() || null });
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

  // 비인력 자원 (장비·시설 등)
  const nonPersonResources = resources.filter((r) => r.type !== "PERSON");
  const nonPersonResourceMap = new Map(nonPersonResources.map((r) => [r.id, r]));
  const nonPersonUngrouped = ungrouped.filter((r) => r.type !== "PERSON");
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

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto px-6 pb-6">
        {/* 헤더 + 탭 — 헤더 밑 sticky (다른 메뉴와 통일) */}
        <div className="sticky top-14 z-30 bg-gray-50 -mx-6 px-6 pt-4 pb-0 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900">자원관리</h2>
        </div>

        {/* 탭 */}
        <div className="flex gap-1 border-b border-gray-200">
          {([
            { key: "attendance",  label: "전사근태" },
            { key: "dashboard",   label: "직원현황" },
            { key: "reservation", label: "공용자산 예약" },  // 공용자산예약 (2026-05-05)
            { key: "external",    label: "외부 자원" },        // 자원-모델-분리 PDCA Phase 3b-4b
            { key: "orgchart",    label: "조직도" },
            // 인력자원 탭 폐기 (2026-05-04) — /admin/users로 분리
            // 공용자산 마스터 탭 폐기 (2026-05-05) — /admin/equipment-resources로 이동
          ] as { key: ResourceTab; label: string }[]).map((t) => (
            <button key={t.key}
              onClick={() => { setResourceTab(t.key); try { sessionStorage.setItem(TAB_KEY, t.key); } catch {} }}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                resourceTab === t.key ? "border-blue-600 text-blue-600 dark:text-blue-400" : "border-transparent text-gray-500 hover:text-gray-700"
              }`}>
              {t.label}
            </button>
          ))}
        </div>
        </div>

        {/* 직원현황 탭 (구 운영 현황) */}
        {resourceTab === "dashboard" && (<div>
            {/* 날짜 필터 */}
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              {/* 빠른 기간 선택 (간트 방식) */}
              {[
                { label: "지난주", range: () => weekRange(-1) },
                { label: "이번주", range: () => weekRange(0) },
                { label: "다음주", range: () => weekRange(1) },
                { label: "이번주+다음주", range: () => { const a = weekRange(0); const b = weekRange(1); return { start: a.start, end: b.end }; } },
                { label: "이번달", range: () => monthRange(0) },
              ].map(({ label, range }) => (
                <button key={label} onClick={() => { const r = range(); applyDate(r.start, r.end); }}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-600 transition-colors whitespace-nowrap">
                  {label}
                </button>
              ))}
              <div className="h-4 w-px bg-gray-200 mx-1" />
              <span className="text-xs text-gray-400">범위</span>
              {/* 양쪽 화살표: 선택 구간 길이만큼 앞뒤 이동 */}
              <button onClick={() => shiftRange(-1)} disabled={!startDate || !endDate}
                title="구간 길이만큼 앞으로 이동"
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-blue-300 bg-blue-50 text-blue-600 font-bold hover:bg-blue-100 hover:border-blue-400 disabled:opacity-40 transition-colors dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-950">◀</button>
              <DateInput value={startDate} onChange={(e) => {
                setStartDate(e.target.value);
                try { sessionStorage.setItem(DASH_DATE_KEY, JSON.stringify({ startDate: e.target.value, endDate })); } catch {}
              }} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <span className="text-gray-400 text-sm">~</span>
              <DateInput value={endDate} onChange={(e) => {
                setEndDate(e.target.value);
                try { sessionStorage.setItem(DASH_DATE_KEY, JSON.stringify({ startDate, endDate: e.target.value })); } catch {}
              }} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <button onClick={() => shiftRange(1)} disabled={!startDate || !endDate}
                title="구간 길이만큼 뒤로 이동"
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-blue-300 bg-blue-50 text-blue-600 font-bold hover:bg-blue-100 hover:border-blue-400 disabled:opacity-40 transition-colors dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-950">▶</button>
              <div className="flex-1" />
              <button onClick={() => {
                const allIds = [
                  ...groups.filter((g) => g.isDept || (!g.isDept && g.description !== "__all__" && g.name !== "전체")).map((g) => g.id),
                  "__dash_unassigned__",
                ];
                const allOpen = allIds.every((id) => dashDeptExpanded.has(id));
                const next = allOpen ? new Set<string>() : new Set(allIds);
                setDashDeptExpanded(next);
                try { sessionStorage.setItem(DASH_DEPT_EXPANDED_KEY, JSON.stringify([...next])); } catch {};
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
                {/* 부하 색상 범례 — 스크롤해도 상단 고정 (부서별 중복 제거) */}
                <div className="sticky top-14 z-20 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm border border-gray-100 rounded-lg px-3 py-2 mb-2 shadow-sm">
                  <ResourceLoadLegend />
                </div>
                {(() => {
                  const deptGroups = groups
                    .filter((g) => g.isDept)
                    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
                  const customGroups = groups
                    .filter((g) => !g.isDept && g.description !== "__all__" && g.name !== "전체")
                    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
                  // 자원-모델-분리 PDCA Phase 3b-5: legacy resourceIds + polymorphic 모두 포함
                  const allGroupedIds = new Set(
                    [...deptGroups, ...customGroups].flatMap((g) => [
                      ...g.resourceIds,
                      ...(g.personUserIds ?? []),
                      ...(g.externalPersonIds ?? []),
                      ...(g.equipmentResourceIds ?? []),
                    ]),
                  );

                  const sections: { id: string; name: string; items: any[] }[] = [
                    ...deptGroups.map((g) => ({
                      id: g.id,
                      name: g.name,
                      items: dashboard.filter((r: any) => groupHasResource(g, r.resourceId)),
                    })),
                    ...customGroups.map((g) => ({
                      id: g.id,
                      name: g.name,
                      items: dashboard.filter((r: any) => groupHasResource(g, r.resourceId)),
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
                      <div key={section.id} className="mb-2">
                        <button
                          onClick={() => toggleDashDept(section.id)}
                          className="w-full flex items-center gap-2 px-4 py-3 bg-gray-50 rounded-xl border border-gray-200 text-left hover:bg-gray-100 transition-colors"
                        >
                          <span className="text-gray-400 text-xs">{isOpen ? "▾" : "▸"}</span>
                          <span className="font-semibold text-gray-700 text-sm">{section.name}</span>
                          <span className="text-xs text-gray-400">{section.items.length}명</span>
                        </button>
                        {isOpen && (
                          <div className="mt-1 px-2 pb-2 bg-white rounded-xl border border-gray-100">
                            <ResourceTimeline
                              rows={section.items.map((r: any) => ({
                                resourceId: r.resourceId,
                                resourceName: r.resourceName,
                                dailyCapacityHours: r.dailyCapacityHours,
                                totalAllocationPercent: r.totalAllocationPercent,
                                isOverloaded: r.isOverloaded,
                                dayBreakdown: r.dayBreakdown ?? [],
                                assignments: r.assignments ?? [],
                              }))}
                              startDate={startDate}
                              endDate={endDate}
                            />
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

        {/* 근태현황 탭 */}
        {resourceTab === "attendance" && (
          <AttendanceOverview holidays={holidays} />
        )}

        {/* 공용자산 예약 탭 (2026-05-05 신규) */}
        {resourceTab === "reservation" && (
          <ReservationContainer />
        )}

        {/* 외부 자원 탭 — 자원-모델-분리 PDCA Phase 3b-4b */}
        {resourceTab === "external" && (
          <ExternalPersonsPanel isAdmin={isAdmin} />
        )}

        {/* 조직도 탭 */}
        {resourceTab === "orgchart" && (
          <OrgChart />
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
              <button onClick={() => setCheckedIds(new Set(resources.map((r) => r.id)))} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">전체 선택</button>
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
                <label className="block text-sm font-medium text-gray-700 mb-1">자원이름 *</label>
                <input type="text" value={resourceForm.name}
                  onChange={(e) => setResourceForm({ ...resourceForm, name: e.target.value })}
                  required placeholder="압착기 A"
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
      {userIdModal && (() => {
        const linkedUserIds = new Set(resources.filter((r) => r.userId && r.id !== userIdModal.id).map((r) => r.userId));
        const filteredUsers = authUsers.filter((u) => {
          if (linkedUserIds.has(u.email)) return false;
          if (!userSearchQuery) return true;
          const q = userSearchQuery.toLowerCase();
          return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
        });
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
              <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                <h3 className="font-semibold text-gray-900">계정 연결 — {userIdModal.name}</h3>
                <button onClick={() => setUserIdModal(null)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
              </div>
              <form onSubmit={handleSaveUserId} className="p-6 space-y-4">
                <p className="text-xs text-gray-500">연결할 사용자 계정을 선택하세요.</p>
                <div>
                  <input
                    type="text" value={userSearchQuery}
                    onChange={(e) => setUserSearchQuery(e.target.value)}
                    placeholder="이름 또는 이메일로 검색..."
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm mb-2"
                  />
                  <div className="border border-gray-200 rounded-lg max-h-48 overflow-y-auto">
                    {/* 연결 해제 옵션 */}
                    <label className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50 border-b border-gray-100 ${!selectedUserId ? "bg-blue-50" : ""}`}>
                      <input type="radio" name="userId" value="" checked={!selectedUserId}
                        onChange={() => setSelectedUserId("")} className="text-blue-600" />
                      <span className="text-sm text-gray-400">연결 해제</span>
                    </label>
                    {filteredUsers.map((u) => (
                      <label key={u.id} className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50 ${selectedUserId === u.email ? "bg-blue-50" : ""}`}>
                        <input type="radio" name="userId" value={u.email} checked={selectedUserId === u.email}
                          onChange={() => setSelectedUserId(u.email)} className="text-blue-600" />
                        <div className="text-sm">
                          <span className="font-medium text-gray-900">{u.name}</span>
                          <span className="text-gray-400 ml-2">{u.email}</span>
                        </div>
                      </label>
                    ))}
                    {filteredUsers.length === 0 && (
                      <div className="px-3 py-4 text-center text-sm text-gray-400">검색 결과 없음</div>
                    )}
                  </div>
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
        );
      })()}

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
              className="text-xs text-blue-500 dark:text-blue-400 hover:text-blue-700 px-2 py-0.5 rounded hover:bg-blue-50 shrink-0 font-medium"
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
              <div className="p-3 space-y-0 bg-gray-50/40 dark:bg-gray-500/10">
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
                      className="text-blue-600 dark:text-blue-400 hover:text-blue-800 font-mono bg-blue-50 px-1.5 py-0.5 rounded max-w-[120px] truncate block"
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
