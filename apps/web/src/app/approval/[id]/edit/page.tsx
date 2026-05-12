"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { approvalApi, approvalLineApi, departmentApi, userManagementApi, projectApi, taskApi, myTasksApi, getUser } from "@/lib/api";
import { DateInput } from "@/components/ui/DateInput";
import { TimeInput } from "@/components/ui/TimeInput";

export default function EditApprovalPage() {
  const params = useParams();
  const router = useRouter();
  const docId = params.id as string;

  const [doc, setDoc] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [fields, setFields] = useState<Record<string, any>>({});
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

  // 태스크 드롭다운 (OT 전용)
  const [tasks, setTasks] = useState<any[]>([]);
  const [taskSearch, setTaskSearch] = useState("");
  const [showTaskDropdown, setShowTaskDropdown] = useState(false);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [myProjectGroups, setMyProjectGroups] = useState<any[]>([]);

  const isOTTemplate = doc?.template?.code === "OT";

  // OT 템플릿이면 본인 프로젝트(myProjectGroups)만, 그 외엔 전사 projects
  const projectSource = isOTTemplate ? myProjectGroups.map((g: any) => g.project) : projects;
  const filteredProjects = projectSearch
    ? projectSource.filter((p: any) => (p.name || "").toLowerCase().includes(projectSearch.toLowerCase()))
    : projectSource;

  const filteredTasks = taskSearch
    ? tasks.filter((t) => ((t.name || t.taskName) || "").toLowerCase().includes(taskSearch.toLowerCase()))
    : tasks;

  // OT 템플릿이고 doc 로드 완료 시 본인 프로젝트+태스크 로드
  useEffect(() => {
    if (!isOTTemplate) return;
    myTasksApi.list().then((groups) => setMyProjectGroups(Array.isArray(groups) ? groups : [])).catch(() => setMyProjectGroups([]));
  }, [isOTTemplate]);

  // project 선택 변경 시 task 목록 로드
  useEffect(() => {
    const projectName = fields["project"];
    if (!projectName) { setTasks([]); setTaskSearch(""); return; }

    if (isOTTemplate) {
      const group = myProjectGroups.find((g: any) => g.project.name === projectName);
      const list = (group?.tasks ?? []).map((t: any) => ({ id: t.taskId, name: t.taskName, status: t.taskStatus }));
      setTasks(list);
      return;
    }

    const matched = projects.find((p) => p.name === projectName);
    if (!matched) { setTasks([]); return; }
    setTasksLoading(true);
    taskApi.list(matched.id)
      .then((list) => setTasks(Array.isArray(list) ? list : []))
      .catch(() => setTasks([]))
      .finally(() => setTasksLoading(false));
  }, [fields["project"], projects, isOTTemplate, myProjectGroups]);

  const filteredMembers = selectedDeptId
    ? allMembers.filter((m) => m.departmentId === selectedDeptId)
    : allMembers;

  const isLeaveTemplate = doc?.template?.code === "LEAVE";

  // OT 자동 제목 생성 (휴일근무신청서)
  const buildOTTitle = (): string => {
    const dates: string[] = Array.isArray(fields["workDates"]) ? fields["workDates"].filter(Boolean) : [];
    const proj = fields["project"];
    const task = fields["task"];
    const datesShort = dates.map((d) => d.slice(5).replace("-", "/"));
    const dateStr = dates.length === 0 ? ""
      : dates.length === 1 ? ` (${datesShort[0]})`
      : dates.length <= 3 ? ` ${dates.length}일 (${datesShort.join(", ")})`
      : ` ${dates.length}일 (${datesShort.slice(0, 3).join(", ")} 외)`;
    const prefix = proj ? `[${proj}] ` : "";
    const taskPart = task ? `${task} ` : "";
    return `${prefix}${taskPart}휴일근무${dateStr}`.trim() || "휴일근무";
  };

  // LEAVE 자동 제목 생성 — `[연차-3일] 05/07~05/11 - 사유` 또는 `[반차-4시간] 05/07 09:00~13:00 - 사유`
  const buildLeaveTitle = (): string => {
    const type = fields["leaveType"];
    const start = fields["startDate"];
    const end = fields["endDate"];
    const startTime = fields["startTime"];
    const endTime = fields["endTime"];
    const reason = (fields["reason"] || "").trim();
    if (!type && !start) return "휴가신청";

    // 라벨에서 "(...)" 괄호 부분 제거
    const typeName = type ? type.replace(/\s*\([^)]*\)\s*/g, "").trim() : "";

    const isTime = isTimeBasedLeave(type);
    let durationStr = "";
    if (isTime) {
      const minutes = getTimeBasedDuration(type || "");
      if (minutes >= 60 && minutes % 60 === 0) durationStr = `${minutes / 60}시간`;
      else if (minutes > 0) durationStr = `${minutes}분`;
    } else if (start && end) {
      const s = new Date(start);
      const e = new Date(end);
      let count = 0;
      const cur = new Date(s);
      while (cur <= e) {
        const dow = cur.getDay();
        if (dow !== 0 && dow !== 6) count++;
        cur.setDate(cur.getDate() + 1);
      }
      if (count > 0) durationStr = `${count}일`;
    }

    const typeStr = typeName ? `[${typeName}${durationStr ? `-${durationStr}` : ""}] ` : "";

    let dateStr = "";
    if (start && end && start !== end) {
      dateStr = `${start.slice(5).replace("-", "/")}~${end.slice(5).replace("-", "/")}`;
    } else if (start) {
      dateStr = start.slice(5).replace("-", "/");
    }
    const timeStr = (startTime && endTime) ? ` ${startTime}~${endTime}` : "";
    const reasonStr = reason ? ` - ${reason.slice(0, 30)}` : "";
    return `${typeStr}${dateStr}${timeStr}${reasonStr}`.trim();
  };

  // LEAVE: 시간 단위 휴가 helpers — 반차(4H) 4h/1/4연차(2H) 2h/가정의날(1H) 1h/가정의날(2H) 2h
  const getTimeBasedDuration = (leaveType: string): number => {
    if (leaveType === "반차(4H)" || leaveType === "반차") return 240;
    if (leaveType === "1/4연차(2H)" || leaveType === "1/4연차") return 120;
    if (leaveType === "가정의날(1H)") return 60;
    if (leaveType === "가정의날(2H)") return 120;
    return 0;
  };
  const isTimeBasedLeave = (leaveType?: string): boolean =>
    ["반차(4H)", "반차", "1/4연차(2H)", "1/4연차", "가정의날(1H)", "가정의날(2H)"].includes(leaveType || "");

  const computeEndTime = (startTime: string, durationMin: number): string => {
    const [h, m] = startTime.split(":").map(Number);
    if ([h, m].some((n) => Number.isNaN(n))) return startTime;
    const total = Math.min((h! * 60 + m!) + durationMin, 24 * 60 - 1);
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  };

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
      // workDates가 string으로 저장된 legacy 데이터 정규화 → array
      const loadedFields: any = { ...(d.content || d.fields || {}) };
      if (typeof loadedFields.workDates === "string") {
        loadedFields.workDates = loadedFields.workDates.split(",").map((s: string) => s.trim()).filter(Boolean);
      }
      setFields(loadedFields);
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
      // 템플릿별 제목 자동 생성, 그 외엔 사용자 입력
      const finalTitle = isOTTemplate ? buildOTTitle()
        : isLeaveTemplate ? buildLeaveTitle()
        : title;
      await approvalApi.updateDocument(docId, {
        title: finalTitle,
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

  // EXPENSE_CLAIM은 정산서에서 자동 생성되는 문서. 결재 문서 자체 편집 불가.
  if (doc.template?.code === "EXPENSE_CLAIM") {
    const settlementId = doc.fields?.settlementId;
    return (
      <div className="max-w-2xl mx-auto py-8">
        <div className="flex items-center gap-2 mb-4">
          <button onClick={() => router.push(`/approval/${docId}`)} className="text-gray-400 hover:text-gray-600">&larr;</button>
          <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">{doc.template?.name}</span>
          <span className="text-sm font-medium">문서 편집</span>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-5 text-sm text-amber-900">
          <p className="font-bold mb-2">📋 경비정산서는 결재 문서에서 직접 편집할 수 없습니다</p>
          <p className="mb-3">
            이 문서의 거래 내역·금액은 <strong>경비정산서</strong>에서 자동으로 생성되며,
            결재 상신 후에는 정산서 자체도 잠겨 수정 불가합니다.
          </p>
          <div className="space-y-1 text-xs text-amber-800 mb-4">
            <p>• 거래/금액 수정: 결재를 회수(취소)한 뒤 정산서를 DRAFT로 복귀 → 거래 페이지에서 수정 → 재상신</p>
            <p>• 단순 메모 추가: 결재 진행 중인 문서의 의견란 사용</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => router.push(`/approval/${docId}`)}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50">
              결재 문서로 돌아가기
            </button>
            {settlementId && (
              <button onClick={() => router.push(`/expense/settlements/${settlementId}`)}
                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700">
                정산서로 이동 →
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const templateFields = doc.template?.fields || [];
  const hasItemsTable = doc.template?.itemsTableConfig;

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-2 mb-4">
        <button onClick={() => router.push(`/approval/${docId}`)} className="text-gray-400 hover:text-gray-600">&larr;</button>
        <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">{doc.template?.name || doc.templateCode}</span>
        <span className="text-sm font-medium">문서 편집</span>
      </div>

      {/* 제목 — OT/LEAVE는 자동 생성 (미리보기), 그 외엔 수동 입력 */}
      {(isOTTemplate || isLeaveTemplate) ? (
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">제목 (자동 생성)</label>
          <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-600 italic">
            {isOTTemplate ? buildOTTitle() : buildLeaveTitle()}
          </div>
        </div>
      ) : (
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">제목</label>
          <input
            value={title} onChange={(e) => setTitle(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 text-sm"
          />
        </div>
      )}

      {/* 동적 필드 — OT/LEAVE는 12-col grid */}
      {templateFields.length > 0 && (() => {
        const useCustom = isOTTemplate || isLeaveTemplate;
        const gridClass = useCustom
          ? "grid grid-cols-1 sm:grid-cols-12 gap-4 mb-4"
          : "grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4";
        const getFieldClass = (f: any): string => {
          if (!useCustom) return "";
          if (isOTTemplate) {
            if (f.key === "project") return "sm:col-span-6";
            if (f.key === "task") return "sm:col-span-6";
            return "sm:col-span-12";
          }
          if (isLeaveTemplate) {
            if (f.key === "leaveType") return "sm:col-span-4";
            if (f.key === "startDate") return "sm:col-span-4";
            if (f.key === "endDate") return "sm:col-span-4";
            if (f.key === "startTime") return "sm:col-span-4";
            if (f.key === "endTime") return "sm:col-span-4";
            return "sm:col-span-12";
          }
          return "";
        };
        return (
          <div className={gridClass}>
            {templateFields.map((f: any) => (
              <div key={f.key} className={getFieldClass(f)}>
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
                        {filteredProjects.map((p: any) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => {
                              setFields((prev) => ({ ...prev, [f.key]: p.name, projectId: p.id, task: "", taskId: "" }));
                              setProjectSearch(p.name);
                              setTaskSearch("");
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
                ) : f.key === "task" ? (
                  <div className="relative" onBlur={() => setTimeout(() => setShowTaskDropdown(false), 200)}>
                    <input
                      value={taskSearch || fields[f.key] || ""}
                      onChange={(e) => {
                        setTaskSearch(e.target.value);
                        setShowTaskDropdown(true);
                        if (!e.target.value) setFields((p) => ({ ...p, [f.key]: "" }));
                      }}
                      onFocus={() => setShowTaskDropdown(true)}
                      placeholder={!fields["project"] ? "먼저 프로젝트를 선택하세요" : (tasksLoading ? "로딩 중..." : "태스크명 검색")}
                      disabled={!fields["project"]}
                      className="w-full border rounded-lg px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-400"
                    />
                    {showTaskDropdown && fields["project"] && filteredTasks.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        {filteredTasks.map((t: any) => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => {
                              setFields((prev) => ({ ...prev, [f.key]: t.name, taskId: t.id }));
                              setTaskSearch(t.name);
                              setShowTaskDropdown(false);
                            }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b last:border-b-0"
                          >
                            <span className="font-medium">{t.name}</span>
                            {t.status && <span className="text-xs text-gray-400 ml-2">{t.status}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : f.type === "date-multi" ? (
                  (() => {
                    const dates: string[] = Array.isArray(fields[f.key]) ? fields[f.key] : [];
                    const updateAt = (i: number, val: string) => {
                      const next = [...dates];
                      next[i] = val;
                      setFields((p) => ({ ...p, [f.key]: next }));
                    };
                    const removeAt = (i: number) => {
                      setFields((p) => ({ ...p, [f.key]: dates.filter((_, idx) => idx !== i) }));
                    };
                    const addOne = () => {
                      setFields((p) => ({ ...p, [f.key]: [...dates, ""] }));
                    };
                    return (
                      <div className="space-y-2">
                        {dates.length === 0 && (
                          <div className="text-xs text-gray-400 italic">아래 + 버튼으로 날짜를 추가하세요 (토/일/공휴일만 신청 가능)</div>
                        )}
                        {dates.map((d, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <DateInput
                              value={d}
                              onChange={(e) => updateAt(i, e.target.value)}
                              className="flex-1 border rounded-lg px-3 py-2 text-sm"
                            />
                            <button
                              type="button"
                              onClick={() => removeAt(i)}
                              className="px-2 py-2 text-gray-400 hover:text-red-500 text-sm"
                              aria-label="날짜 삭제"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={addOne}
                          className="px-3 py-1.5 border border-dashed border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
                        >
                          + 날짜 추가
                        </button>
                      </div>
                    );
                  })()
                ) : f.type === "select" ? (
                  <select
                    value={fields[f.key] || ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      setFields((p) => {
                        const next: any = { ...p, [f.key]: v };
                        if (isLeaveTemplate && f.key === "leaveType") {
                          const wasTimeBased = isTimeBasedLeave(p["leaveType"]);
                          const willBeTimeBased = isTimeBasedLeave(v);
                          if (!willBeTimeBased) {
                            next.startTime = "";
                            next.endTime = "";
                          } else if (wasTimeBased && p["startTime"]) {
                            const dur = getTimeBasedDuration(v);
                            if (dur > 0) next.endTime = computeEndTime(p["startTime"], dur);
                          }
                        }
                        return next;
                      });
                    }}
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
                ) : f.type === "date" ? (
                  <DateInput
                    value={fields[f.key] || ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      setFields((p) => {
                        const next: any = { ...p, [f.key]: v };
                        if (isLeaveTemplate && f.key === "startDate") {
                          const cur = p["endDate"];
                          if (!cur || cur < v) next.endDate = v;
                        }
                        return next;
                      });
                    }}
                    {...(isLeaveTemplate && f.key === "endDate" && fields["startDate"] ? { min: fields["startDate"] as string } : {})}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  />
                ) : f.type === "time" ? (
                  (() => {
                    // v1.6: 모든 시간 단위 휴가의 endTime 자동
                    const lt = fields["leaveType"];
                    const isTime = isLeaveTemplate && isTimeBasedLeave(lt);
                    const endTimeAutoFor = (f.key === "endTime") && isTime;
                    return (
                      <TimeInput
                        value={fields[f.key] || ""}
                        disabled={!isTime || endTimeAutoFor}
                        placeholder={!isTime ? "시간 단위 휴가일 때만 사용" : ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          setFields((p) => {
                            const next: any = { ...p, [f.key]: v };
                            if (f.key === "startTime" && isTime && v) {
                              const dur = getTimeBasedDuration(lt);
                              if (dur > 0) next.endTime = computeEndTime(v, dur);
                            }
                            return next;
                          });
                        }}
                        className="w-full border rounded-lg px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-400"
                      />
                    );
                  })()
                ) : (
                  <input
                    type="text"
                    value={fields[f.key] || ""}
                    onChange={(e) => setFields((p) => ({ ...p, [f.key]: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  />
                )}
              </div>
            ))}
          </div>
        );
      })()}

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
