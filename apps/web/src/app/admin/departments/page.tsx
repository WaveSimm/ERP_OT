"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { departmentApi, userManagementApi, getUser } from "@/lib/api";

export default function DepartmentsPage() {
  const router = useRouter();
  const [departments, setDepartments] = useState<any[]>([]);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    const user = getUser();
    if (!user || user.role !== "ADMIN") { router.replace("/projects"); return; }
    load();
  }, [router]);

  const load = async () => {
    setLoading(true);
    try {
      const [depts, userData] = await Promise.all([
        departmentApi.list(),
        userManagementApi.list().catch(() => ({ items: [] })),
      ]);
      const flatten = (nodes: any[]): any[] =>
        nodes.flatMap((n) => [n, ...flatten(n.children ?? [])]);
      setDepartments(flatten(depts).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)));
      setAllUsers((userData as any).items ?? []);
    } finally {
      setLoading(false);
    }
  };

  const updateDept = async (deptId: string, data: { headUserId?: string | null; parentId?: string | null; soukwalUserId?: string | null; daepyoUserId?: string | null }) => {
    setSaving(deptId);
    try {
      await departmentApi.update(deptId, data);
      // 저장 후 전체 재로드 (계층 구조 재계산)
      await load();
    } catch (err: any) {
      alert(err.message ?? "저장 실패");
    } finally {
      setSaving(null);
    }
  };

  // 레벨 판별
  const getLevel = (dept: any): "root" | "mid" | "leaf" => {
    if (!dept.parentId) return "root";
    const hasChildren = departments.some((d) => d.parentId === dept.id);
    return hasChildren ? "mid" : "leaf";
  };

  const getParent = (dept: any) =>
    dept.parentId ? departments.find((d) => d.id === dept.parentId) ?? null : null;

  const getGrandParent = (dept: any) => {
    const parent = getParent(dept);
    return parent ? getParent(parent) : null;
  };

  const usersInDept = (deptId: string) =>
    allUsers.filter((u) => u.profile?.departmentId === deptId);

  // 대표이사 후보: 경영 부서 소속 3인
  const daepyoDept = departments.find(
    (d) => !d.parentId && departments.some((c) => c.parentId === d.id)
  ) ?? null;
  const daepyoUsers = daepyoDept ? allUsers.filter((u) => u.profile?.departmentId === daepyoDept.id) : [];

  // 총괄이사 후보: 임원 부서 소속 인원
  const soukwalDept = daepyoDept ? departments.find((d) => d.parentId === daepyoDept.id) ?? null : null;
  const soukwalUsers = soukwalDept ? allUsers.filter((u) => u.profile?.departmentId === soukwalDept.id) : [];

  // 순환 참조 방지: 자기 자신 및 자신의 하위 부서는 상위 부서로 선택 불가
  const getDescendantIds = (deptId: string): Set<string> => {
    const ids = new Set<string>([deptId]);
    const queue = [deptId];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      for (const d of departments) {
        if (d.parentId === curr) {
          ids.add(d.id);
          queue.push(d.id);
        }
      }
    }
    return ids;
  };

  const HeadSelect = ({ dept }: { dept: any }) => (
    <div className="flex items-center gap-1.5">
      <select
        value={dept.headUserId ?? ""}
        onChange={(e) => updateDept(dept.id, { headUserId: e.target.value || null })}
        disabled={saving === dept.id}
        className="border border-gray-300 rounded-lg px-2 py-1 text-sm w-32 bg-white disabled:opacity-50"
      >
        <option value="">— 미지정 —</option>
        {usersInDept(dept.id).map((u: any) => (
          <option key={u.id} value={u.id}>{u.name}</option>
        ))}
      </select>
    </div>
  );

  const Dash = ({ label }: { label?: string }) => (
    <span className="text-xs text-gray-300">{label ?? "—"}</span>
  );

  if (loading) return <div className="p-8 text-sm text-gray-400">불러오는 중...</div>;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">부서 관리</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            상위 부서를 설정하면 팀장 → 총괄이사 → 대표이사 계층이 자동 결정됩니다
          </p>
        </div>
        <button
          onClick={() => router.push("/admin/approval-lines")}
          className="text-sm text-blue-600 hover:underline"
        >
          결재라인 관리 →
        </button>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">부서명</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 w-12">인원</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 w-36">상위 부서</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-green-600 w-36">팀장</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-purple-600 w-36">총괄이사</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-amber-600 w-36">대표이사</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {departments.map((dept) => {
              const level = getLevel(dept);
              const parent = getParent(dept);
              const grandParent = getGrandParent(dept);
              const memberCount = dept.memberCount ?? usersInDept(dept.id).length;
              const excludeIds = getDescendantIds(dept.id);
              const isSaving = saving === dept.id;

              return (
                <tr key={dept.id} className={`hover:bg-gray-50 ${isSaving ? "opacity-50" : ""}`}>
                  {/* 부서명 */}
                  <td className="px-4 py-2.5 font-medium text-gray-900">
                    {level === "leaf" && <span className="text-gray-300 mr-1 ml-6">└</span>}
                    {level === "mid" && <span className="text-gray-300 mr-1 ml-3">└</span>}
                    {dept.name}
                    {isSaving && <span className="ml-2 text-xs text-gray-400">저장 중...</span>}
                  </td>

                  {/* 인원 */}
                  <td className="px-4 py-2.5 text-center text-gray-500">{memberCount}</td>

                  {/* 상위 부서 */}
                  <td className="px-4 py-2.5">
                    <select
                      value={dept.parentId ?? ""}
                      onChange={(e) => updateDept(dept.id, { parentId: e.target.value || null })}
                      disabled={isSaving}
                      className="border border-gray-300 rounded-lg px-2 py-1 text-sm w-32 bg-white disabled:opacity-50"
                    >
                      <option value="">— 없음(최상위) —</option>
                      {departments
                        .filter((d) => !excludeIds.has(d.id))
                        .map((d) => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                    </select>
                  </td>

                  {/* 팀장 */}
                  <td className="px-4 py-2.5">
                    {level === "leaf" ? (
                      <HeadSelect dept={dept} />
                    ) : (
                      <Dash />
                    )}
                  </td>

                  {/* 총괄이사: 팀마다 독립 설정 (soukwalUserId) */}
                  <td className="px-4 py-2.5">
                    {level === "leaf" ? (
                      <select
                        value={dept.soukwalUserId ?? ""}
                        onChange={(e) => updateDept(dept.id, { soukwalUserId: e.target.value || null })}
                        disabled={isSaving}
                        className="border border-purple-200 rounded-lg px-2 py-1 text-sm w-32 bg-white disabled:opacity-50"
                      >
                        <option value="">— 미지정 —</option>
                        {soukwalUsers.map((u: any) => (
                          <option key={u.id} value={u.id}>{u.name}</option>
                        ))}
                      </select>
                    ) : (
                      <Dash />
                    )}
                  </td>

                  {/* 대표이사: 부서마다 독립 설정 (daepyoUserId) */}
                  <td className="px-4 py-2.5">
                    {level !== "root" ? (
                      <select
                        value={dept.daepyoUserId ?? ""}
                        onChange={(e) => updateDept(dept.id, { daepyoUserId: e.target.value || null })}
                        disabled={isSaving}
                        className="border border-amber-200 rounded-lg px-2 py-1 text-sm w-32 bg-white disabled:opacity-50"
                      >
                        <option value="">— 미지정 —</option>
                        {daepyoUsers.map((u: any) => (
                          <option key={u.id} value={u.id}>{u.name}</option>
                        ))}
                      </select>
                    ) : (
                      <Dash />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-400">
        💡 사용법: 먼저 각 부서의 <strong>상위 부서</strong>를 설정하면 팀장/총괄이사/대표이사 컬럼이 자동으로 구성됩니다.
      </p>
    </div>
  );
}
