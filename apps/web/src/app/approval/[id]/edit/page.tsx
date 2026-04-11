"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { approvalApi, approvalLineApi, departmentApi, userManagementApi, projectApi, getUser } from "@/lib/api";

export default function EditApprovalPage() {
  const params = useParams();
  const router = useRouter();
  const docId = params.id as string;

  const [doc, setDoc] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [items, setItems] = useState<any[]>([]);
  const [approvalLine, setApprovalLine] = useState<{ userId: string; userName: string; role: string }[]>([]);

  // 부서/멤버 데이터
  const [departments, setDepartments] = useState<any[]>([]);
  const [allMembers, setAllMembers] = useState<any[]>([]);
  const [selectedDeptId, setSelectedDeptId] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedRole, setSelectedRole] = useState("APPROVER");

  // 프로젝트(계약) 검색 드롭다운
  const [projects, setProjects] = useState<any[]>([]);
  const [projectSearch, setProjectSearch] = useState("");
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);

  const filteredProjects = projectSearch
    ? projects.filter((p) => p.name.toLowerCase().includes(projectSearch.toLowerCase()))
    : projects;

  const filteredMembers = selectedDeptId
    ? allMembers.filter((m) => m.departmentId === selectedDeptId)
    : allMembers;

  const loadDoc = useCallback(async () => {
    try {
      const [d, depts, members, projs] = await Promise.all([
        approvalApi.getDocument(docId),
        departmentApi.list(),
        userManagementApi.members(true),
        projectApi.list().then((r) => r.items || r).catch(() => []),
      ]);
      setDoc(d);
      setDepartments(depts);
      setAllMembers(members);
      setProjects(Array.isArray(projs) ? projs : []);

      // Populate form from existing doc
      setTitle(d.title || "");
      setBody(d.richBody || d.body || "");
      setFields(d.content || d.fields || {});
      setItems(d.itemsData || d.items || []);

      // Reconstruct approval line from steps
      const steps = (d.steps || []).sort((a: any, b: any) => a.stepOrder - b.stepOrder);
      setApprovalLine(steps.map((s: any) => ({
        userId: s.approverId,
        userName: s.approverName || s.approverId,
        role: s.roleName === "합의" ? "AGREEER" : "APPROVER",
      })));

      // Check editable
      if (!["DRAFT", "RETURNED", "REJECTED"].includes(d.status)) {
        alert("현재 상태에서는 편집할 수 없습니다.");
        router.push(`/approval/${docId}`);
      }
    } catch (e) {
      console.error(e);
      alert("문서를 불러올 수 없습니다.");
      router.push("/approval");
    } finally {
      setLoading(false);
    }
  }, [docId, router]);

  useEffect(() => { loadDoc(); }, [loadDoc]);

  const updateItem = (idx: number, key: string, value: any) => {
    setItems((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [key]: value };
      const up = Number(next[idx].unitPrice) || 0;
      const qty = Number(next[idx].quantity) || 0;
      next[idx].subtotal = up * qty;
      next[idx].vat = Math.round(next[idx].subtotal * 0.1);
      return next;
    });
  };

  const addItem = () => setItems((p) => [...p, { description: "", unitPrice: 0, quantity: 1, subtotal: 0, vat: 0 }]);
  const removeItem = (idx: number) => setItems((p) => p.filter((_, i) => i !== idx));

  const totalAmount = items.reduce((s, i) => s + (i.subtotal || 0) + (i.vat || 0), 0);

  const addApprover = () => {
    if (!selectedUserId) return;
    const member = allMembers.find((m) => m.id === selectedUserId);
    if (!member) return;
    if (approvalLine.some((a) => a.userId === selectedUserId)) return;
    setApprovalLine((prev) => [...prev, { userId: member.id, userName: member.name, role: selectedRole }]);
    setSelectedUserId("");
  };

  const removeApprover = (idx: number) => setApprovalLine((p) => p.filter((_, i) => i !== idx));

  const loadMyApprovalLine = async () => {
    try {
      const info = await approvalLineApi.getMe();
      if (!info) return;
      const line: { userId: string; userName: string; role: string }[] = [];
      if (info.approverId && info.approverName) {
        line.push({ userId: info.approverId, userName: info.approverName + (info.isDelegated ? " (위임)" : ""), role: "APPROVER" });
      }
      if (info.secondApproverId && info.secondApproverName) {
        line.push({ userId: info.secondApproverId, userName: info.secondApproverName, role: "APPROVER" });
      }
      if (info.thirdApproverId && info.thirdApproverName) {
        line.push({ userId: info.thirdApproverId, userName: info.thirdApproverName, role: "APPROVER" });
      }
      if (line.length > 0) setApprovalLine(line);
    } catch { /* ignore */ }
  };

  const handleSave = async (submit: boolean) => {
    setSaving(true);
    try {
      await approvalApi.updateDocument(docId, {
        title,
        richBody: body,
        content: fields,
        itemsData: items.length > 0 ? items : undefined,
        itemsTotal: totalAmount || undefined,
        amount: totalAmount || undefined,
      });

      if (submit) {
        await approvalApi.submitDocument(docId);
      }
      router.push(`/approval/${docId}`);
    } catch (e: any) {
      alert(e.message || "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-center py-12 text-gray-400">로딩 중...</div>;
  if (!doc) return <div className="text-center py-12 text-red-500">문서를 찾을 수 없습니다.</div>;

  const templateFields = doc.template?.fields || [];
  const hasItemsTable = doc.template?.itemsTableConfig;

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-2 mb-4">
        <button onClick={() => router.push(`/approval/${docId}`)} className="text-gray-400 hover:text-gray-600">&larr;</button>
        <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">{doc.template?.name || doc.templateCode}</span>
        <span className="text-sm font-medium">문서 편집</span>
      </div>

      {/* 제목 */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">제목</label>
        <input
          value={title} onChange={(e) => setTitle(e.target.value)}
          className="w-full border rounded-lg px-3 py-2 text-sm"
        />
      </div>

      {/* 동적 필드 */}
      {templateFields.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          {templateFields.map((f: any) => (
            <div key={f.key}>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {f.label} {f.required && <span className="text-red-500">*</span>}
              </label>
              {f.key === "project" ? (
                <div className="relative" onBlur={() => setTimeout(() => setShowProjectDropdown(false), 200)}>
                  <input
                    value={projectSearch || fields[f.key] || ""}
                    onChange={(e) => {
                      setProjectSearch(e.target.value);
                      setShowProjectDropdown(true);
                      if (!e.target.value) setFields((p) => ({ ...p, [f.key]: "" }));
                    }}
                    onFocus={() => setShowProjectDropdown(true)}
                    placeholder="계약번호 또는 프로젝트명 검색"
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  />
                  {showProjectDropdown && filteredProjects.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {filteredProjects.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            setFields((prev) => ({ ...prev, [f.key]: p.name }));
                            setProjectSearch(p.name);
                            setShowProjectDropdown(false);
                          }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b last:border-b-0"
                        >
                          <span className="font-medium">{p.name}</span>
                          {p.status && <span className="text-xs text-gray-400 ml-2">{p.status}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : f.type === "select" ? (
                <select
                  value={fields[f.key] || ""}
                  onChange={(e) => setFields((p) => ({ ...p, [f.key]: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">선택</option>
                  {(f.options || []).map((o: string) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : f.type === "textarea" ? (
                <textarea
                  value={fields[f.key] || ""}
                  onChange={(e) => setFields((p) => ({ ...p, [f.key]: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm" rows={3}
                />
              ) : (
                <input
                  type={f.type === "date" ? "date" : f.type === "time" ? "time" : "text"}
                  value={fields[f.key] || ""}
                  onChange={(e) => setFields((p) => ({ ...p, [f.key]: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* 본문 */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">본문</label>
        <textarea
          value={body} onChange={(e) => setBody(e.target.value)}
          className="w-full border rounded-lg px-3 py-2 text-sm" rows={4}
        />
      </div>

      {/* 항목 테이블 */}
      {hasItemsTable && (
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">항목</label>
          <table className="w-full text-sm border">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-2 py-1.5 text-left">내역</th>
                <th className="px-2 py-1.5 text-right w-24">단가</th>
                <th className="px-2 py-1.5 text-right w-16">수량</th>
                <th className="px-2 py-1.5 text-right w-24">소계</th>
                <th className="px-2 py-1.5 text-right w-24">부가세</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr key={idx} className="border-t">
                  <td className="px-1 py-1">
                    <input value={item.description} onChange={(e) => updateItem(idx, "description", e.target.value)}
                      className="w-full border rounded px-2 py-1 text-sm" />
                  </td>
                  <td className="px-1 py-1">
                    <input type="number" value={item.unitPrice} onChange={(e) => updateItem(idx, "unitPrice", e.target.value)}
                      className="w-full border rounded px-2 py-1 text-sm text-right" />
                  </td>
                  <td className="px-1 py-1">
                    <input type="number" value={item.quantity} onChange={(e) => updateItem(idx, "quantity", e.target.value)}
                      className="w-full border rounded px-2 py-1 text-sm text-right" />
                  </td>
                  <td className="px-1 py-1 text-right">{(item.subtotal || 0).toLocaleString()}</td>
                  <td className="px-1 py-1 text-right">{(item.vat || 0).toLocaleString()}</td>
                  <td className="px-1 py-1">
                    <button onClick={() => removeItem(idx)} className="text-red-400 hover:text-red-600 text-xs">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 font-medium">
              <tr>
                <td colSpan={3} className="px-2 py-1.5 text-right">합계</td>
                <td colSpan={2} className="px-2 py-1.5 text-right">{totalAmount.toLocaleString()}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
          <button onClick={addItem} className="mt-1 text-xs text-blue-600 hover:underline">+ 항목 추가</button>
        </div>
      )}

      {/* 결재선 */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <label className="text-sm font-medium text-gray-700">결재선</label>
          <button onClick={loadMyApprovalLine} className="text-xs text-blue-500 hover:underline">부서 기본선 불러오기</button>
        </div>
        {approvalLine.length > 0 && (
          <div className="flex gap-2 flex-wrap mb-2">
            {approvalLine.map((a, i) => (
              <div key={i} className="flex items-center gap-1 bg-blue-50 rounded-full px-3 py-1 text-sm">
                <span className="text-xs text-blue-500">{i + 1}차</span>
                <span>{a.userName}</span>
                <span className="text-xs text-gray-400">({a.role === "APPROVER" ? "결재" : "합의"})</span>
                <button onClick={() => removeApprover(i)} className="text-gray-400 hover:text-red-500 ml-1">✕</button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2 items-end flex-wrap">
          <div>
            <label className="text-xs text-gray-500">부서</label>
            <select value={selectedDeptId} onChange={(e) => { setSelectedDeptId(e.target.value); setSelectedUserId(""); }}
              className="border rounded px-2 py-1 text-sm w-36">
              <option value="">전체 부서</option>
              {departments.map((d: any) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500">이름</label>
            <select value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)}
              className="border rounded px-2 py-1 text-sm w-40">
              <option value="">선택하세요</option>
              {filteredMembers.map((m: any) => (
                <option key={m.id} value={m.id}>{m.name}{m.position ? ` (${m.position})` : ""}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500">역할</label>
            <select value={selectedRole} onChange={(e) => setSelectedRole(e.target.value)}
              className="border rounded px-2 py-1 text-sm">
              <option value="APPROVER">결재</option>
              <option value="AGREEER">합의</option>
            </select>
          </div>
          <button onClick={addApprover} disabled={!selectedUserId}
            className="px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded text-sm disabled:opacity-40">추가</button>
        </div>
      </div>

      {/* 액션 버튼 */}
      <div className="flex gap-3">
        <button onClick={() => router.push(`/approval/${docId}`)}
          className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">
          취소
        </button>
        <button
          disabled={saving} onClick={() => handleSave(false)}
          className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          저장
        </button>
        <button
          disabled={saving} onClick={() => handleSave(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          저장 후 상신
        </button>
      </div>
    </div>
  );
}
