"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { userManagementApi, departmentApi, resourceApi, getUser } from "@/lib/api";

interface User {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "MANAGER" | "OPERATOR" | "VIEWER";
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

interface Department { id: string; name: string; }

const EMPTY_PROFILE = {
  phoneOffice: "", phoneMobile: "", address: "",
  departmentId: "", departmentName: "",
};

const ROLE_LABELS = { ADMIN: "관리자", MANAGER: "매니저", OPERATOR: "운영자", VIEWER: "조회자" };
const ROLES = ["ADMIN", "MANAGER", "OPERATOR", "VIEWER"] as const;

export default function UsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [resetId, setResetId] = useState<string | null>(null);

  // Create form state
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<typeof ROLES[number]>("OPERATOR");
  const [createError, setCreateError] = useState("");

  // Reset password state
  const [newResetPw, setNewResetPw] = useState("");
  const [resetError, setResetError] = useState("");

  // Profile edit state
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [profileForm, setProfileForm] = useState(EMPTY_PROFILE);
  const [originalProfileForm, setOriginalProfileForm] = useState(EMPTY_PROFILE);
  const [profileError, setProfileError] = useState("");

  // Departments (= resource groups)
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
  const [mainTab, setMainTab] = useState<"users" | "assets">("users");

  // 비인력 자원 (장비/차량/시설)
  const [assets, setAssets] = useState<any[]>([]);
  const [showCreateAsset, setShowCreateAsset] = useState(false);
  const [assetForm, setAssetForm] = useState({ name: "", type: "EQUIPMENT", dailyCapacityHours: 8 });
  const [savingAsset, setSavingAsset] = useState(false);
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null);
  const [editingAssetName, setEditingAssetName] = useState("");

  const toggleExpand = (id: string) =>
    setExpanded((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });

  // Access control
  useEffect(() => {
    const user = getUser();
    if (!user || user.role !== "ADMIN") {
      router.replace("/projects");
    }
  }, [router]);

  const load = async () => {
    try {
      const [userData, depts, allResources] = await Promise.all([
        userManagementApi.list(),
        departmentApi.list().catch(() => []),
        resourceApi.list().catch(() => []),
      ]);
      setUsers(userData.items);
      const flatten = (nodes: any[]): any[] => nodes.flatMap((n: any) => [n, ...flatten(n.children ?? [])]);
      setDepartments(flatten(depts as any[]).filter((d: any) => d.isActive !== false).sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)));
      setAssets((allResources as any[]).filter((r) => r.type !== "PERSON"));
      setExpanded((prev) => prev);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

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
      const flatten2 = (nodes: any[]): any[] => nodes.flatMap((n: any) => [n, ...flatten2(n.children ?? [])]);
      setDepartments(flatten2(depts as any[]).filter((d: any) => d.isActive !== false).sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)));
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
      await Promise.all(
        reordered.map((d, i) => departmentApi.update(d.id, { sortOrder: i }))
      );
    } catch { /* 실패 시 다음 load()에서 복구 */ }
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
    } catch (err: any) {
      alert(err.message ?? "삭제 실패");
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError("");
    setSaving(true);
    try {
      await userManagementApi.create({ email: newEmail, name: newName, password: newPassword, role: newRole });
      setShowCreate(false);
      setNewEmail(""); setNewName(""); setNewPassword(""); setNewRole("OPERATOR");
      load();
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
      load();
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
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500">로딩 중...</div>
      </div>
    );
  }

  const TYPE_LABELS: Record<string, string> = {
    EQUIPMENT: "장비",
    VEHICLE: "차량",
    FACILITY: "시설",
  };
  const ASSET_TYPES = ["EQUIPMENT", "VEHICLE", "FACILITY"] as const;

  const handleCreateAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingAsset(true);
    try {
      await resourceApi.create({ name: assetForm.name, type: assetForm.type, dailyCapacityHours: assetForm.dailyCapacityHours });
      setShowCreateAsset(false);
      setAssetForm({ name: "", type: "EQUIPMENT", dailyCapacityHours: 8 });
      const allResources = await resourceApi.list().catch(() => []);
      setAssets((allResources as any[]).filter((r) => r.type !== "PERSON"));
    } catch (err: any) {
      alert(err.message ?? "자원 추가 실패");
    } finally {
      setSavingAsset(false);
    }
  };

  const handleRenameAsset = async (asset: any) => {
    const name = editingAssetName.trim();
    setEditingAssetId(null);
    if (!name || name === asset.name) return;
    try {
      await resourceApi.update(asset.id, { name });
      setAssets((prev) => prev.map((a) => a.id === asset.id ? { ...a, name } : a));
    } catch (err: any) {
      alert(err.message ?? "이름 변경 실패");
    }
  };

  const handleToggleAssetActive = async (asset: any) => {
    try {
      await resourceApi.update(asset.id, { isActive: !asset.isActive });
      setAssets((prev) => prev.map((a) => a.id === asset.id ? { ...a, isActive: !asset.isActive } : a));
    } catch (err: any) {
      alert(err.message ?? "상태 변경 실패");
    }
  };

  const handleUpdateAssetHours = async (asset: any, hours: number) => {
    try {
      await resourceApi.update(asset.id, { dailyCapacityHours: hours });
      setAssets((prev) => prev.map((a) => a.id === asset.id ? { ...a, dailyCapacityHours: hours } : a));
    } catch (err: any) {
      alert(err.message ?? "수정 실패");
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">사용자 관리</h1>
          <p className="text-sm text-gray-500 mt-1">
            {mainTab === "users" ? `전체 ${users.length}명` : `비인력 자원 ${assets.length}개`}
          </p>
        </div>
        <div className="flex gap-2">
          {mainTab === "users" && (
            <>
              <button
                onClick={() => {
                  const allIds = [...departments.map((d) => d.id), "__unassigned__"];
                  const allOpen = allIds.every((id) => expanded.has(id));
                  setExpanded(allOpen ? new Set() : new Set(allIds));
                }}
                className="border border-gray-300 text-gray-700 px-3 py-2 rounded-lg text-sm hover:bg-gray-50"
              >
                {[...departments.map((d) => d.id), "__unassigned__"].every((id) => expanded.has(id)) ? "전체 닫기" : "전체 펼치기"}
              </button>
              <button
                onClick={() => setShowDeptMgmt(true)}
                className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50"
              >
                🏢 부서 관리
              </button>
              <button
                onClick={() => setShowCreate(true)}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
              >
                + 사용자 추가
              </button>
            </>
          )}
          {mainTab === "assets" && (
            <button
              onClick={() => setShowCreateAsset(true)}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
            >
              + 자원 추가
            </button>
          )}
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 mb-5 border-b border-gray-200">
        {([["users", "사용자"], ["assets", "기타 자원"]] as const).map(([tab, label]) => (
          <button
            key={tab}
            onClick={() => setMainTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              mainTab === tab
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Assets tab */}
      {mainTab === "assets" && (
        <div className="space-y-1">
          {(["EQUIPMENT", "VEHICLE", "FACILITY"] as const).map((type) => {
            const typeAssets = assets.filter((a) => a.type === type);
            const typeLabel = TYPE_LABELS[type];
            const icon = type === "EQUIPMENT" ? "🔧" : type === "VEHICLE" ? "🚗" : "🏭";
            return (
              <div key={type} className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-1">
                <div className="flex items-center gap-2 px-4 py-3 bg-gray-50 border-b border-gray-100">
                  <span className="text-sm font-semibold text-gray-700">{icon} {typeLabel}</span>
                  <span className="text-xs text-gray-400">{typeAssets.length}개</span>
                </div>
                {typeAssets.length === 0 ? (
                  <div className="px-4 py-3 text-xs text-gray-300">등록된 {typeLabel} 없음</div>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {typeAssets.map((asset) => (
                      <div key={asset.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50">
                        {editingAssetId === asset.id ? (
                          <input
                            autoFocus
                            value={editingAssetName}
                            onChange={(e) => setEditingAssetName(e.target.value)}
                            onBlur={() => handleRenameAsset(asset)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleRenameAsset(asset);
                              if (e.key === "Escape") setEditingAssetId(null);
                            }}
                            className="font-medium text-gray-900 text-sm border border-blue-400 rounded px-2 py-0.5 w-40 outline-none"
                          />
                        ) : (
                          <span
                            className="font-medium text-gray-900 text-sm w-40 cursor-pointer hover:text-blue-600"
                            onClick={() => { setEditingAssetId(asset.id); setEditingAssetName(asset.name); }}
                          >
                            {asset.name}
                          </span>
                        )}
                        <span className="text-xs text-gray-400 w-20">
                          일 {asset.dailyCapacityHours}h
                          <button
                            onClick={() => {
                              const v = prompt("일일 가용 시간(h)", String(asset.dailyCapacityHours));
                              if (v === null) return;
                              const n = parseFloat(v);
                              if (!isNaN(n) && n > 0) handleUpdateAssetHours(asset, n);
                            }}
                            className="ml-1 text-gray-300 hover:text-gray-500"
                          >✏️</button>
                        </span>
                        <button
                          onClick={() => handleToggleAssetActive(asset)}
                          className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${asset.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}
                        >
                          {asset.isActive ? "활성" : "비활성"}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* User tree */}
      {mainTab === "users" && (
      <div className="space-y-0.5">
        {departments.map((dept) => {
          const deptUsers = users.filter((u) => (u as any).profile?.departmentId === dept.id);
          const isOpen = expanded.has(dept.id);
          return (
            <div key={dept.id} className="mb-0.5">
              {/* 부서 헤더 */}
              <div
                className="bg-white rounded-xl border border-gray-200 overflow-hidden"
              >
                <button
                  onClick={() => toggleExpand(dept.id)}
                  className="w-full flex items-center gap-2 px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
                >
                  <span className="text-gray-400 text-xs w-4 text-center select-none">
                    {isOpen ? "▾" : "▸"}
                  </span>
                  <span className="text-sm font-semibold text-gray-700">{dept.name}</span>
                  <span className="text-xs text-gray-400 font-normal">{deptUsers.length}명</span>
                </button>

                {/* 사용자 행 */}
                {isOpen && deptUsers.length > 0 && (
                  <div className="divide-y divide-gray-100">
                    {deptUsers.map((user) => (
                      <div key={user.id} className="flex items-center gap-3 pl-10 pr-4 py-2.5 hover:bg-gray-50">
                        <span className="font-medium text-gray-900 text-sm whitespace-nowrap w-16 flex items-center gap-1">
                          {user.name}
                          {(user as any).isOnline && <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" title="접속중" />}
                        </span>
                        <span className="text-gray-400 text-xs whitespace-nowrap w-36" title={user.email}>
                          {user.email.length > 15 ? user.email.slice(0, 15) + "…" : user.email}
                        </span>
                        <span className="w-16">
                          {editingId === user.id ? (
                            <select
                              defaultValue={user.role}
                              onChange={(e) => handleRoleChange(user, e.target.value as typeof ROLES[number])}
                              onBlur={() => setEditingId(null)}
                              autoFocus
                              className="border border-gray-300 rounded px-1 py-0.5 text-xs w-full"
                            >
                              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                            </select>
                          ) : (
                            <button onClick={() => setEditingId(user.id)} className="text-blue-600 hover:underline text-xs">
                              {ROLE_LABELS[user.role]}
                            </button>
                          )}
                        </span>
                        <span className="w-14">
                          <button
                            onClick={() => handleToggleActive(user)}
                            className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${user.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}
                          >
                            {user.isActive ? "활성" : "비활성"}
                          </button>
                        </span>
                        <span className="text-gray-400 text-xs whitespace-nowrap w-20">
                          {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString("ko-KR", { year:"2-digit", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:false }) : "미접속"}
                        </span>
                        <span className="flex-1" />
                        <div className="flex items-center gap-3 whitespace-nowrap">
                          <button onClick={() => openProfile(user)} className="text-xs text-blue-600 hover:text-blue-800 font-medium">개인정보</button>
                          <button onClick={() => { setResetId(user.id); setNewResetPw(""); setResetError(""); }} className="text-xs text-gray-400 hover:text-gray-600">비밀번호</button>
                          <button onClick={() => handleDelete(user)} className="text-xs text-red-400 hover:text-red-600">삭제</button>
                        </div>
                      </div>
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
            <div className="mb-0.5" style={{ marginTop: 12 }}>
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
                      <div key={user.id} className="flex items-center gap-3 pl-10 pr-4 py-2.5 hover:bg-gray-50">
                        <span className="font-medium text-gray-900 text-sm whitespace-nowrap w-16 flex items-center gap-1">
                          {user.name}
                          {(user as any).isOnline && <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" title="접속중" />}
                        </span>
                        <span className="text-gray-400 text-xs whitespace-nowrap w-36" title={user.email}>
                          {user.email.length > 15 ? user.email.slice(0, 15) + "…" : user.email}
                        </span>
                        <span className="w-16">
                          {editingId === user.id ? (
                            <select defaultValue={user.role}
                              onChange={(e) => handleRoleChange(user, e.target.value as typeof ROLES[number])}
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
                        <span className="w-14">
                          <button onClick={() => handleToggleActive(user)}
                            className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${user.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                            {user.isActive ? "활성" : "비활성"}
                          </button>
                        </span>
                        <span className="text-gray-400 text-xs whitespace-nowrap w-20">
                          {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString("ko-KR", { year:"2-digit", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:false }) : "미접속"}
                        </span>
                        <span className="flex-1" />
                        <div className="flex items-center gap-3 whitespace-nowrap">
                          <button onClick={() => openProfile(user)} className="text-xs text-blue-600 hover:text-blue-800 font-medium">개인정보</button>
                          <button onClick={() => { setResetId(user.id); setNewResetPw(""); setResetError(""); }} className="text-xs text-gray-400 hover:text-gray-600">비밀번호</button>
                          <button onClick={() => handleDelete(user)} className="text-xs text-red-400 hover:text-red-600">삭제</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </div>
      )}

      {/* Create asset modal */}
      {showCreateAsset && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
            <h2 className="text-lg font-bold text-gray-900 mb-4">자원 추가</h2>
            <form onSubmit={handleCreateAsset} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">이름</label>
                <input
                  type="text"
                  value={assetForm.name}
                  onChange={(e) => setAssetForm({ ...assetForm, name: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="예) 굴삭기 1호, 1톤 트럭"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">종류</label>
                <select
                  value={assetForm.type}
                  onChange={(e) => setAssetForm({ ...assetForm, type: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                >
                  {ASSET_TYPES.map((t) => (
                    <option key={t} value={t}>{TYPE_LABELS[t]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">일일 가용 시간 (h)</label>
                <input
                  type="number"
                  min={1}
                  max={24}
                  value={assetForm.dailyCapacityHours}
                  onChange={(e) => setAssetForm({ ...assetForm, dailyCapacityHours: Number(e.target.value) })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateAsset(false)}
                  className="flex-1 border border-gray-300 rounded-lg py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={savingAsset}
                  className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {savingAsset ? "추가 중..." : "추가"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create user modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md">
            <h2 className="text-lg font-bold text-gray-900 mb-4">사용자 추가</h2>
            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">이름</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="홍길동"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">이메일</label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="user@example.com"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">임시 비밀번호</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="8자 이상"
                  minLength={8}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">역할</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as typeof ROLES[number])}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                >
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
              </div>
              {createError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">
                  {createError}
                </div>
              )}
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="flex-1 border border-gray-300 rounded-lg py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? "생성 중..." : "생성"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Profile edit modal */}
      {profileUserId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">개인정보 편집</h2>
              <button onClick={() => setProfileUserId(null)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <form onSubmit={handleSaveProfile} className="p-6 space-y-4">
              {/* 부서 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">부서</label>
                <select
                  value={profileForm.departmentId}
                  onChange={(e) => {
                    const dept = departments.find((d) => d.id === e.target.value);
                    setProfileForm({ ...profileForm, departmentId: e.target.value, departmentName: dept?.name ?? "" });
                  }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">— 부서 없음 —</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
              {/* 사내 전화 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">사내 전화</label>
                <input
                  type="text" value={profileForm.phoneOffice}
                  onChange={(e) => setProfileForm({ ...profileForm, phoneOffice: e.target.value })}
                  placeholder="02-0000-0000"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              {/* 휴대폰 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">휴대폰</label>
                <input
                  type="text" value={profileForm.phoneMobile}
                  onChange={(e) => setProfileForm({ ...profileForm, phoneMobile: e.target.value })}
                  placeholder="010-0000-0000"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              {/* 자택 주소 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">자택 주소</label>
                <input
                  type="text" value={profileForm.address}
                  onChange={(e) => setProfileForm({ ...profileForm, address: e.target.value })}
                  placeholder="서울시 강남구..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              {profileError && (
                <div
                  className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2 cursor-pointer hover:bg-red-100"
                  title="클릭하면 원래 값으로 되돌립니다"
                  onClick={() => { setProfileForm(originalProfileForm); setProfileError(""); }}
                >
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

      {/* Department management modal */}
      {showDeptMgmt && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">🏢 부서 관리</h2>
              <button onClick={() => setShowDeptMgmt(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="p-6 space-y-4">
              {/* 부서 추가 */}
              <form onSubmit={handleAddDept} className="flex gap-2">
                <input
                  type="text" value={newDeptName}
                  onChange={(e) => setNewDeptName(e.target.value)}
                  placeholder="새 부서명"
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
                <button type="submit" disabled={savingDept || !newDeptName.trim()}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  추가
                </button>
              </form>
              {/* 부서 목록 */}
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
                    <div
                      draggable
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
                        <input
                          autoFocus
                          value={editingDeptName}
                          onChange={(e) => setEditingDeptName(e.target.value)}
                          onBlur={() => handleRenameDept(dept)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleRenameDept(dept);
                            if (e.key === "Escape") setEditingDeptId(null);
                          }}
                          className="flex-1 text-sm border border-blue-400 rounded px-2 py-0.5 outline-none"
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span
                          className="text-sm text-gray-800 flex-1 cursor-pointer hover:text-blue-600"
                          onClick={(e) => { e.stopPropagation(); setEditingDeptId(dept.id); setEditingDeptName(dept.name); }}
                        >{dept.name}</span>
                      )}
                      <button
                        onClick={() => handleDeleteDept(dept)}
                        className="text-xs text-red-400 hover:text-red-600"
                      >삭제</button>
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={() => setShowDeptMgmt(false)}
                className="w-full border border-gray-300 rounded-lg py-2 text-sm text-gray-700 hover:bg-gray-50">
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset password modal */}
      {resetId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
            <h2 className="text-lg font-bold text-gray-900 mb-4">비밀번호 초기화</h2>
            <form onSubmit={handleResetPassword} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">새 비밀번호</label>
                <input
                  type="password"
                  value={newResetPw}
                  onChange={(e) => setNewResetPw(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="8자 이상"
                  minLength={8}
                  required
                  autoFocus
                />
              </div>
              {resetError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">
                  {resetError}
                </div>
              )}
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setResetId(null)}
                  className="flex-1 border border-gray-300 rounded-lg py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
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
