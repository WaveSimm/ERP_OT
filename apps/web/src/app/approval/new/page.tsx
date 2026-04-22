"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { approvalApi, approvalLineApi, departmentApi, userManagementApi, projectApi, fileApi, getUser } from "@/lib/api";

export default function NewApprovalPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedTemplate = searchParams.get("template");

  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<any | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [items, setItems] = useState<any[]>([]);
  const [approvalLine, setApprovalLine] = useState<{ userId: string; userName: string; role: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [lineLoading, setLineLoading] = useState(false);

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

  // 부서 기반 결재선 자동 로드
  const loadMyApprovalLine = async () => {
    setLineLoading(true);
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
    } catch {
      // 결재라인 미설정
    } finally {
      setLineLoading(false);
    }
  };

  useEffect(() => {
    Promise.all([
      approvalApi.getTemplates(),
      departmentApi.list(),
      userManagementApi.members(true),
      projectApi.list().then((r) => r.items || r).catch(() => []),
    ]).then(([t, depts, members, projs]) => {
      setTemplates(t);
      setDepartments(depts);
      setAllMembers(members);
      setProjects(Array.isArray(projs) ? projs : []);
      if (preselectedTemplate) {
        const found = t.find((x: any) => x.code === preselectedTemplate || x.id === preselectedTemplate);
        if (found) selectTemplate(found);
      }
    });
    loadMyApprovalLine();
  }, []);

  const selectTemplate = (tpl: any) => {
    setSelectedTemplate(tpl);
    setTitle("");
    setBody(tpl.defaultBody || "");
    // Initialize fields
    const init: Record<string, string> = {};
    (tpl.fields || []).forEach((f: any) => { init[f.key] = ""; });
    setFields(init);
    // Initialize items if table config exists
    if (tpl.itemsTableConfig) {
      setItems([{ description: "", unitPrice: 0, quantity: 1, subtotal: 0, vat: 0 }]);
    } else {
      setItems([]);
    }
  };

  const updateItem = (idx: number, key: string, value: any) => {
    setItems((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [key]: value };
      // Auto-calc
      const up = Number(next[idx].unitPrice) || 0;
      const qty = Number(next[idx].quantity) || 0;
      next[idx].subtotal = up * qty;
      next[idx].vat = Math.round(next[idx].subtotal * 0.1);
      return next;
    });
  };

  const addItem = () => setItems((p) => [...p, { description: "", unitPrice: 0, quantity: 1, subtotal: 0, vat: 0, attachments: [] as { id: string; fileName: string }[] }]);
  const removeItem = (idx: number) => setItems((p) => p.filter((_, i) => i !== idx));

  // 항목별 파일 첨부
  const [uploading, setUploading] = useState<number | null>(null);
  const handleItemFileUpload = async (idx: number, file: File) => {
    setUploading(idx);
    try {
      const itemRef = `expense-item-${Date.now()}-${idx}`;
      const att = await fileApi.upload("APPROVAL_DOCUMENT", itemRef, file);
      setItems((prev) => {
        const next = [...prev];
        next[idx] = { ...next[idx], attachments: [...(next[idx].attachments || []), { id: att.id, fileName: att.fileName }] };
        return next;
      });
    } catch {
      alert("파일 업로드 실패");
    } finally {
      setUploading(null);
    }
  };
  const removeItemAttachment = async (idx: number, attId: string) => {
    try {
      await fileApi.remove(attId);
    } catch {}
    setItems((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], attachments: (next[idx].attachments || []).filter((a: any) => a.id !== attId) };
      return next;
    });
  };

  const totalAmount = items.reduce((s, i) => s + (i.subtotal || 0) + (i.vat || 0), 0);

  const addApprover = () => {
    if (!selectedUserId) return;
    const member = allMembers.find((m) => m.id === selectedUserId);
    if (!member) return;
    if (approvalLine.some((a) => a.userId === selectedUserId)) return; // 중복 방지
    setApprovalLine((prev) => [...prev, { userId: member.id, userName: member.name, role: selectedRole }]);
    setSelectedUserId("");
  };

  const removeApprover = (idx: number) => setApprovalLine((p) => p.filter((_, i) => i !== idx));

  const handleSave = async (submit: boolean) => {
    if (!selectedTemplate) return;
    setSaving(true);
    try {
      const user = getUser();
      const doc = await approvalApi.createDocument({
        templateId: selectedTemplate.id,
        title,
        body,
        fields,
        items: items.length > 0 ? items : undefined,
        totalAmount: totalAmount || undefined,
        approvalLine: approvalLine.map((a, i) => ({ ...a, stepOrder: i + 1 })),
        drafterId: user?.id,
        drafterName: user?.name,
      });

      if (submit) {
        await approvalApi.submitDocument(doc.id);
      }
      router.push(`/approval/${doc.id}`);
    } catch (e: any) {
      alert(e.message || "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  // Template selection view
  if (!selectedTemplate) {
    const grouped = templates.reduce((acc: Record<string, any[]>, t: any) => {
      const cat = t.category || "GENERAL";
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(t);
      return acc;
    }, {});

    const CATEGORY_LABELS: Record<string, string> = { GENERAL: "일반", PROCUREMENT: "구매", ATTENDANCE: "근태" };

    return (
      <div>
        <h2 className="text-lg font-semibold mb-4">결재 양식 선택</h2>
        {Object.entries(grouped).map(([cat, tpls]) => (
          <div key={cat} className="mb-6">
            <h3 className="text-sm font-medium text-gray-500 mb-2">{CATEGORY_LABELS[cat] || cat}</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {(tpls as any[]).map((t) => (
                <button
                  key={t.id}
                  onClick={() => selectTemplate(t)}
                  className="p-4 rounded-lg border border-gray-200 hover:border-blue-400 hover:bg-blue-50 text-left transition-colors"
                >
                  <div className="font-medium text-sm">{t.name}</div>
                  <div className="text-xs text-gray-500 mt-1">{t.description}</div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-2 mb-4">
        <button onClick={() => setSelectedTemplate(null)} className="text-gray-400 hover:text-gray-600">&larr;</button>
        <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">{selectedTemplate.name}</span>
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        {(selectedTemplate.fields || []).map((f: any) => (
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

      {/* 본문 */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">본문</label>
        <textarea
          value={body} onChange={(e) => setBody(e.target.value)}
          className="w-full border rounded-lg px-3 py-2 text-sm" rows={4}
        />
      </div>

      {/* 항목 테이블 (지출결의서 등) */}
      {selectedTemplate.itemsTableConfig && (
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
                <th className="px-2 py-1.5 text-center w-32">증빙</th>
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
                  <td className="px-1 py-1 text-right">{item.subtotal?.toLocaleString()}</td>
                  <td className="px-1 py-1 text-right">{item.vat?.toLocaleString()}</td>
                  <td className="px-1 py-1">
                    <div className="flex flex-col items-center gap-1">
                      {(item.attachments || []).map((att: any) => (
                        <div key={att.id} className="flex items-center gap-1 text-xs text-blue-600 max-w-[120px]">
                          <span className="truncate" title={att.fileName}>{att.fileName}</span>
                          <button onClick={() => removeItemAttachment(idx, att.id)} className="text-red-400 hover:text-red-600 shrink-0">✕</button>
                        </div>
                      ))}
                      <label className={`cursor-pointer text-xs px-2 py-0.5 rounded border border-dashed border-gray-300 hover:border-blue-400 hover:text-blue-600 text-gray-400 ${uploading === idx ? "opacity-50 pointer-events-none" : ""}`}>
                        {uploading === idx ? "..." : "+ 첨부"}
                        <input type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleItemFileUpload(idx, f);
                          e.target.value = "";
                        }} />
                      </label>
                    </div>
                  </td>
                  <td className="px-1 py-1">
                    <button onClick={() => removeItem(idx)} className="text-red-400 hover:text-red-600 text-xs">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 font-medium">
              <tr>
                <td colSpan={3} className="px-2 py-1.5 text-right">합계</td>
                <td colSpan={2} className="px-2 py-1.5 text-right">₩{totalAmount.toLocaleString()}</td>
                <td colSpan={2}></td>
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
          {lineLoading && <span className="text-xs text-gray-400">로딩중...</span>}
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
        {approvalLine.length === 0 && !lineLoading && (
          <p className="text-xs text-orange-500 mb-2">결재선이 설정되지 않았습니다. 부서 기본선을 불러오거나 직접 추가하세요.</p>
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
              <option value="AGREER">합의</option>
            </select>
          </div>
          <button onClick={addApprover} disabled={!selectedUserId}
            className="px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded text-sm disabled:opacity-40">추가</button>
        </div>
      </div>

      {/* 액션 버튼 */}
      <div className="flex gap-3">
        <button
          disabled={saving} onClick={() => handleSave(false)}
          className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          임시저장
        </button>
        <button
          disabled={saving} onClick={() => handleSave(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          상신
        </button>
      </div>
    </div>
  );
}
