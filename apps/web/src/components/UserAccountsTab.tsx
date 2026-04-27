"use client";

import { useEffect, useRef, useState } from "react";
import { userManagementApi, departmentApi, resourceApi, workScheduleApi, getUser } from "@/lib/api";

interface User {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "MANAGER" | "OPERATOR" | "VIEWER";
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

interface Department { id: string; name: string; sortOrder?: number; }

const EMPTY_PROFILE = {
  phoneOffice: "", phoneMobile: "", address: "",
  departmentId: "", departmentName: "",
};

const ROLE_LABELS = { ADMIN: "관리자", MANAGER: "매니저", OPERATOR: "운영자", VIEWER: "조회자" };
const ROLES = ["ADMIN", "MANAGER", "OPERATOR", "VIEWER"] as const;

const EXPANDED_KEY = "erp_tab_users_expanded";

export default function UserAccountsTab({ onResourcesChanged }: { onResourcesChanged?: () => void }) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [resetId, setResetId] = useState<string | null>(null);

  // Create form
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<typeof ROLES[number]>("OPERATOR");
  const [newDeptId, setNewDeptId] = useState("");
  const [createError, setCreateError] = useState("");

  // Reset password
  const [newResetPw, setNewResetPw] = useState("");
  const [resetError, setResetError] = useState("");

  // Work schedule
  const [scheduleUserId, setScheduleUserId] = useState<string | null>(null);
  const [scheduleUserName, setScheduleUserName] = useState("");
  const [scheduleStart, setScheduleStart] = useState("09:30");
  const [scheduleEnd, setScheduleEnd] = useState("18:30");
  const [scheduleSaving, setScheduleSaving] = useState(false);

  // Profile edit
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [profileForm, setProfileForm] = useState(EMPTY_PROFILE);
  const [originalProfileForm, setOriginalProfileForm] = useState(EMPTY_PROFILE);
  const [profileError, setProfileError] = useState("");

