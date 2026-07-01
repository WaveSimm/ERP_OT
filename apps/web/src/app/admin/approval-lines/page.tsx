"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { approvalLineApi, departmentApi, userManagementApi, getUser } from "@/lib/api";

type LineData = {
  approverId: string;
  secondApproverId: string;
  thirdApproverId: string;
};

type UserRow = {
  id: string;
  name: string;
  deptName: string;
  deptId: string | null;
  line: LineData;
};

const EMPTY_LINE: LineData = { approverId: "", secondApproverId: "", thirdApproverId: "" };

export default function ApprovalLinesPage() {
  const router = useRouter();
  const [rows, setRows] = useState<UserRow[]>([]);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterDept, setFilterDept] = useState("");
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [saveError, setSaveError] = useState<string | null>(null);
  const [bulkingAll, setBulkingAll] = useState(false);
  const [bulkDeptId, setBulkDeptId] = useState<string | null>(null);
  // ref to always read latest rows in async callbacks
  const rowsRef = useRef<UserRow[]>([]);

  useEffect(() => {
    const user = getUser();
    if (!user || user.role !== "ADMIN") { router.replace("/projects"); return; }
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const [userData, lines, depts] = await Promise.all([
        userManagementApi.list().catch(() => ({ items: [] })),
        approvalLineApi.list().catch(() => []),
        departmentApi.list().catch(() => []),
      ]);

      const users: any[] = (userData as any).items ?? [];
      const lineMap = new Map((lines as any[]).map((l: any) => [l.userId, l]));

      const flatten = (nodes: any[]): any[] =>
        nodes.flatMap((n) => [n, ...flatten(n.children ?? [])]);
      const flatDepts = flatten(depts).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      const deptOrderMap = new Map(flatDepts.map((d: any) => [d.id, d.sortOrder ?? 9999]));
      const deptHeadMap = new Map(flatDepts.map((d: any) => [d.id, d.headUserId ?? null]));
      setDepartments(flatDepts);
      setAllUsers(users);

      const built: UserRow[] = users
        .filter((u: any) => u.isActive !== false)
        .map((u: any) => {
          const l: any = lineMap.get(u.id);
          return {
            id: u.id,
            name: u.name,
            deptName: u.profile?.departmentName ?? "",
            deptId: u.profile?.departmentId ?? null,
            line: {
              approverId: l?.approverId ?? "",
              secondApproverId: l?.secondApproverId ?? "",
              thirdApproverId: l?.thirdApproverId ?? "",
            },
          };
        })
        .sort((a, b) => {
          const orderA = deptOrderMap.get(a.deptId ?? "") ?? 9999;
          const orderB = deptOrderMap.get(b.deptId ?? "") ?? 9999;
          if (orderA !== orderB) return orderA - orderB;
          // 같은 부서 내: 부서장(팀장) 우선
          const isHeadA = deptHeadMap.get(a.deptId ?? "") === a.id ? 0 : 1;
          const isHeadB = deptHeadMap.get(b.deptId ?? "") === b.id ? 0 : 1;
          if (isHeadA !== isHeadB) return isHeadA - isHeadB;
          return a.name.localeCompare(b.name);
        });

      rowsRef.current = built;
      setRows(built);
    } finally {
      setLoading(false);
    }
  };

  // onChange 시점에 row.line에서 직접 newLine을 받아 타이밍 문제 제거
  const saveLine = async (userId: string, newLine: LineData) => {
    const prevRow = rowsRef.current.find((r) => r.id === userId);

    // 낙관적 업데이트
    setRows((prev) => {
      const next = prev.map((r) => r.id === userId ? { ...r, line: newLine } : r);
      rowsRef.current = next;
      return next;
    });

    setSavingIds((s) => new Set(s).add(userId));
    setSaveError(null);
    try {
      if (!newLine.approverId) {
        // 1차 미설정 → 결재라인 삭제
        await approvalLineApi.remove(userId);
      } else {
        await approvalLineApi.upsert({
          userId,
          approverId: newLine.approverId,
          secondApproverId: newLine.secondApproverId || null,
          thirdApproverId: newLine.thirdApproverId || null,
        });
      }
    } catch (err: any) {
      console.error("[approval-lines] save failed:", err);
      setSaveError(err.message ?? "저장 실패");
      // 롤백
      if (prevRow) {
        setRows((prev) =>
          prev.map((r) => r.id === userId ? { ...r, line: prevRow.line } : r)
        );
        rowsRef.current = rowsRef.current.map((r) =>
          r.id === userId ? { ...r, line: prevRow.line } : r
        );
      }
    } finally {
      setSavingIds((s) => { const n = new Set(s); n.delete(userId); return n; });
    }
  };

  const bulkAll = async () => {
    if (!confirm("전체 부서의 결재라인을 부서 계층 기준으로 일괄 설정합니다.\n계속하시겠습니까?")) return;
    setBulkingAll(true);
    try {
      await approvalLineApi.bulkAll();
      await load();
    } catch (err: any) {
      alert(err.message ?? "전사 일괄 설정 실패");
    } finally {
      setBulkingAll(false);
    }
  };

  const bulkByDept = async (deptId: string, deptName: string) => {
    const dept = departments.find((d) => d.id === deptId);
    if (!dept?.headUserId) {
      alert(`"${deptName}" 부서에 부서장이 지정되지 않았습니다.`);
      return;
    }
    if (!confirm(`"${deptName}" 부서원 결재라인을 일괄 설정하시겠습니까?`)) return;
    setBulkDeptId(deptId);
    try {
      await approvalLineApi.bulkByDepartment(deptId);
      await load();
    } catch (err: any) {
      alert(err.message ?? "일괄 설정 실패");
    } finally {
      setBulkDeptId(null);
    }
  };

  const activeUsers = allUsers.filter((u) => u.isActive !== false);

  // 이사·대표 후보 계산
  // 이사(소관) 후보 = "임원" 그룹 부서 소속 (대표이사 후보가 "대표이사" 부서 기준인 것과 동일 패턴).
  // (과거엔 "○○ 이사" 개인부서 소속 기준이었으나, 임원을 "임원" 그룹으로 묶으면서 비게 되어 변경)
  const execGroupDept = departments.find((d) => d.name === "임원");
  const soukwalCandidates = execGroupDept
    ? activeUsers.filter((u) => u.profile?.departmentId === execGroupDept.id)
    : [];
  const ceoDept = departments.find((d) => d.name === "대표이사");
  const daepyoCandidates = ceoDept ? activeUsers.filter((u) => u.profile?.departmentId === ceoDept.id) : [];

  // 부서별 이사/대표이사 직접 지정
  const handleSetSoukwal = async (deptId: string, soukwalUserId: string | null) => {
    try {
      await departmentApi.update(deptId, { soukwalUserId });
      await load();
    } catch (err: any) {
      alert(err.message ?? "이사 변경 실패");
    }
  };

  const handleSetDaepyo = async (deptId: string, daepyoUserId: string | null) => {
    try {
      await departmentApi.update(deptId, { daepyoUserId });
      await load();
    } catch (err: any) {
      alert(err.message ?? "대표이사 변경 실패");
    }
  };

  // 부서 자체에 명시 지정된 팀장/이사/대표이사 사용 (상위 부서 계층 추적 없이)
  const getChain = (deptId: string | null) => {
    if (!deptId) return { teamHead: null, soukwal: null, daepyo: null };
    const dept = departments.find((d) => d.id === deptId);
    if (!dept) return { teamHead: null, soukwal: null, daepyo: null };
    return {
      teamHead: dept.headName ?? null,
      soukwal: dept.soukwalName ?? null,
      daepyo: dept.daepyoName ?? null,
    };
  };
  // 드롭다운: MANAGER 이상 권한(팀장 이상)만 표시
  const approverUsers = activeUsers.filter((u) => u.role === "MANAGER" || u.role === "ADMIN");

  const filtered = filterDept
    ? rows.filter((r) => r.deptName === filterDept || r.deptId === filterDept)
    : rows;

  const groups: { deptName: string; deptId: string | null; members: UserRow[] }[] = [];
  for (const r of filtered) {
    const last = groups[groups.length - 1];
    if (last && last.deptName === r.deptName) last.members.push(r);
    else groups.push({ deptName: r.deptName, deptId: r.deptId, members: [r] });
  }

  if (loading) return <div className="p-8 text-sm text-gray-400">불러오는 중...</div>;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      {saveError && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-2.5 flex items-center justify-between">
          <span>저장 실패: {saveError}</span>
          <button onClick={() => setSaveError(null)} className="ml-4 text-red-400 hover:text-red-600 font-bold">×</button>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">결재라인 관리</h1>
          <p className="text-xs text-gray-400 mt-0.5">1차 → 2차 → 3차 순서로 결재 · 변경 즉시 저장</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={bulkAll}
            disabled={bulkingAll}
            className="text-sm px-4 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
          >
            {bulkingAll ? "설정 중..." : "전사 일괄 설정"}
          </button>
          <button onClick={() => router.push("/admin/users")} className="text-sm text-blue-600 hover:underline">
            ← 직원 관리
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <select
          value={filterDept}
          onChange={(e) => setFilterDept(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
        >
          <option value="">전체 부서</option>
          {departments.map((d) => (
            <option key={d.id} value={d.name}>{d.name}</option>
          ))}
        </select>
        <span className="text-xs text-gray-400">{filtered.length}명</span>
      </div>

      <div className="space-y-4">
        {groups.map((g) => {
          const dept = departments.find((d) => d.name === g.deptName);
          const hasDeptHead = !!dept?.headUserId;
          return (
            <div key={g.deptName || "__none__"} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm text-gray-800">{g.deptName || "(부서 없음)"}</span>
                  <span className="text-xs text-gray-400">{g.members.length}명</span>
                  {(() => {
                    const chain = getChain(g.deptId);
                    return chain.teamHead ? (
                      <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full">
                        팀장: {chain.teamHead}
                      </span>
                    ) : null;
                  })()}
                  {g.deptId && dept && (
                    <>
                      <select
                        value={dept.soukwalUserId ?? ""}
                        onChange={(e) => handleSetSoukwal(g.deptId!, e.target.value || null)}
                        className="text-xs border border-purple-200 rounded px-2 py-0.5 bg-white hover:border-purple-300"
                        title="이사"
                      >
                        <option value="">— 이사 —</option>
                        {soukwalCandidates.map((u: any) => (
                          <option key={u.id} value={u.id}>{u.name}</option>
                        ))}
                      </select>
                      <select
                        value={dept.daepyoUserId ?? ""}
                        onChange={(e) => handleSetDaepyo(g.deptId!, e.target.value || null)}
                        className="text-xs border border-amber-200 rounded px-2 py-0.5 bg-white hover:border-amber-300"
                        title="대표이사"
                      >
                        <option value="">— 대표이사 —</option>
                        {daepyoCandidates.map((u: any) => (
                          <option key={u.id} value={u.id}>{u.name}</option>
                        ))}
                      </select>
                    </>
                  )}
                </div>
                {g.deptId && (
                  <button
                    onClick={() => bulkByDept(g.deptId!, g.deptName)}
                    disabled={bulkDeptId === g.deptId || !hasDeptHead}
                    className="text-xs px-3 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    title={!hasDeptHead ? "부서장을 먼저 지정하세요" : ""}
                  >
                    {bulkDeptId === g.deptId ? "설정 중..." : "부서 일괄 설정"}
                  </button>
                )}
              </div>

              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="px-4 py-2 text-left text-xs text-gray-500 font-medium w-28">이름</th>
                    <th className="px-3 py-2 text-left text-xs text-gray-500 font-medium">1차 결재자</th>
                    <th className="px-3 py-2 text-left text-xs text-gray-500 font-medium">2차 결재자</th>
                    <th className="px-3 py-2 text-left text-xs text-gray-500 font-medium">3차 결재자</th>
                    <th className="w-12"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {g.members.map((row) => {
                    const isSaving = savingIds.has(row.id);
                    return (
                      <tr key={row.id} className={isSaving ? "opacity-50" : ""}>
                        <td className="px-4 py-1.5 font-medium text-gray-900 whitespace-nowrap">{row.name}</td>

                        {/* 1차 결재자 */}
                        <td className="px-3 py-1.5">
                          <select
                            value={row.line.approverId}
                            onChange={(e) => saveLine(row.id, { ...row.line, approverId: e.target.value })}
                            disabled={isSaving}
                            className="w-full border border-gray-200 rounded-lg px-2 py-1 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                          >
                            <option value="">— 미설정 —</option>
                            {approverUsers
                              .filter((u) => u.id !== row.id)
                              .map((u) => (
                                <option key={u.id} value={u.id}>
                                  {u.name} ({u.profile?.departmentName ?? "부서없음"})
                                </option>
                              ))}
                          </select>
                        </td>

                        {/* 2차 결재자 */}
                        <td className="px-3 py-1.5">
                          <select
                            value={row.line.secondApproverId}
                            onChange={(e) => saveLine(row.id, { ...row.line, secondApproverId: e.target.value })}
                            disabled={isSaving}
                            className="w-full border border-gray-200 rounded-lg px-2 py-1 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                          >
                            <option value="">— 없음 —</option>
                            {approverUsers
                              .filter((u) => u.id !== row.id && u.id !== row.line.approverId)
                              .map((u) => (
                                <option key={u.id} value={u.id}>
                                  {u.name} ({u.profile?.departmentName ?? "부서없음"})
                                </option>
                              ))}
                          </select>
                        </td>

                        {/* 3차 결재자 */}
                        <td className="px-3 py-1.5">
                          <select
                            value={row.line.thirdApproverId}
                            onChange={(e) => saveLine(row.id, { ...row.line, thirdApproverId: e.target.value })}
                            disabled={isSaving}
                            className="w-full border border-gray-200 rounded-lg px-2 py-1 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                          >
                            <option value="">— 없음 —</option>
                            {approverUsers
                              .filter((u) => u.id !== row.id && u.id !== row.line.approverId && u.id !== row.line.secondApproverId)
                              .map((u) => (
                                <option key={u.id} value={u.id}>
                                  {u.name} ({u.profile?.departmentName ?? "부서없음"})
                                </option>
                              ))}
                          </select>
                        </td>

                        <td className="px-2 text-center text-xs text-gray-300">
                          {isSaving && "저장중"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}
