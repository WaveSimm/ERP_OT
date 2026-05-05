"use client";

export const dynamic = 'force-dynamic';

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { equipmentApi, maintenanceApi, compatibilityApi, sensorApi, deploymentApi, projectApi, taskApi, equipmentScheduleApi } from "@/lib/api";
import ScheduleTimeline from "@/components/ScheduleTimeline";
import { DateInput } from "@/components/ui/DateInput";
import { useHolidaysMap } from "@/hooks/useHolidaysMap";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  AVAILABLE: { label: "가용", color: "bg-green-100 text-green-800" },
  IN_OPERATION: { label: "운용중", color: "bg-blue-100 text-blue-800" },
  DEPLOYED: { label: "투입중", color: "bg-blue-100 text-blue-800" },
  IN_MAINTENANCE: { label: "정비중", color: "bg-yellow-100 text-yellow-800" },
  BROKEN: { label: "고장", color: "bg-red-100 text-red-800" },
  RETIRED: { label: "퇴역", color: "bg-gray-100 text-gray-500" },
};

const MAINT_TYPE_LABELS: Record<string, string> = {
  PREVENTIVE: "예방 정비", CORRECTIVE: "수리 정비", CALIBRATION: "교정", UPGRADE: "업그레이드",
};

type Tab = "info" | "history" | "maintenance" | "schedules" | "sensors";