  // Departments
  const [departments, setDepartments] = useState<Department[]>([]);
  const [showDeptMgmt, setShowDeptMgmt] = useState(false);
  const [newDeptName, setNewDeptName] = useState("");
  const [savingDept, setSavingDept] = useState(false);
  const dragDeptIdx = useRef<number | null>(null);
  const [dragOverDeptIdx, setDragOverDeptIdx] = useState<number | null>(null);
  const [editingDeptId, setEditingDeptId] = useState<string | null>(null);
  const [editingDeptName, setEditingDeptName] = useState("");

  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    setIsAdmin(getUser()?.role === "ADMIN");
    try {
      const saved = sessionStorage.getItem(EXPANDED_KEY);
      if (saved) setExpanded(new Set<string>(JSON.parse(saved)));
    } catch {}
  }, []);

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      try { sessionStorage.setItem(EXPANDED_KEY, JSON.stringify([...next])); } catch {}
      return next;
    });

  const load = async () => {
    setLoading(true);
    try {
      const [userData, depts] = await Promise.all([
        userManagementApi.list().catch(() => null),
        departmentApi.list().catch(() => []),
      ]);
      let userList: any[];
      if (userData) {
        userList = Array.isArray(userData) ? userData : ((userData as any).items ?? []);
      } else {
        // 비-관리자 폴백: 인증만 필요한 members 엔드포인트 사용 (read-only)
        const members = await userManagementApi.members(true).catch(() => []);
        userList = (members as any[]).map((m) => ({
          id: m.id,
          email: "",
          name: m.name,
          role: "OPERATOR",
          isActive: true,
          lastLoginAt: null,
          createdAt: "",
          profile: {
            departmentId: (m as any).departmentId ?? null,
            departmentName: (m as any).departmentName ?? null,
            position: (m as any).position ?? null,
          },
        }));
      }
      setUsers(userList);
      const flatten = (nodes: any[]): any[] => nodes.flatMap((n: any) => [n, ...flatten(n.children ?? [])]);
      setDepartments(
        flatten(depts as any[])
          .filter((d: any) => d.isActive !== false)
          .sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openSchedule = async (user: User) => {
    setScheduleUserName(user.name);
    const s = await workScheduleApi.get(user.id).catch(() => null);
    setScheduleStart(s?.workStartTime ?? "09:30");
    setScheduleEnd(s?.workEndTime ?? "18:30");
    setScheduleUserId(user.id);
  };

  const handleSaveSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scheduleUserId) return;
    setScheduleSaving(true);
    try {
      await workScheduleApi.set(scheduleUserId, { workStartTime: scheduleStart, workEndTime: scheduleEnd });
      setScheduleUserId(null);
    } catch (err: any) {
      alert(err.message ?? "저장 실패");
    } finally {
      setScheduleSaving(false);
    }
  };

  // 출근 시간 선택지: 07:00 ~ 11:00, 30분 단위
  const startOptions: string[] = [];
  for (let h = 7; h <= 11; h++)
    for (let m of [0, 30])
      startOptions.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);

  const openProfile = async (user: User) => {
    setProfileError("");
    try {
      const data = await userManagementApi.getProfile(user.id);
      const p = data.profile ?? {};
      const loaded = {
        phoneOffice:    p.phoneOffice    ?? "",
        phoneMobile:    p.phoneMobile    ?? "",
        address:        p.address        ?? "",
        departmentId:   p.departmentId   ?? "",
        departmentName: p.departmentName ?? "",
      };
      setProfileForm(loaded);
      setOriginalProfileForm(loaded);
    } catch {
      setProfileForm(EMPTY_PROFILE);
      setOriginalProfileForm(EMPTY_PROFILE);
    }
    setProfileUserId(user.id);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileUserId) return;
    setProfileError("");
    setSaving(true);
    try {
      await userManagementApi.upsertProfile(profileUserId, {
        phoneOffice:    profileForm.phoneOffice    || null,
        phoneMobile:    profileForm.phoneMobile    || null,
        address:        profileForm.address        || null,
        departmentId:   profileForm.departmentId   || null,
        departmentName: profileForm.departmentName || null,
      });
      setProfileUserId(null);
    } catch (err: any) {
      setProfileError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleAddDept = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDeptName.trim()) return;
    setSavingDept(true);
    try {
      const code = "DEPT_" + Date.now().toString(36).toUpperCase();
      await departmentApi.create({ name: newDeptName.trim(), code, level: 2, sortOrder: departments.length });
      setNewDeptName("");
      const depts = await departmentApi.list().catch(() => []);
      const flatten = (nodes: any[]): any[] => nodes.flatMap((n: any) => [n, ...flatten(n.children ?? [])]);
      setDepartments(flatten(depts as any[]).filter((d: any) => d.isActive !== false).sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)));
      onResourcesChanged?.();
    } catch (err: any) {
      alert(err.message ?? "부서 추가 실패");
    } finally {
      setSavingDept(false);
    }
  };

  const handleDeptDrop = async (toIdx: number) => {
    const fromIdx = dragDeptIdx.current;
    setDragOverDeptIdx(null);
    if (fromIdx === null || fromIdx === toIdx) return;
    const reordered = [...departments];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    setDepartments(reordered);
    dragDeptIdx.current = null;
    try {
      await Promise.all(reordered.map((d, i) => departmentApi.update(d.id, { sortOrder: i })));
    } catch { /* 다음 load()에서 복구 */ }
  };

  const handleRenameDept = async (dept: Department) => {
    const name = editingDeptName.trim();
    if (!name || name === dept.name) { setEditingDeptId(null); return; }
    try {
      await departmentApi.update(dept.id, { name });
      setDepartments((prev) => prev.map((d) => d.id === dept.id ? { ...d, name } : d));
    } catch (err: any) {
      alert(err.message ?? "이름 변경 실패");
    } finally {
      setEditingDeptId(null);
    }
  };

  const handleDeleteDept = async (dept: Department) => {
    if (!confirm(`"${dept.name}" 부서를 삭제할까요?`)) return;
    try {
      await departmentApi.delete(dept.id);
      setDepartments((prev) => prev.filter((d) => d.id !== dept.id));
      onResourcesChanged?.();
    } catch (err: any) {
      alert(err.message ?? "삭제 실패");
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError("");
    setSaving(true);
    try {
      const created = await userManagementApi.create({ email: newEmail, name: newName, password: newPassword, role: newRole });
      if (newDeptId) {
        const dept = departments.find((d) => d.id === newDeptId);
        await userManagementApi.upsertProfile(created.id, {
          departmentId: newDeptId,
          departmentName: dept?.name ?? "",
          phoneOffice: null, phoneMobile: null, address: null,
        }).catch(() => {});
      }
      setShowCreate(false);
      setNewEmail(""); setNewName(""); setNewPassword(""); setNewRole("OPERATOR"); setNewDeptId("");
      await load();
      onResourcesChanged?.();
    } catch (err: any) {
      setCreateError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (user: User) => {
    await userManagementApi.update(user.id, { isActive: !user.isActive });
    load();
  };

  const handleRoleChange = async (user: User, role: typeof ROLES[number]) => {
    await userManagementApi.update(user.id, { role });
    setEditingId(null);
    load();
  };

  const handleDelete = async (user: User) => {
    if (!confirm(`"${user.name}" 계정을 삭제할까요? 이 작업은 되돌릴 수 없습니다.`)) return;
    try {
      await userManagementApi.delete(user.id);
      await load();
      onResourcesChanged?.();
    } catch (err: any) {
      alert(err.message ?? "삭제 실패");
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetId) return;
    setResetError("");
    setSaving(true);
    try {
      await userManagementApi.resetPassword(resetId, newResetPw);
      setResetId(null);
      setNewResetPw("");
    } catch (err: any) {
      setResetError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  const allDeptIds = [...departments.map((d) => d.id), "__unassigned__"];
  const allOpen = allDeptIds.every((id) => expanded.has(id));

  return (
    <div>
      {/* 툴바 */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-sm text-gray-500">전체 {users.length}명</span>
        <div className="flex-1" />
        <button
          onClick={() => setExpanded(allOpen ? new Set() : new Set(allDeptIds))}
          className="border border-gray-300 text-gray-700 px-3 py-1.5 rounded-lg text-sm hover:bg-gray-50"
        >
          {allOpen ? "전체 닫기" : "전체 펼치기"}
        </button>
        {isAdmin && (
          <>
            <button
              onClick={() => setShowDeptMgmt(true)}
              className="border border-gray-300 text-gray-700 px-3 py-1.5 rounded-lg text-sm hover:bg-gray-50"
            >
              🏢 부서 관리
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700"
            >
              + 인력 추가
            </button>
          </>
        )}
      </div>

      {/* 사용자 트리 */}
      <div className="space-y-0.5">
        {departments.filter((dept) => users.some((u) => (u as any).profile?.departmentId === dept.id)).map((dept) => {
          const deptUsers = users.filter((u) => (u as any).profile?.departmentId === dept.id);
          const isOpen = expanded.has(dept.id);
          return (
            <div key={dept.id} className="mb-0.5">
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <button
                  onClick={() => toggleExpand(dept.id)}
                  className="w-full flex items-center gap-2 px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
                >
                  <span className="text-gray-400 text-xs w-4 text-center select-none">{isOpen ? "▾" : "▸"}</span>
                  <span className="text-sm font-semibold text-gray-700">{dept.name}</span>
                  <span className="text-xs text-gray-400 font-normal">{deptUsers.length}명</span>
                </button>
                {isOpen && deptUsers.length > 0 && (
                  <div className="divide-y divide-gray-100">
                    {deptUsers.map((user) => (
                      <UserRow key={user.id} user={user} departments={departments}
                        editingId={editingId} setEditingId={setEditingId}
                        onToggleActive={handleToggleActive} onRoleChange={handleRoleChange}
                        onOpenProfile={openProfile} onOpenSchedule={openSchedule}
                        onResetPw={(u) => { setResetId(u.id); setNewResetPw(""); setResetError(""); }}
                        onDelete={handleDelete} isAdmin={isAdmin} />
                    ))}
                  </div>
                )}
                {isOpen && deptUsers.length === 0 && (
                  <div className="pl-10 pr-4 py-3 text-xs text-gray-300">소속 사용자 없음</div>
                )}
              </div>
            </div>
          );
        })}

        {/* 미분류 */}
        {(() => {
          const deptIds = new Set(departments.map((d) => d.id));
          const unassigned = users.filter((u) => {
            const deptId = (u as any).profile?.departmentId;
            return !deptId || !deptIds.has(deptId);
          });
          if (unassigned.length === 0) return null;
          const isOpen = expanded.has("__unassigned__");
          return (
            <div className="mb-0.5 mt-3">
              <div className="bg-white rounded-xl border border-dashed border-gray-300 overflow-hidden">
                <button
                  onClick={() => toggleExpand("__unassigned__")}
                  className="w-full flex items-center gap-2 px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
                >
                  <span className="text-gray-400 text-xs w-4 text-center select-none">{isOpen ? "▾" : "▸"}</span>
                  <span className="text-sm font-semibold text-gray-500">📂 미분류</span>
                  <span className="text-xs text-gray-400">{unassigned.length}명</span>
                </button>
                {isOpen && (
                  <div className="divide-y divide-gray-100">
                    {unassigned.map((user) => (
                      <UserRow key={user.id} user={user} departments={departments}
                        editingId={editingId} setEditingId={setEditingId}
                        onToggleActive={handleToggleActive} onRoleChange={handleRoleChange}
                        onOpenProfile={openProfile} onOpenSchedule={openSchedule}
                        onResetPw={(u) => { setResetId(u.id); setNewResetPw(""); setResetError(""); }}
                        onDelete={handleDelete} isAdmin={isAdmin} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </div>

      {/* ── 사용자 추가 모달 ── */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md">
            <h2 className="text-lg font-bold text-gray-900 mb-4">사용자 추가</h2>
            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">이름</label>
                <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="홍길동" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">이메일</label>
                <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="user@example.com" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">임시 비밀번호</label>
                <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="8자 이상" minLength={8} required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">역할</label>
                <select value={newRole} onChange={(e) => setNewRole(e.target.value as typeof ROLES[number])}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">부서</label>
                <select value={newDeptId} onChange={(e) => setNewDeptId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  <option value="">— 부서 없음 —</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              {createError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{createError}</div>
              )}
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setShowCreate(false)}
                  className="flex-1 border border-gray-300 rounded-lg py-2 text-sm text-gray-700 hover:bg-gray-50">취소</button>
                <button type="submit" disabled={saving}
                  className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {saving ? "생성 중..." : "생성"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── 개인정보 편집 모달 ── */}
      {profileUserId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">개인정보 편집</h2>
              <button onClick={() => setProfileUserId(null)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <form onSubmit={handleSaveProfile} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">부서</label>
                <select value={profileForm.departmentId}
                  onChange={(e) => {
                    const dept = departments.find((d) => d.id === e.target.value);
                    setProfileForm({ ...profileForm, departmentId: e.target.value, departmentName: dept?.name ?? "" });
                  }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  <option value="">— 부서 없음 —</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">사내 전화</label>
                <input type="text" value={profileForm.phoneOffice}
                  onChange={(e) => setProfileForm({ ...profileForm, phoneOffice: e.target.value })}
                  placeholder="02-0000-0000" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">휴대폰</label>
                <input type="text" value={profileForm.phoneMobile}
                  onChange={(e) => setProfileForm({ ...profileForm, phoneMobile: e.target.value })}
                  placeholder="010-0000-0000" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">자택 주소</label>
                <input type="text" value={profileForm.address}
                  onChange={(e) => setProfileForm({ ...profileForm, address: e.target.value })}
                  placeholder="서울시 강남구..." className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              {profileError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2 cursor-pointer hover:bg-red-100"
                  onClick={() => { setProfileForm(originalProfileForm); setProfileError(""); }}>
                  {profileError} <span className="underline text-xs ml-1">되돌리기</span>
                </div>
              )}
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setProfileUserId(null)}
                  className="flex-1 border border-gray-300 rounded-lg py-2 text-sm text-gray-700 hover:bg-gray-50">취소</button>
                <button type="submit" disabled={saving}
                  className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {saving ? "저장 중..." : "저장"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── 부서 관리 모달 ── */}
      {showDeptMgmt && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">🏢 부서 관리</h2>
              <button onClick={() => setShowDeptMgmt(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="p-6 space-y-4">
              <form onSubmit={handleAddDept} className="flex gap-2">
                <input type="text" value={newDeptName} onChange={(e) => setNewDeptName(e.target.value)}
                  placeholder="새 부서명" className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                <button type="submit" disabled={savingDept || !newDeptName.trim()}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  추가
                </button>
              </form>
              <div className="space-y-1 max-h-60 overflow-y-auto">
                {departments.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">등록된 부서가 없습니다.</p>
                ) : departments.map((dept, idx) => (
                  <div key={dept.id}>
                    {dragOverDeptIdx === idx && dragDeptIdx.current !== idx && (
                      <div className="relative h-0.5 bg-blue-500 rounded-full mx-1 my-0.5">
                        <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-blue-500" />
                        <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-2 h-2 rounded-full bg-blue-500" />
                      </div>
                    )}
                    <div draggable
                      onDragStart={() => { dragDeptIdx.current = idx; }}
                      onDragOver={(e) => { e.preventDefault(); setDragOverDeptIdx(idx); }}
                      onDragLeave={() => setDragOverDeptIdx(null)}
                      onDrop={() => handleDeptDrop(idx)}
                      onDragEnd={() => { dragDeptIdx.current = null; setDragOverDeptIdx(null); }}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-default transition-opacity ${
                        dragDeptIdx.current === idx ? "opacity-40 bg-gray-50" : "bg-gray-50"
                      }`}
                    >
                      <span className="text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing select-none text-lg leading-none">⠿</span>
                      {editingDeptId === dept.id ? (
                        <input autoFocus value={editingDeptName}
                          onChange={(e) => setEditingDeptName(e.target.value)}
                          onBlur={() => handleRenameDept(dept)}
                          onKeyDown={(e) => { if (e.key === "Enter") handleRenameDept(dept); if (e.key === "Escape") setEditingDeptId(null); }}
                          className="flex-1 text-sm border border-blue-400 rounded px-2 py-0.5 outline-none"
                          onClick={(e) => e.stopPropagation()} />
                      ) : (
                        <span className="text-sm text-gray-800 flex-1 cursor-pointer hover:text-blue-600"
                          onClick={(e) => { e.stopPropagation(); setEditingDeptId(dept.id); setEditingDeptName(dept.name); }}>
                          {dept.name}
                        </span>
                      )}
                      <button onClick={() => handleDeleteDept(dept)} className="text-xs text-red-400 hover:text-red-600">삭제</button>
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={() => setShowDeptMgmt(false)}
                className="w-full border border-gray-300 rounded-lg py-2 text-sm text-gray-700 hover:bg-gray-50">닫기</button>
            </div>
          </div>
        </div>
      )}

      {/* ── 근무시간 설정 모달 ── */}
      {scheduleUserId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
            <h2 className="text-lg font-bold text-gray-900 mb-1">근무시간 설정</h2>
            <p className="text-xs text-gray-400 mb-4">{scheduleUserName} · 30분 단위 · 기본: 09:30~18:30</p>
            <form onSubmit={handleSaveSchedule} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">출근 시간</label>
                  <select value={scheduleStart} onChange={(e) => {
                    const start = e.target.value;
                    const [h, m] = start.split(":").map(Number);
                    const endH = h + 9, endM = m;
                    setScheduleStart(start);
                    setScheduleEnd(`${String(endH).padStart(2,"0")}:${String(endM).padStart(2,"0")}`);
                  }} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
                    {startOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">퇴근 시간</label>
                  <input type="text" value={scheduleEnd} readOnly
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500" />
                </div>
              </div>
              <p className="text-xs text-gray-400">퇴근 시간은 출근 시간 +9시간으로 자동 계산됩니다.</p>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setScheduleUserId(null)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">취소</button>
                <button type="submit" disabled={scheduleSaving}
                  className="flex-1 bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-purple-700 disabled:opacity-50">
                  {scheduleSaving ? "저장 중..." : "저장"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── 비밀번호 초기화 모달 ── */}
      {resetId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
            <h2 className="text-lg font-bold text-gray-900 mb-4">비밀번호 초기화</h2>
            <form onSubmit={handleResetPassword} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">새 비밀번호</label>
                <input type="password" value={newResetPw} onChange={(e) => setNewResetPw(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="8자 이상" minLength={8} required autoFocus />
              </div>
              {resetError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{resetError}</div>
              )}
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setResetId(null)}
                  className="flex-1 border border-gray-300 rounded-lg py-2 text-sm text-gray-700 hover:bg-gray-50">취소</button>
                <button type="submit" disabled={saving}
                  className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {saving ? "처리 중..." : "초기화"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 사용자 행 (부서 목록 + 미분류 공통 사용) ──────────────────────────────────

function UserRow({ user, departments, editingId, setEditingId, onToggleActive, onRoleChange, onOpenProfile, onOpenSchedule, onResetPw, onDelete, isAdmin }: {
  user: User;
  departments: Department[];
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  onToggleActive: (u: User) => void;
  onRoleChange: (u: User, r: typeof ROLES[number]) => void;
  onOpenProfile: (u: User) => void;
  onOpenSchedule: (u: User) => void;
  onResetPw: (u: User) => void;
  onDelete: (u: User) => void;
  isAdmin?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 pl-10 pr-4 py-2.5 hover:bg-gray-50">
      <span className="font-medium text-gray-900 text-sm whitespace-nowrap w-16 flex items-center gap-1">
        {user.name}
        {(user as any).isOnline && <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" title="접속중" />}
      </span>
      {isAdmin && (
        <span className="text-gray-400 text-xs whitespace-nowrap w-36" title={user.email}>
          {user.email.length > 15 ? user.email.slice(0, 15) + "…" : user.email}
        </span>
      )}
      {isAdmin && (
        <span className="w-16">
          {editingId === user.id ? (
            <select defaultValue={user.role}
              onChange={(e) => onRoleChange(user, e.target.value as typeof ROLES[number])}
              onBlur={() => setEditingId(null)} autoFocus
              className="border border-gray-300 rounded px-1 py-0.5 text-xs w-full">
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          ) : (
            <button onClick={() => setEditingId(user.id)} className="text-blue-600 hover:underline text-xs">
              {ROLE_LABELS[user.role]}
            </button>
          )}
        </span>
      )}
      {isAdmin && (
        <span className="w-14">
          <button onClick={() => onToggleActive(user)}
            className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${user.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
            {user.isActive ? "활성" : "비활성"}
          </button>
        </span>
      )}
      {isAdmin && (
        <span className="text-gray-400 text-xs whitespace-nowrap w-20">
          {user.lastLoginAt
            ? new Date(user.lastLoginAt).toLocaleString("ko-KR", { year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
            : "미접속"}
        </span>
      )}
      <span className="flex-1" />
      {isAdmin && (
        <div className="flex items-center gap-3 whitespace-nowrap">
          <button onClick={() => onOpenProfile(user)} className="text-xs text-blue-600 hover:text-blue-800 font-medium">개인정보</button>
          <button onClick={() => onOpenSchedule(user)} className="text-xs text-purple-600 hover:text-purple-800 font-medium">근무시간</button>
          <button onClick={() => onResetPw(user)} className="text-xs text-gray-400 hover:text-gray-600">비밀번호</button>
          <button onClick={() => onDelete(user)} className="text-xs text-red-400 hover:text-red-600">삭제</button>
        </div>
      )}
    </div>
  );
}