export default function EquipmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const holidays = useHolidaysMap();
  const [equipment, setEquipment] = useState<any>(null);
  const initialTab = (searchParams.get("tab") as Tab) || "info";
  const [tab, setTab] = useState<Tab>(initialTab);
  const [maintenance, setMaintenance] = useState<any[]>([]);
  const [schedules, setSchedules] = useState<any[]>([]);
  const [compatSensors, setCompatSensors] = useState<any[]>([]);
  const [deployments, setDeployments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // History filter
  const [historyFilter, setHistoryFilter] = useState("ALL");

  // Components
  const [components, setComponents] = useState<any[]>([]);
  const [showCompForm, setShowCompForm] = useState(false);
  const [compForm, setCompForm] = useState({ name: "", spec: "", notes: "" });
  const [editingCompId, setEditingCompId] = useState<string | null>(null);

  // Compatibility
  const [showCompatForm, setShowCompatForm] = useState(false);
  const [allSensors, setAllSensors] = useState<any[]>([]);
  const [compatForm, setCompatForm] = useState({ sensorId: "", notes: "" });

  // Maintenance form
  const [showMaintForm, setShowMaintForm] = useState(false);
  const [maintFormType, setMaintFormType] = useState(""); // 어떤 버튼으로 열었는지
  const [maintForm, setMaintForm] = useState({ type: "PREVENTIVE", title: "", description: "", performedBy: "", performedAt: new Date().toISOString().slice(0, 10), cost: "", startDate: new Date().toISOString().slice(0, 10), endDate: new Date().toISOString().slice(0, 10) });

  // Schedule form
  const [showSchedForm, setShowSchedForm] = useState(false);
  const [schedForm, setSchedForm] = useState({ type: "CALIBRATION", title: "", startDate: new Date().toISOString().slice(0, 10), endDate: new Date().toISOString().slice(0, 10), description: "" });

  // Deployment form
  const [showDeployForm, setShowDeployForm] = useState(false);
  const [projects, setProjects] = useState<any[]>([]);
  const [availableSensors, setAvailableSensors] = useState<any[]>([]);
  const [deployForm, setDeployForm] = useState({ projectId: "", projectName: "", taskId: "", taskName: "", startDate: new Date().toISOString().slice(0, 10), endDate: "", selectedSensors: [] as { sensorId: string; name: string; notes: string }[] });
  const [deploySubmitting, setDeploySubmitting] = useState(false);
  const [projectTasks, setProjectTasks] = useState<any[]>([]);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    equipmentApi.get(id).then(setEquipment).catch(() => router.push("/equipment")).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!id) return;
    if (tab === "maintenance" || tab === "history") equipmentApi.getMaintenance(id).then((r) => setMaintenance(r.items ?? [])).catch(() => {});
    if (tab === "schedules" || tab === "history" || tab === "maintenance") {
      equipmentApi.getSchedules(id).then(setSchedules).catch(() => {});
      equipmentApi.getDeployments(id).then((r) => setDeployments(r.items ?? [])).catch(() => {});
    }
    if (tab === "sensors") equipmentApi.getCompatibleSensors(id).then(setCompatSensors).catch(() => {});
  }, [id, tab]);

  const handleAddSchedule = async () => {
    if (!schedForm.title || !schedForm.startDate || !schedForm.endDate) return alert("제목, 시작일, 종료일은 필수입니다.");
    try {
      await equipmentScheduleApi.create({ ...schedForm, equipmentId: id });
      setShowSchedForm(false);
      setSchedForm({ type: "MAINTENANCE", title: "", startDate: new Date().toISOString().slice(0, 10), endDate: new Date().toISOString().slice(0, 10), description: "" });
      equipmentApi.getSchedules(id).then(setSchedules).catch(() => {});
    } catch (err: any) { alert(err.message); }
  };

  const handleDeleteSchedule = async (scheduleId: string) => {
    if (!confirm("이 일정을 삭제하시겠습니까?")) return;
    try {
      await equipmentScheduleApi.remove(scheduleId);
      equipmentApi.getSchedules(id).then(setSchedules).catch(() => {});
    } catch (err: any) { alert(err.message); }
  };

  const loadAvailableSensors = async (start: string, end: string) => {
    try {
      const res = await sensorApi.listAvailable(undefined, start, end || undefined);
      setAvailableSensors(res ?? []);
    } catch {}
  };

  const openDeployForm = async () => {
    const defaultStart = new Date().toISOString().slice(0, 10);
    try {
      const [projRes, sensorRes] = await Promise.all([
        projectApi.list(),
        sensorApi.listAvailable(undefined, defaultStart),
      ]);
      setProjects(projRes.items ?? []);
      setAvailableSensors(sensorRes ?? []);
      setDeployForm({ projectId: "", projectName: "", taskId: "", taskName: "", startDate: defaultStart, endDate: "", selectedSensors: [] });
      setProjectTasks([]);
      setShowDeployForm(true);
    } catch { alert("데이터 로드 실패"); }
  };

  const handleProjectSelect = async (projectId: string) => {
    const project = projects.find((p) => p.id === projectId);
    const start = project?.startDate?.slice(0, 10) ?? deployForm.startDate;
    const end = project?.endDate?.slice(0, 10) ?? deployForm.endDate;
    setDeployForm({ ...deployForm, projectId, projectName: project?.name ?? "", taskId: "", taskName: "", startDate: start, endDate: end, selectedSensors: [] });
    setProjectTasks([]);
    if (projectId) {
      try {
        const tasks = await taskApi.list(projectId);
        setProjectTasks(Array.isArray(tasks) ? tasks : []);
      } catch {}
    }
    if (start) loadAvailableSensors(start, end);
  };

  const toggleSensor = (sensor: any) => {
    const exists = deployForm.selectedSensors.find((s) => s.sensorId === sensor.id);
    if (exists) {
      setDeployForm({ ...deployForm, selectedSensors: deployForm.selectedSensors.filter((s) => s.sensorId !== sensor.id) });
    } else {
      setDeployForm({ ...deployForm, selectedSensors: [...deployForm.selectedSensors, { sensorId: sensor.id, name: sensor.name, notes: "" }] });
    }
  };

  const handleCreateDeployment = async () => {
    if (!deployForm.projectId) return alert("프로젝트를 선택해주세요.");
    if (!deployForm.startDate) return alert("시작일을 입력해주세요.");
    setDeploySubmitting(true);
    try {
      await deploymentApi.create({
        equipmentId: id,
        projectId: deployForm.projectId,
        projectName: deployForm.projectName,
        ...(deployForm.taskId && { taskId: deployForm.taskId }),
        ...(deployForm.taskName && { taskName: deployForm.taskName }),
        startDate: deployForm.startDate,
        ...(deployForm.endDate && { endDate: deployForm.endDate }),
        ...(deployForm.selectedSensors.length > 0 && {
          sensors: deployForm.selectedSensors.map((s) => ({
            sensorId: s.sensorId,
            ...(s.notes && { notes: s.notes }),
          })),
        }),
      });
      setShowDeployForm(false);
      setTab("schedules");
      // 데이터 새로고침
      equipmentApi.get(id).then(setEquipment);
      equipmentApi.getDeployments(id).then((r) => setDeployments(r.items ?? []));
      equipmentApi.getSchedules(id).then(setSchedules).catch(() => {});
    } catch (err: any) {
      alert(err.message || "투입 생성 실패");
    } finally {
      setDeploySubmitting(false);
    }
  };

  const handleAddMaintenance = async () => {
    if (!maintForm.title || !maintForm.performedAt) return alert("제목과 수행일은 필수입니다.");
    try {
      await maintenanceApi.create({ ...maintForm, equipmentId: id, cost: maintForm.cost ? parseFloat(maintForm.cost) : undefined });
      setShowMaintForm(false);
      setMaintForm({ type: "PREVENTIVE", title: "", description: "", performedBy: "", performedAt: new Date().toISOString().slice(0, 10), cost: "", startDate: new Date().toISOString().slice(0, 10), endDate: new Date().toISOString().slice(0, 10) });
      equipmentApi.getMaintenance(id).then((r) => setMaintenance(r.items ?? []));
    } catch (err: any) { alert(err.message); }
  };

  if (loading || !equipment) return <div className="text-center py-12 text-gray-400">불러오는 중...</div>;

  const st = STATUS_LABELS[equipment.status] ?? { label: equipment.status, color: "bg-gray-100" };

  return (
    <>
      <div>
        {/* Header */}
        <div className="flex items-center gap-2 mb-4">
          <h1 className="text-xl font-bold">{equipment.name}</h1>
          <span className={`text-xs px-2 py-0.5 rounded-full ${st.color}`}>{st.label}</span>
        </div>

        {/* Summary */}
        <div className="bg-white border rounded-lg p-4 mb-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div><span className="text-gray-500">종류:</span> {equipment.category?.name}</div>
          <div><span className="text-gray-500">SN:</span> {equipment.serialNumber}</div>
          <div><span className="text-gray-500">제조사:</span> {equipment.manufacturer ?? "-"}</div>
          <div><span className="text-gray-500">모델:</span> {equipment.model ?? "-"}</div>
          <div><span className="text-gray-500">현재 위치:</span> {equipment.currentLocation ?? "창고"}</div>
          {equipment.acquiredAt && <div><span className="text-gray-500">취득일:</span> {new Date(equipment.acquiredAt).toLocaleDateString()}</div>}
          {equipment.description && <div className="col-span-2"><span className="text-gray-500">설명:</span> {equipment.description}</div>}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b mb-4">
          {([["info", "기본정보"], ["history", "전체 이력"], ["schedules", "운영일정"], ["maintenance", "기타일정"], ["sensors", "호환센서"]] as [Tab, string][]).map(
            ([k, label]) => (
              <button key={k} onClick={() => setTab(k)}
                className={`px-4 py-2 text-sm border-b-2 ${tab === k ? "border-blue-600 text-blue-600 font-semibold" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
                {label}
              </button>
            ),
          )}
        </div>

        {/* Tab Content */}
        {tab === "info" && (
          <div className="space-y-4">
            <div className="bg-white border rounded-lg p-4">
              <h3 className="font-semibold mb-3">장비 상세</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-y-3 gap-x-6 text-sm">
                <div><span className="text-gray-500">장비명:</span> {equipment.name}</div>
                <div><span className="text-gray-500">카테고리:</span> {equipment.category?.name ?? "-"}</div>
                <div><span className="text-gray-500">시리얼번호:</span> {equipment.serialNumber}</div>
                <div><span className="text-gray-500">제조사:</span> {equipment.manufacturer ?? "-"}</div>
                <div><span className="text-gray-500">모델:</span> {equipment.model ?? "-"}</div>
                <div><span className="text-gray-500">상태:</span> <span className={`px-2 py-0.5 rounded-full text-xs ${st.color}`}>{st.label}</span></div>
                <div><span className="text-gray-500">현재 위치:</span> {equipment.currentLocation ?? "창고"}</div>
                {equipment.acquiredAt && <div><span className="text-gray-500">취득일:</span> {new Date(equipment.acquiredAt).toLocaleDateString()}</div>}
                <div><span className="text-gray-500">등록일:</span> {new Date(equipment.createdAt).toLocaleDateString()}</div>
              </div>
              {equipment.description && (
                <div className="mt-3 pt-3 border-t text-sm">
                  <span className="text-gray-500">설명:</span>
                  <p className="mt-1 text-gray-700 whitespace-pre-wrap">{equipment.description}</p>
                </div>
              )}
            </div>

            <div className="bg-white border rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">구성요소</h3>
                <button onClick={() => { setShowCompForm(true); setEditingCompId(null); setCompForm({ name: "", spec: "", notes: "" }); }}
                  className="text-xs px-2 py-1 bg-blue-600 text-white rounded">+ 추가</button>
              </div>
              {showCompForm && (
                <div className="mb-3 p-3 bg-gray-50 rounded space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    <input placeholder="이름 *" value={compForm.name} onChange={(e) => setCompForm({ ...compForm, name: e.target.value })} className="border rounded px-2 py-1.5 text-sm" />
                    <input placeholder="사양" value={compForm.spec} onChange={(e) => setCompForm({ ...compForm, spec: e.target.value })} className="border rounded px-2 py-1.5 text-sm" />
                    <input placeholder="비고" value={compForm.notes} onChange={(e) => setCompForm({ ...compForm, notes: e.target.value })} className="border rounded px-2 py-1.5 text-sm" />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setShowCompForm(false)} className="text-xs px-2 py-1 border rounded">취소</button>
                    <button onClick={async () => {
                      if (!compForm.name) return alert("이름은 필수입니다.");
                      try {
                        if (editingCompId) {
                          await equipmentApi.updateComponent(editingCompId, compForm);
                        } else {
                          await equipmentApi.addComponent(id, compForm);
                        }
                        setShowCompForm(false);
                        equipmentApi.get(id).then(setEquipment);
                      } catch (err: any) { alert(err.message); }
                    }} className="text-xs px-2 py-1 bg-blue-600 text-white rounded">{editingCompId ? "수정" : "저장"}</button>
                  </div>
                </div>
              )}
              {(equipment.components?.length ?? 0) === 0 ? (
                <div className="text-sm text-gray-400">등록된 구성요소가 없습니다.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-gray-500">
                      <th className="py-1 text-left">이름</th>
                      <th className="py-1 text-left">사양</th>
                      <th className="py-1 text-left">비고</th>
                      <th className="py-1 w-20"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {equipment.components.map((c: any) => (
                      <tr key={c.id} className="border-b last:border-0 hover:bg-gray-50">
                        <td className="py-1.5">{c.name}</td>
                        <td className="py-1.5 text-gray-600">{c.spec ?? "-"}</td>
                        <td className="py-1.5 text-gray-500">{c.notes ?? "-"}</td>
                        <td className="py-1.5 text-right">
                          <button onClick={() => { setEditingCompId(c.id); setCompForm({ name: c.name, spec: c.spec ?? "", notes: c.notes ?? "" }); setShowCompForm(true); }}
                            className="text-xs text-blue-500 hover:text-blue-700 mr-2">수정</button>
                          <button onClick={async () => { if (!confirm(`${c.name}을(를) 삭제하시겠습니까?`)) return; await equipmentApi.removeComponent(c.id); equipmentApi.get(id).then(setEquipment); }}
                            className="text-xs text-red-500 hover:text-red-700">삭제</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {equipment.sensorCompatibility?.length > 0 && (
              <div className="bg-white border rounded-lg p-4">
                <h3 className="font-semibold mb-3">호환 센서 목록</h3>
                <div className="space-y-1">
                  {equipment.sensorCompatibility.map((c: any) => (
                    <div key={c.id} className="text-sm flex items-center gap-2">
                      <span>📡 {c.sensor?.name}</span>
                      <span className="text-gray-400">({c.sensor?.category?.name})</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_LABELS[c.sensor?.status]?.color ?? "bg-gray-100"}`}>
                        {STATUS_LABELS[c.sensor?.status]?.label ?? c.sensor?.status}
                      </span>
                      {c.notes && <span className="text-gray-400">- {c.notes}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {equipment.metadata && Object.keys(equipment.metadata).length > 0 && (
              <div className="bg-white border rounded-lg p-4">
                <h3 className="font-semibold mb-3">추가 정보 (metadata)</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {Object.entries(equipment.metadata).map(([k, v]) => (
                    <div key={k}><span className="text-gray-500">{k}:</span> {String(v)}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "history" && (() => {
          const HIST_LABELS: Record<string, { label: string; color: string }> = {
            PROJECT: { label: "프로젝트 투입", color: "bg-blue-100 text-blue-700" },
            MAINTENANCE: { label: "정비", color: "bg-yellow-100 text-yellow-700" },
            CALIBRATION: { label: "교정", color: "bg-purple-100 text-purple-700" },
            TRAINING: { label: "교육", color: "bg-green-100 text-green-700" },
            STANDBY: { label: "대기", color: "bg-gray-100 text-gray-600" },
            PREVENTIVE: { label: "예방 정비", color: "bg-yellow-100 text-yellow-700" },
            CORRECTIVE: { label: "수리 정비", color: "bg-orange-100 text-orange-700" },
            UPGRADE: { label: "업그레이드", color: "bg-teal-100 text-teal-700" },
          };
          const combined: { typeKey: string; label: string; color: string; title: string; startDate: string; endDate: string; detail: string; projectId?: string }[] = [];
          for (const m of maintenance) {
            const h = HIST_LABELS[m.type] ?? { label: m.type, color: "bg-gray-100 text-gray-600" };
            combined.push({
              typeKey: m.type, label: h.label, color: h.color, title: m.title,
              startDate: m.performedAt,
              endDate: m.completedAt || m.performedAt,
              detail: [m.performedBy, m.cost ? `${Number(m.cost).toLocaleString()}원` : null, m.description].filter(Boolean).join(" / ") || "-",
            });
          }
          for (const s of schedules.filter((s) => s.type === "PROJECT")) {
            const h = HIST_LABELS[s.type] ?? { label: s.type, color: "bg-gray-100 text-gray-600" };
            combined.push({
              typeKey: s.type, label: h.label, color: h.color,
              title: s.projectName || s.title,
              startDate: s.startDate,
              endDate: s.endDate,
              detail: s.description || "-",
              projectId: s.projectId,
            });
          }
          combined.sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
          const filtered = historyFilter === "ALL" ? combined : combined.filter((r) => r.typeKey === historyFilter);
          return (
            <div className="space-y-3">
              <ScheduleTimeline schedules={[
                ...schedules,
                ...maintenance.map((m: any) => ({ id: m.id, type: m.type, title: m.title, startDate: m.performedAt, endDate: m.completedAt || m.performedAt })),
              ]} holidays={holidays} />
              <div>
                <select value={historyFilter} onChange={(e) => setHistoryFilter(e.target.value)} className="border rounded px-3 py-1.5 text-sm">
                  <option value="ALL">전체</option>
                  <option value="PROJECT">프로젝트 투입</option>
                  <option value="PREVENTIVE">예방 정비</option>
                  <option value="CORRECTIVE">수리 정비</option>
                  <option value="CALIBRATION">교정</option>
                  <option value="UPGRADE">업그레이드</option>
                  <option value="TRAINING">교육</option>
                  <option value="STANDBY">대기</option>
                  <option value="MAINTENANCE">정비 일정</option>
                </select>
              </div>
              {filtered.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm">이력이 없습니다.</div>
              ) : (
                <table className="w-full text-sm border">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="p-2 text-left">구분</th>
                      <th className="p-2 text-left">제목</th>
                      <th className="p-2 text-left">시작일</th>
                      <th className="p-2 text-left">종료일</th>
                      <th className="p-2 text-left">상세</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((row, i) => (
                      <tr key={i} className="border-t hover:bg-gray-50">
                        <td className="p-2"><span className={`text-xs px-2 py-0.5 rounded-full ${row.color}`}>{row.label}</span></td>
                        <td className="p-2">{row.projectId ? <Link href={`/projects/${row.projectId}`} className="text-blue-600 hover:underline">{row.title}</Link> : row.title}</td>
                        <td className="p-2">{new Date(row.startDate).toLocaleDateString()}</td>
                        <td className="p-2">{new Date(row.endDate).toLocaleDateString()}</td>
                        <td className="p-2 text-gray-500">{row.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })()}

        {tab === "maintenance" && (() => {
          const TYPE_INFO: Record<string, { label: string; color: string; btnColor: string }> = {
            PREVENTIVE:  { label: "정비", color: "bg-yellow-100 text-yellow-700", btnColor: "bg-yellow-600" },
            CORRECTIVE:  { label: "수리", color: "bg-orange-100 text-orange-700", btnColor: "bg-orange-600" },
            CALIBRATION: { label: "교정", color: "bg-purple-100 text-purple-700", btnColor: "bg-purple-600" },
            TRAINING:    { label: "교육", color: "bg-green-100 text-green-700", btnColor: "bg-green-600" },
            STANDBY:     { label: "대기", color: "bg-gray-100 text-gray-600", btnColor: "bg-gray-600" },
          };
          const maintSchedules = maintenance.map((m: any) => ({
            id: m.id, type: m.type, title: m.title,
            startDate: new Date(m.performedAt).toISOString().slice(0, 10),
            endDate: m.completedAt ? new Date(m.completedAt).toISOString().slice(0, 10) : new Date(m.performedAt).toISOString().slice(0, 10),
          }));
          const records = maintenance.map((m: any) => ({
            id: m.id, type: m.type, title: m.title,
            startDate: new Date(m.performedAt).toISOString().slice(0, 10),
            endDate: m.completedAt ? new Date(m.completedAt).toISOString().slice(0, 10) : new Date(m.performedAt).toISOString().slice(0, 10),
            performedBy: m.performedBy, cost: m.cost, description: m.description, completedAt: m.completedAt,
          })).sort((a: any, b: any) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());

          const reload = () => {
            equipmentApi.getMaintenance(id).then((r) => setMaintenance(r.items ?? []));
            equipmentApi.getSchedules(id).then(setSchedules);
          };

          const checkOverlap = (rid: string, newStart: string, newEnd: string): string | null => {
            if (newStart > newEnd) return "시작일이 종료일보다 늦을 수 없습니다.";
            const s1 = new Date(newStart + "T00:00:00").getTime();
            const e1 = new Date(newEnd + "T00:00:00").getTime();
            // 같은 장비의 다른 정비 기록과 비교
            for (const m of records) {
              if (m.id === rid) continue;
              const s2 = new Date(m.startDate + "T00:00:00").getTime();
              const e2 = new Date(m.endDate + "T00:00:00").getTime();
              if (s1 <= e2 && e1 >= s2) {
                const info = TYPE_INFO[m.type] ?? { label: m.type };
                return `[${info.label}] ${m.title} (${m.startDate} ~ ${m.endDate})과 일정이 겹칩니다.`;
              }
            }
            for (const s of schedules) {
              if (s.type !== "PROJECT") continue;
              const sd = s.startDate?.slice(0, 10);
              const ed = s.endDate?.slice(0, 10);
              if (!sd || !ed) continue;
              const s2 = new Date(sd + "T00:00:00").getTime();
              const e2 = new Date(ed + "T00:00:00").getTime();
              if (s1 <= e2 && e1 >= s2) return `[운영일정] ${s.title} (${sd} ~ ${ed})과 일정이 겹칩니다.`;
            }
            return null;
          };

          const handleDateChange = async (rid: string, field: "startDate" | "endDate", value: string) => {
            const rec = records.find((r: any) => r.id === rid);
            if (!rec) return;
            const newStart = field === "startDate" ? value : rec.startDate;
            const newEnd = field === "endDate" ? value : rec.endDate;
            const overlap = checkOverlap(rid, newStart, newEnd);
            if (overlap && !confirm(`${overlap}\n그래도 변경하시겠습니까?`)) return;
            try {
              const data: any = {};
              if (field === "startDate") data.performedAt = value;
              else data.completedAt = value;
              await maintenanceApi.update(rid, data);
              reload();
            } catch (err: any) { alert(err.message); }
          };

          const handleComplete = async (rid: string) => {
            const rec = records.find((r: any) => r.id === rid);
            if (!rec) return;
            if (!confirm(`완료 후에는 수정할 수 없습니다.\n(${rec.startDate} ~ ${rec.endDate}) 완료하시겠습니까?`)) return;
            const endDate = rec.endDate || new Date().toISOString().slice(0, 10);
            const overlap = checkOverlap(rid, rec.startDate, endDate);
            if (overlap && !confirm(`${overlap}\n그래도 완료하시겠습니까?`)) return;
            try {
              await maintenanceApi.update(rid, { completedAt: endDate });
              reload();
            } catch (err: any) { alert(err.message); }
          };

          const handleCancel = async (r: any) => {
            if (!confirm("이 기록을 삭제하시겠습니까?")) return;
            try {
              await maintenanceApi.remove(r.id);
              reload();
            } catch (err: any) { alert(err.message); }
          };

          const openForm = (type: string) => {
            const today = new Date().toISOString().slice(0, 10);
            setMaintFormType(type);
            setMaintForm({ type, title: "", description: "", performedBy: "", performedAt: today, cost: "", startDate: today, endDate: today });
            setShowMaintForm(true);
          };

          return (
          <div className="space-y-3">
            <ScheduleTimeline schedules={maintSchedules} holidays={holidays} />
            <div className="flex gap-2 flex-wrap">
              {Object.entries(TYPE_INFO).map(([key, info]) => (
                <button key={key} onClick={() => openForm(key)}
                  className={`px-3 py-1.5 ${info.btnColor} text-white rounded text-sm hover:opacity-90`}>+ {info.label}</button>
              ))}
            </div>

            {showMaintForm && (
              <div className="bg-white border rounded-lg p-4 space-y-3">
                <div className="text-sm font-semibold text-gray-700">{TYPE_INFO[maintFormType]?.label ?? maintFormType} 등록</div>
                <div className="grid grid-cols-2 gap-3">
                  <input placeholder="제목 *" value={maintForm.title} onChange={(e) => setMaintForm({ ...maintForm, title: e.target.value })} className="border rounded px-3 py-2 text-sm" />
                  <input placeholder="수행자" value={maintForm.performedBy} onChange={(e) => setMaintForm({ ...maintForm, performedBy: e.target.value })} className="border rounded px-3 py-2 text-sm" />
                  <DateInput value={maintForm.startDate} onChange={(e) => setMaintForm({ ...maintForm, startDate: e.target.value, performedAt: e.target.value })} className="border rounded px-3 py-2 text-sm" />
                  <DateInput value={maintForm.endDate} onChange={(e) => setMaintForm({ ...maintForm, endDate: e.target.value })} className="border rounded px-3 py-2 text-sm" />
                  <input placeholder="비용 (원)" value={maintForm.cost} onChange={(e) => setMaintForm({ ...maintForm, cost: e.target.value })} className="border rounded px-3 py-2 text-sm" />
                  <input placeholder="설명 (선택)" value={maintForm.description} onChange={(e) => setMaintForm({ ...maintForm, description: e.target.value })} className="border rounded px-3 py-2 text-sm" />
                </div>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setShowMaintForm(false)} className="px-3 py-1.5 border rounded text-sm">취소</button>
                  <button onClick={async () => {
                    if (!maintForm.title || !maintForm.startDate) return alert("제목과 시작일은 필수입니다.");
                    const end = maintForm.endDate || maintForm.startDate;
                    const overlap = checkOverlap("", maintForm.startDate, end);
                    if (overlap && !confirm(`${overlap}\n그래도 등록하시겠습니까?`)) return;
                    try {
                      await maintenanceApi.create({ ...maintForm, equipmentId: id, performedAt: maintForm.startDate, completedAt: end !== maintForm.startDate ? end : undefined, cost: maintForm.cost ? parseFloat(maintForm.cost) : undefined });
                      setShowMaintForm(false);
                      reload();
                    } catch (err: any) { alert(err.message); }
                  }} className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm">저장</button>
                </div>
              </div>
            )}

            {records.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-sm">기타 일정이 없습니다.</div>
            ) : (
              <table className="w-full text-sm border">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="p-2 text-left">타입</th>
                    <th className="p-2 text-left">제목</th>
                    <th className="p-2 text-left">시작일</th>
                    <th className="p-2 text-left">종료일</th>
                    <th className="p-2 text-left">수행자</th>
                    <th className="p-2 text-right">비용</th>
                    <th className="p-2 text-center">액션</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r: any) => {
                    const info = TYPE_INFO[r.type] ?? { label: r.type, color: "bg-gray-100 text-gray-600" };
                    const isCompleted = !!r.completedAt;
                    return (
                      <tr key={r.id} className="border-t hover:bg-gray-50">
                        <td className="p-2"><span className={`text-xs px-2 py-0.5 rounded-full ${info.color}`}>{info.label}</span></td>
                        <td className="p-2">{r.title}{r.description && <span className="text-gray-400 ml-1">- {r.description}</span>}</td>
                        <td className="p-2">
                          {isCompleted ? new Date(r.startDate).toLocaleDateString() : (
                            <DateInput defaultValue={r.startDate} onBlur={(e) => { if (e.target.value !== r.startDate) handleDateChange(r.id, "startDate", e.target.value); }}
                              className="border rounded px-1.5 py-0.5 text-xs w-[120px]" />
                          )}
                        </td>
                        <td className="p-2">
                          {isCompleted ? new Date(r.endDate).toLocaleDateString() : (
                            <DateInput defaultValue={r.endDate} onBlur={(e) => { if (e.target.value !== r.endDate) handleDateChange(r.id, "endDate", e.target.value); }}
                              className="border rounded px-1.5 py-0.5 text-xs w-[120px]" />
                          )}
                        </td>
                        <td className="p-2">{r.performedBy ?? "-"}</td>
                        <td className="p-2 text-right">{r.cost ? Number(r.cost).toLocaleString() + "원" : "-"}</td>
                        <td className="p-2 text-center">
                          {isCompleted ? (
                            <span className="text-xs text-gray-400">완료됨</span>
                          ) : (
                            <div className="flex gap-1 justify-center">
                              <button onClick={() => handleComplete(r.id)} className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200">완료</button>
                              <button onClick={() => handleCancel(r)} className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200">취소</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          );
        })()}

        {tab === "schedules" && (() => {
          const projectSchedules = schedules.filter((s) => s.type === "PROJECT");

          const reloadSchedules = () => {
            equipmentApi.getSchedules(id).then(setSchedules).catch(() => {});
            equipmentApi.getDeployments(id).then((r) => setDeployments(r.items ?? []));
            equipmentApi.get(id).then(setEquipment);
          };

          const handleSchedDateChange = async (schedId: string, field: "startDate" | "endDate", value: string) => {
            try {
              await equipmentScheduleApi.update(schedId, { [field]: value });
              reloadSchedules();
            } catch (err: any) { alert(err.message); }
          };

          const handleSchedComplete = async (s: any) => {
            const sd = s.startDate?.slice(0, 10) ?? new Date(s.startDate).toISOString().slice(0, 10);
            const ed = s.endDate?.slice(0, 10) ?? new Date(s.endDate).toISOString().slice(0, 10);
            if (!confirm(`완료 후에는 수정할 수 없습니다.\n(${sd} ~ ${ed}) 완료하시겠습니까?`)) return;
            try {
              if (s.deploymentId) {
                const dep = deployments.find((d) => d.id === s.deploymentId);
                if (dep?.status === "PLANNED") await deploymentApi.activate(dep.id);
                if (dep?.status === "PLANNED" || dep?.status === "ACTIVE") await deploymentApi.complete(s.deploymentId);
              }
              reloadSchedules();
            } catch (err: any) { alert(err.message); }
          };

          const handleSchedCancel = async (s: any) => {
            if (!confirm("이 일정을 삭제하시겠습니까?")) return;
            try {
              if (s.deploymentId) await deploymentApi.cancel(s.deploymentId);
              else await equipmentScheduleApi.remove(s.id);
              reloadSchedules();
            } catch (err: any) { alert(err.message); }
          };

          return (
            <div className="space-y-3">
              <ScheduleTimeline schedules={projectSchedules} holidays={holidays} />
              <div className="flex gap-2">
                {(equipment.status === "AVAILABLE" || equipment.status === "IN_OPERATION") && (
                  <button onClick={openDeployForm} className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm">+ 프로젝트에 투입</button>
                )}
              </div>
              {projectSchedules.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm">프로젝트 투입 이력이 없습니다.</div>
              ) : (
                <table className="w-full text-sm border">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="p-2 text-left">프로젝트</th>
                      <th className="p-2 text-left">태스크</th>
                      <th className="p-2 text-left">시작일</th>
                      <th className="p-2 text-left">종료일</th>
                      <th className="p-2 text-center">액션</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projectSchedules.map((s) => {
                      const dep = s.deploymentId ? deployments.find((d) => d.id === s.deploymentId) : null;
                      const isCompleted = dep?.status === "COMPLETED";
                      const sd = new Date(s.startDate).toISOString().slice(0, 10);
                      const ed = new Date(s.endDate).toISOString().slice(0, 10);
                      return (
                      <tr key={s.id} className="border-t hover:bg-gray-50">
                        <td className="p-2">{s.projectId ? <Link href={`/projects/${s.projectId}`} className="text-blue-600 hover:underline">{s.projectName || s.title}</Link> : s.title}</td>
                        <td className="p-2 text-gray-600">{dep?.taskName || s.description || "-"}</td>
                        <td className="p-2">
                          {isCompleted ? new Date(s.startDate).toLocaleDateString() : (
                            <DateInput defaultValue={sd} onBlur={(e) => { if (e.target.value !== sd) handleSchedDateChange(s.id, "startDate", e.target.value); }}
                              className="border rounded px-1.5 py-0.5 text-xs w-[120px]" />
                          )}
                        </td>
                        <td className="p-2">
                          {isCompleted ? new Date(s.endDate).toLocaleDateString() : (
                            <DateInput defaultValue={ed} onBlur={(e) => { if (e.target.value !== ed) handleSchedDateChange(s.id, "endDate", e.target.value); }}
                              className="border rounded px-1.5 py-0.5 text-xs w-[120px]" />
                          )}
                        </td>
                        <td className="p-2 text-center">
                          {isCompleted ? (
                            <span className="text-xs text-gray-400">완료됨</span>
                          ) : (
                            <div className="flex gap-1 justify-center">
                              <button onClick={() => handleSchedComplete(s)} className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200">완료</button>
                              <button onClick={() => handleSchedCancel(s)} className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200">취소</button>
                            </div>
                          )}
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          );
        })()}

        {tab === "sensors" && (
          <div className="space-y-3">
            <div>
              <button onClick={async () => {
                if (!showCompatForm) {
                  try { const res = await sensorApi.list({ limit: 200 }); setAllSensors(res.items ?? []); } catch {}
                }
                setShowCompatForm(!showCompatForm);
                setCompatForm({ sensorId: "", notes: "" });
              }} className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm">+ 호환센서 추가</button>
            </div>
            {showCompatForm && (() => {
              const alreadyIds = new Set(compatSensors.map((c: any) => c.sensor?.id));
              const available = allSensors.filter((s) => !alreadyIds.has(s.id));
              return (
                <div className="bg-white border rounded-lg p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <select value={compatForm.sensorId} onChange={(e) => setCompatForm({ ...compatForm, sensorId: e.target.value })} className="border rounded px-3 py-2 text-sm">
                      <option value="">-- 센서 선택 --</option>
                      {available.map((s) => (
                        <option key={s.id} value={s.id}>{s.name} ({s.category?.name})</option>
                      ))}
                    </select>
                    <input placeholder="비고 (선택)" value={compatForm.notes} onChange={(e) => setCompatForm({ ...compatForm, notes: e.target.value })} className="border rounded px-3 py-2 text-sm" />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setShowCompatForm(false)} className="px-3 py-1.5 border rounded text-sm">취소</button>
                    <button onClick={async () => {
                      if (!compatForm.sensorId) return alert("센서를 선택해주세요.");
                      try {
                        await compatibilityApi.create({ equipmentId: id, sensorId: compatForm.sensorId, ...(compatForm.notes && { notes: compatForm.notes }) });
                        setShowCompatForm(false);
                        equipmentApi.getCompatibleSensors(id).then(setCompatSensors);
                      } catch (err: any) { alert(err.message); }
                    }} className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm">저장</button>
                  </div>
                </div>
              );
            })()}
            {compatSensors.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-sm">등록된 호환 센서가 없습니다.</div>
            ) : (
              <div className="space-y-2">
                {compatSensors.map((c) => (
                  <div key={c.id} className="bg-white border rounded p-3 flex items-center justify-between">
                    <div>
                      <span className="font-medium">{c.sensor?.name}</span>
                      <span className="ml-2 text-xs text-gray-500">{c.sensor?.category?.name}</span>
                      <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${STATUS_LABELS[c.sensor?.status]?.color ?? "bg-gray-100"}`}>
                        {STATUS_LABELS[c.sensor?.status]?.label ?? c.sensor?.status}
                      </span>
                      {c.notes && <span className="ml-2 text-xs text-gray-400">- {c.notes}</span>}
                    </div>
                    <button onClick={async () => {
                      if (!confirm(`${c.sensor?.name} 호환성을 삭제하시겠습니까?`)) return;
                      try {
                        await compatibilityApi.remove(c.id);
                        equipmentApi.getCompatibleSensors(id).then(setCompatSensors);
                      } catch (err: any) { alert(err.message); }
                    }} className="text-xs text-red-500 hover:text-red-700">삭제</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 프로젝트 투입 모달 */}
        {showDeployForm && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={() => setShowDeployForm(false)}>
            <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="p-5 border-b">
                <h2 className="text-lg font-bold">프로젝트에 투입</h2>
                <p className="text-sm text-gray-500 mt-1">{equipment.name}을(를) 프로젝트에 투입합니다.</p>
              </div>
              <div className="p-5 space-y-4">
                {/* 프로젝트 선택 */}
                <div>
                  <label className="block text-sm font-medium mb-1">프로젝트 *</label>
                  <select value={deployForm.projectId} onChange={(e) => handleProjectSelect(e.target.value)}
                    className="w-full border rounded px-3 py-2 text-sm">
                    <option value="">-- 프로젝트 선택 --</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>

                {/* 태스크 선택 */}
                {deployForm.projectId && (
                  <div>
                    <label className="block text-sm font-medium mb-1">태스크 (선택)</label>
                    <select value={deployForm.taskId} onChange={(e) => {
                        const task = projectTasks.find((t: any) => t.id === e.target.value);
                        const startDate = task?.effectiveStartDate?.slice(0, 10) || task?.segments?.[0]?.startDate?.slice(0, 10) || deployForm.startDate;
                        const endDate = task?.effectiveEndDate?.slice(0, 10) || task?.segments?.at(-1)?.endDate?.slice(0, 10) || deployForm.endDate;
                        setDeployForm({ ...deployForm, taskId: e.target.value, taskName: task?.name ?? "", startDate, endDate });
                        if (startDate) loadAvailableSensors(startDate, endDate);
                      }}
                      className="w-full border rounded px-3 py-2 text-sm">
                      <option value="">-- 태스크 선택 (선택사항) --</option>
                      {projectTasks.map((t: any) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* 기간 */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">시작일 *</label>
                    <DateInput value={deployForm.startDate} onChange={(e) => {
                        const newStart = e.target.value;
                        setDeployForm({ ...deployForm, startDate: newStart, selectedSensors: [] });
                        if (newStart) loadAvailableSensors(newStart, deployForm.endDate);
                      }}
                      className="w-full border rounded px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">종료일 (예정)</label>
                    <DateInput value={deployForm.endDate} onChange={(e) => {
                        const newEnd = e.target.value;
                        setDeployForm({ ...deployForm, endDate: newEnd, selectedSensors: [] });
                        if (deployForm.startDate) loadAvailableSensors(deployForm.startDate, newEnd);
                      }}
                      className="w-full border rounded px-3 py-2 text-sm" />
                  </div>
                </div>

                {/* 센서 선택 */}
                <div>
                  <label className="block text-sm font-medium mb-1">장착할 센서 (선택사항)</label>
                  {availableSensors.length === 0 ? (
                    <p className="text-sm text-gray-400">가용 센서가 없습니다.</p>
                  ) : (
                    <div className="space-y-2 max-h-48 overflow-y-auto border rounded p-2">
                      {availableSensors.map((sensor) => {
                        const selected = deployForm.selectedSensors.find((s) => s.sensorId === sensor.id);
                        return (
                          <label key={sensor.id} className={`flex items-center gap-2 p-2 rounded cursor-pointer ${selected ? "bg-blue-50 border border-blue-200" : "hover:bg-gray-50"}`}>
                            <input type="checkbox" checked={!!selected} onChange={() => toggleSensor(sensor)} className="rounded" />
                            <div className="flex-1">
                              <span className="text-sm font-medium">{sensor.name}</span>
                              <span className="text-xs text-gray-400 ml-2">{sensor.category?.name} / SN: {sensor.serialNumber}</span>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 선택된 센서 메모 */}
                {deployForm.selectedSensors.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium mb-1">센서별 메모 (선택)</label>
                    <div className="space-y-2">
                      {deployForm.selectedSensors.map((s, i) => (
                        <div key={s.sensorId} className="flex items-center gap-2">
                          <span className="text-sm w-24 truncate">{s.name}</span>
                          <input placeholder="설정/메모" value={s.notes}
                            onChange={(e) => {
                              const updated = [...deployForm.selectedSensors];
                              updated[i] = { ...updated[i], notes: e.target.value };
                              setDeployForm({ ...deployForm, selectedSensors: updated });
                            }}
                            className="flex-1 border rounded px-2 py-1 text-sm" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="p-5 border-t flex gap-2 justify-end">
                <button onClick={() => setShowDeployForm(false)} className="px-4 py-2 border rounded text-sm">취소</button>
                <button onClick={handleCreateDeployment} disabled={deploySubmitting}
                  className="px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {deploySubmitting ? "처리중..." : "투입 생성"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
