"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AppLayout from "@/components/AppLayout";
import { sensorApi, maintenanceApi, equipmentScheduleApi, deploymentApi, projectApi, compatibilityApi } from "@/lib/api";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  AVAILABLE: { label: "가용", color: "bg-green-100 text-green-800" },
  DEPLOYED: { label: "투입중", color: "bg-blue-100 text-blue-800" },
  IN_OPERATION: { label: "운용중", color: "bg-blue-100 text-blue-800" },
  IN_MAINTENANCE: { label: "정비중", color: "bg-yellow-100 text-yellow-800" },
  BROKEN: { label: "고장", color: "bg-red-100 text-red-800" },
  RETIRED: { label: "퇴역", color: "bg-gray-100 text-gray-500" },
};

const MAINT_TYPE_LABELS: Record<string, string> = {
  PREVENTIVE: "예방 정비", CORRECTIVE: "수리 정비", CALIBRATION: "교정", UPGRADE: "업그레이드",
};

type Tab = "info" | "history" | "maintenance" | "schedules" | "compat";

export default function SensorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [sensor, setSensor] = useState<any>(null);
  const [tab, setTab] = useState<Tab>("info");
  const [maintenance, setMaintenance] = useState<any[]>([]);
  const [sensorSchedules, setSensorSchedules] = useState<any[]>([]);
  const [deployments, setDeployments] = useState<any[]>([]);
  const [compatEquipment, setCompatEquipment] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // History filter
  const [historyFilter, setHistoryFilter] = useState("ALL");

  // Maintenance form
  const [showMaintForm, setShowMaintForm] = useState(false);
  const [maintForm, setMaintForm] = useState({ type: "PREVENTIVE", title: "", description: "", performedBy: "", performedAt: new Date().toISOString().slice(0, 10), cost: "" });

  // Schedule form
  const [showSchedForm, setShowSchedForm] = useState(false);
  const [schedForm, setSchedForm] = useState({ type: "CALIBRATION", title: "", startDate: new Date().toISOString().slice(0, 10), endDate: new Date().toISOString().slice(0, 10), description: "" });

  // Deployment form (센서 단독 투입)
  const [showDeployForm, setShowDeployForm] = useState(false);
  const [projects, setProjects] = useState<any[]>([]);
  const [deployForm, setDeployForm] = useState({ projectId: "", projectName: "", startDate: new Date().toISOString().slice(0, 10), endDate: "", notes: "" });
  const [deploySubmitting, setDeploySubmitting] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    sensorApi.get(id).then(setSensor).catch(() => router.push("/equipment/sensors")).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!id) return;
    if (tab === "maintenance" || tab === "history") sensorApi.getMaintenance(id).then((r) => setMaintenance(r.items ?? [])).catch(() => {});
    if (tab === "schedules" || tab === "history") {
      sensorApi.getSchedules(id).then(setSensorSchedules).catch(() => {});
      sensorApi.getDeployments(id).then((r) => setDeployments(r.items ?? [])).catch(() => {});
    }
    if (tab === "compat") sensorApi.getCompatibleEquipment(id).then(setCompatEquipment).catch(() => {});
  }, [id, tab]);

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handleAddMaintenance = async () => {
    if (!maintForm.title || !maintForm.performedAt) return alert("제목과 수행일은 필수입니다.");
    try {
      await maintenanceApi.create({ ...maintForm, sensorId: id, cost: maintForm.cost ? parseFloat(maintForm.cost) : undefined });
      setShowMaintForm(false);
      setMaintForm({ type: "PREVENTIVE", title: "", description: "", performedBy: "", performedAt: new Date().toISOString().slice(0, 10), cost: "" });
      sensorApi.getMaintenance(id).then((r) => setMaintenance(r.items ?? []));
    } catch (err: any) { alert(err.message); }
  };

  const handleAddSchedule = async () => {
    if (!schedForm.title || !schedForm.startDate || !schedForm.endDate) return alert("제목, 시작일, 종료일은 필수입니다.");
    try {
      await equipmentScheduleApi.create({ ...schedForm, sensorId: id });
      setShowSchedForm(false);
      setSchedForm({ type: "CALIBRATION", title: "", startDate: new Date().toISOString().slice(0, 10), endDate: new Date().toISOString().slice(0, 10), description: "" });
      sensorApi.getSchedules(id).then(setSensorSchedules).catch(() => {});
    } catch (err: any) { alert(err.message); }
  };

  const handleDeleteSchedule = async (scheduleId: string) => {
    if (!confirm("이 일정을 삭제하시겠습니까?")) return;
    try {
      await equipmentScheduleApi.remove(scheduleId);
      sensorApi.getSchedules(id).then(setSensorSchedules).catch(() => {});
    } catch (err: any) { alert(err.message); }
  };

  const openDeployForm = async () => {
    try {
      const projRes = await projectApi.list();
      setProjects(projRes.items ?? []);
      setDeployForm({ projectId: "", projectName: "", startDate: new Date().toISOString().slice(0, 10), endDate: "", notes: "" });
      setShowDeployForm(true);
    } catch { alert("프로젝트 목록 로드 실패"); }
  };

  const handleCreateDeployment = async () => {
    if (!deployForm.projectId) return alert("프로젝트를 선택해주세요.");
    if (!deployForm.startDate) return alert("시작일을 입력해주세요.");
    setDeploySubmitting(true);
    try {
      await deploymentApi.create({
        projectId: deployForm.projectId,
        projectName: deployForm.projectName,
        startDate: deployForm.startDate,
        ...(deployForm.endDate && { endDate: deployForm.endDate }),
        sensors: [{ sensorId: id }],
        ...(deployForm.notes && { notes: deployForm.notes }),
      });
      setShowDeployForm(false);
      setTab("schedules");
      sensorApi.get(id).then(setSensor);
      sensorApi.getSchedules(id).then(setSensorSchedules).catch(() => {});
      sensorApi.getDeployments(id).then((r) => setDeployments(r.items ?? [])).catch(() => {});
    } catch (err: any) {
      alert(err.message || "투입 생성 실패");
    } finally {
      setDeploySubmitting(false);
    }
  };

  const reloadSchedules = () => {
    sensorApi.getSchedules(id).then(setSensorSchedules).catch(() => {});
    sensorApi.getDeployments(id).then((r) => setDeployments(r.items ?? [])).catch(() => {});
    sensorApi.get(id).then(setSensor);
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  if (loading || !sensor) return <AppLayout><div className="text-center py-12 text-gray-400">불러오는 중...</div></AppLayout>;

  const st = STATUS_LABELS[sensor.status] ?? { label: sensor.status, color: "bg-gray-100" };

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-2 mb-4">
          <button onClick={() => router.push("/equipment/sensors")} className="text-gray-400 hover:text-gray-600">&larr;</button>
          <h1 className="text-2xl font-bold">{sensor.name}</h1>
          <span className={`text-xs px-2 py-0.5 rounded-full ${st.color}`}>{st.label}</span>
        </div>

        {/* Summary */}
        <div className="bg-white border rounded-lg p-4 mb-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div><span className="text-gray-500">종류:</span> {sensor.category?.name}</div>
          <div><span className="text-gray-500">SN:</span> {sensor.serialNumber}</div>
          <div><span className="text-gray-500">제조사:</span> {sensor.manufacturer ?? "-"}</div>
          <div><span className="text-gray-500">모델:</span> {sensor.model ?? "-"}</div>
          <div><span className="text-gray-500">현재 위치:</span> {sensor.currentLocation ?? "창고"}</div>
          {sensor.calibrationIntervalDays && (
            <div><span className="text-gray-500">교정 주기:</span> {sensor.calibrationIntervalDays}일</div>
          )}
          {sensor.lastCalibratedAt && (
            <div><span className="text-gray-500">최근 교정:</span> {new Date(sensor.lastCalibratedAt).toLocaleDateString()}</div>
          )}
          {sensor.nextCalibrationDue && (
            <div>
              <span className="text-gray-500">교정 만료:</span>{" "}
              <span className={sensor.calibrationDaysRemaining != null && sensor.calibrationDaysRemaining <= 30 ? "text-orange-600 font-semibold" : ""}>
                {new Date(sensor.nextCalibrationDue).toLocaleDateString()}
                {sensor.calibrationDaysRemaining != null && ` (D-${sensor.calibrationDaysRemaining})`}
              </span>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b mb-4">
          {([["info", "기본정보"], ["history", "전체 이력"], ["schedules", "운영일정"], ["maintenance", "정비이력"], ["compat", "호환장비"]] as [Tab, string][]).map(
            ([k, label]) => (
              <button key={k} onClick={() => setTab(k)}
                className={`px-4 py-2 text-sm border-b-2 ${tab === k ? "border-blue-600 text-blue-600 font-semibold" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
                {label}
              </button>
            ),
          )}
        </div>

        {/* ═══ 기본정보 탭 ═══ */}
        {tab === "info" && (
          <div className="space-y-4">
            <div className="bg-white border rounded-lg p-4">
              <h3 className="font-semibold mb-3">센서 상세</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-y-3 gap-x-6 text-sm">
                <div><span className="text-gray-500">센서명:</span> {sensor.name}</div>
                <div><span className="text-gray-500">카테고리:</span> {sensor.category?.name ?? "-"}</div>
                <div><span className="text-gray-500">시리얼번호:</span> {sensor.serialNumber}</div>
                <div><span className="text-gray-500">제조사:</span> {sensor.manufacturer ?? "-"}</div>
                <div><span className="text-gray-500">모델:</span> {sensor.model ?? "-"}</div>
                <div><span className="text-gray-500">상태:</span> <span className={`px-2 py-0.5 rounded-full text-xs ${st.color}`}>{st.label}</span></div>
                <div><span className="text-gray-500">현재 위치:</span> {sensor.currentLocation ?? "창고"}</div>
                <div><span className="text-gray-500">등록일:</span> {new Date(sensor.createdAt).toLocaleDateString()}</div>
              </div>
              {sensor.description && (
                <div className="mt-3 pt-3 border-t text-sm">
                  <span className="text-gray-500">설명:</span>
                  <p className="mt-1 text-gray-700 whitespace-pre-wrap">{sensor.description}</p>
                </div>
              )}
            </div>

            {/* 교정 정보 */}
            {(sensor.calibrationIntervalDays || sensor.lastCalibratedAt) && (
              <div className="bg-white border rounded-lg p-4">
                <h3 className="font-semibold mb-3">교정 정보</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-y-3 gap-x-6 text-sm">
                  {sensor.calibrationIntervalDays && <div><span className="text-gray-500">교정 주기:</span> {sensor.calibrationIntervalDays}일</div>}
                  {sensor.lastCalibratedAt && <div><span className="text-gray-500">최근 교정일:</span> {new Date(sensor.lastCalibratedAt).toLocaleDateString()}</div>}
                  {sensor.nextCalibrationDue && (
                    <div>
                      <span className="text-gray-500">다음 교정:</span>{" "}
                      <span className={sensor.calibrationDaysRemaining != null && sensor.calibrationDaysRemaining <= 30 ? "text-orange-600 font-semibold" : "text-green-600"}>
                        {new Date(sensor.nextCalibrationDue).toLocaleDateString()}
                        {sensor.calibrationDaysRemaining != null && ` (D-${sensor.calibrationDaysRemaining})`}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ 전체 이력 탭 ═══ */}
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
          const combined: { date: string; typeKey: string; label: string; color: string; title: string; detail: string }[] = [];
          for (const m of maintenance) {
            const h = HIST_LABELS[m.type] ?? { label: m.type, color: "bg-gray-100 text-gray-600" };
            combined.push({
              date: m.performedAt,
              typeKey: m.type,
              label: h.label,
              color: h.color,
              title: m.title,
              detail: [m.performedBy, m.cost ? `${Number(m.cost).toLocaleString()}원` : null].filter(Boolean).join(" / ") || "-",
            });
          }
          for (const s of sensorSchedules) {
            const h = HIST_LABELS[s.type] ?? { label: s.type, color: "bg-gray-100 text-gray-600" };
            combined.push({
              date: s.startDate,
              typeKey: s.type,
              label: h.label,
              color: h.color,
              title: s.title,
              detail: `${new Date(s.startDate).toLocaleDateString()} ~ ${new Date(s.endDate).toLocaleDateString()}`,
            });
          }
          combined.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
          const filtered = historyFilter === "ALL" ? combined : combined.filter((r) => r.typeKey === historyFilter);
          return (
            <div className="space-y-3">
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
                      <th className="p-2 text-left">날짜</th>
                      <th className="p-2 text-left">상세</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((row, i) => (
                      <tr key={i} className="border-t hover:bg-gray-50">
                        <td className="p-2"><span className={`text-xs px-2 py-0.5 rounded-full ${row.color}`}>{row.label}</span></td>
                        <td className="p-2">{row.title}</td>
                        <td className="p-2">{new Date(row.date).toLocaleDateString()}</td>
                        <td className="p-2 text-gray-500">{row.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })()}

        {/* ═══ 정비이력 탭 ═══ */}
        {tab === "maintenance" && (
          <div className="space-y-3">
            <div className="flex justify-end">
              <button onClick={() => setShowMaintForm(!showMaintForm)} className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm">+ 정비 기록</button>
            </div>
            {showMaintForm && (
              <div className="bg-white border rounded-lg p-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <select value={maintForm.type} onChange={(e) => setMaintForm({ ...maintForm, type: e.target.value })} className="border rounded px-3 py-2 text-sm">
                    {Object.entries(MAINT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  <input placeholder="제목 *" value={maintForm.title} onChange={(e) => setMaintForm({ ...maintForm, title: e.target.value })} className="border rounded px-3 py-2 text-sm" />
                  <input type="date" value={maintForm.performedAt} onChange={(e) => setMaintForm({ ...maintForm, performedAt: e.target.value })} className="border rounded px-3 py-2 text-sm" />
                  <input placeholder="수행자" value={maintForm.performedBy} onChange={(e) => setMaintForm({ ...maintForm, performedBy: e.target.value })} className="border rounded px-3 py-2 text-sm" />
                  <input placeholder="비용 (원)" value={maintForm.cost} onChange={(e) => setMaintForm({ ...maintForm, cost: e.target.value })} className="border rounded px-3 py-2 text-sm" />
                  <input placeholder="설명" value={maintForm.description} onChange={(e) => setMaintForm({ ...maintForm, description: e.target.value })} className="border rounded px-3 py-2 text-sm" />
                </div>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setShowMaintForm(false)} className="px-3 py-1.5 border rounded text-sm">취소</button>
                  <button onClick={handleAddMaintenance} className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm">저장</button>
                </div>
              </div>
            )}
            {maintenance.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-sm">정비/교정 이력이 없습니다.</div>
            ) : (
              <table className="w-full text-sm border">
                <thead className="bg-gray-50">
                  <tr><th className="p-2 text-left">유형</th><th className="p-2 text-left">제목</th><th className="p-2 text-left">수행일</th><th className="p-2 text-left">수행자</th><th className="p-2 text-right">비용</th></tr>
                </thead>
                <tbody>
                  {maintenance.map((m) => (
                    <tr key={m.id} className="border-t hover:bg-gray-50">
                      <td className="p-2">{MAINT_TYPE_LABELS[m.type] ?? m.type}</td>
                      <td className="p-2">{m.title}</td>
                      <td className="p-2">{new Date(m.performedAt).toLocaleDateString()}</td>
                      <td className="p-2">{m.performedBy ?? "-"}</td>
                      <td className="p-2 text-right">{m.cost ? Number(m.cost).toLocaleString() + "원" : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ═══ 운영일정 탭 ═══ */}
        {tab === "schedules" && (() => {
          const SCHED_TYPE_LABELS: Record<string, { label: string; color: string }> = {
            PROJECT: { label: "프로젝트 투입", color: "bg-blue-100 text-blue-700" },
            MAINTENANCE: { label: "정비", color: "bg-yellow-100 text-yellow-700" },
            CALIBRATION: { label: "교정", color: "bg-purple-100 text-purple-700" },
            TRAINING: { label: "교육", color: "bg-green-100 text-green-700" },
            STANDBY: { label: "대기", color: "bg-gray-100 text-gray-600" },
          };
          return (
            <div className="space-y-3">
              <div className="flex gap-2">
                {(sensor.status === "AVAILABLE" || sensor.status === "DEPLOYED") && (
                  <button onClick={openDeployForm} className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm">+ 프로젝트에 투입</button>
                )}
                <button onClick={() => setShowSchedForm(!showSchedForm)} className="px-3 py-1.5 bg-gray-600 text-white rounded text-sm">+ 기타 일정등록</button>
              </div>
              {showSchedForm && (
                <div className="bg-white border rounded-lg p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <select value={schedForm.type} onChange={(e) => setSchedForm({ ...schedForm, type: e.target.value })} className="border rounded px-3 py-2 text-sm">
                      <option value="CALIBRATION">교정</option>
                      <option value="TRAINING">교육</option>
                      <option value="STANDBY">대기</option>
                    </select>
                    <input placeholder="제목 *" value={schedForm.title} onChange={(e) => setSchedForm({ ...schedForm, title: e.target.value })} className="border rounded px-3 py-2 text-sm" />
                    <input type="date" value={schedForm.startDate} onChange={(e) => setSchedForm({ ...schedForm, startDate: e.target.value })} className="border rounded px-3 py-2 text-sm" />
                    <input type="date" value={schedForm.endDate} onChange={(e) => setSchedForm({ ...schedForm, endDate: e.target.value })} className="border rounded px-3 py-2 text-sm" />
                    <input placeholder="설명 (선택)" value={schedForm.description} onChange={(e) => setSchedForm({ ...schedForm, description: e.target.value })} className="col-span-2 border rounded px-3 py-2 text-sm" />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setShowSchedForm(false)} className="px-3 py-1.5 border rounded text-sm">취소</button>
                    <button onClick={handleAddSchedule} className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm">저장</button>
                  </div>
                </div>
              )}
              {sensorSchedules.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm">운영 일정이 없습니다.</div>
              ) : (
                <table className="w-full text-sm border">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="p-2 text-left">타입</th>
                      <th className="p-2 text-left">제목</th>
                      <th className="p-2 text-left">시작일</th>
                      <th className="p-2 text-left">종료일</th>
                      <th className="p-2 text-center">액션</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sensorSchedules.map((s) => {
                      const sType = SCHED_TYPE_LABELS[s.type] ?? { label: s.type, color: "bg-gray-100" };
                      return (
                        <tr key={s.id} className="border-t hover:bg-gray-50">
                          <td className="p-2"><span className={`text-xs px-2 py-0.5 rounded-full ${sType.color}`}>{sType.label}</span></td>
                          <td className="p-2">{s.title}{s.description && <span className="text-gray-400 ml-1">- {s.description}</span>}</td>
                          <td className="p-2">{new Date(s.startDate).toLocaleDateString()}</td>
                          <td className="p-2">{new Date(s.endDate).toLocaleDateString()}</td>
                          <td className="p-2 text-center">
                            {s.deploymentId ? (() => {
                              const dep = deployments.find((d: any) => d.id === s.deploymentId);
                              if (!dep) return null;
                              return (
                                <div className="flex gap-1 justify-center">
                                  {dep.status === "PLANNED" && (
                                    <>
                                      <button onClick={async () => { await deploymentApi.activate(dep.id); reloadSchedules(); }}
                                        className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200">시작</button>
                                      <button onClick={async () => { if (!confirm("투입을 취소하시겠습니까?")) return; await deploymentApi.cancel(dep.id); reloadSchedules(); }}
                                        className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200">취소</button>
                                    </>
                                  )}
                                  {dep.status === "ACTIVE" && (
                                    <button onClick={async () => { if (!confirm("투입을 완료하시겠습니까? 센서가 반납됩니다.")) return; await deploymentApi.complete(dep.id); reloadSchedules(); }}
                                      className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200">완료 (반납)</button>
                                  )}
                                </div>
                              );
                            })() : (
                              <button onClick={() => handleDeleteSchedule(s.id)} className="text-xs text-red-500 hover:text-red-700">삭제</button>
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

        {/* ═══ 호환장비 탭 (읽기 전용) ═══ */}
        {tab === "compat" && (
          <div className="space-y-3">
            <p className="text-xs text-gray-400">※ 호환성 등록/삭제는 장비 상세 &rarr; 호환센서 탭에서 관리합니다.</p>
            {compatEquipment.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-sm">등록된 호환 장비가 없습니다.</div>
            ) : (
              <table className="w-full text-sm border">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="p-2 text-left">장비명</th>
                    <th className="p-2 text-left">종류</th>
                    <th className="p-2 text-left">상태</th>
                    <th className="p-2 text-left">비고</th>
                  </tr>
                </thead>
                <tbody>
                  {compatEquipment.map((c: any) => {
                    const eqSt = STATUS_LABELS[c.equipment?.status] ?? { label: c.equipment?.status, color: "bg-gray-100" };
                    return (
                      <tr key={c.id} className="border-t hover:bg-gray-50">
                        <td className="p-2 font-medium">{c.equipment?.name ?? "-"}</td>
                        <td className="p-2">{c.equipment?.category?.name ?? "-"}</td>
                        <td className="p-2"><span className={`text-xs px-2 py-0.5 rounded-full ${eqSt.color}`}>{eqSt.label}</span></td>
                        <td className="p-2 text-gray-400">{c.notes ?? "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ═══ 센서 단독 투입 모달 ═══ */}
        {showDeployForm && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={() => setShowDeployForm(false)}>
            <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="p-5 border-b">
                <h2 className="text-lg font-bold">프로젝트에 투입</h2>
                <p className="text-sm text-gray-500 mt-1">{sensor.name}을(를) 프로젝트에 투입합니다. (센서 단독)</p>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">프로젝트 *</label>
                  <select value={deployForm.projectId} onChange={(e) => {
                    const p = projects.find((pr) => pr.id === e.target.value);
                    setDeployForm({ ...deployForm, projectId: e.target.value, projectName: p?.name ?? "" });
                  }} className="w-full border rounded px-3 py-2 text-sm">
                    <option value="">-- 프로젝트 선택 --</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">시작일 *</label>
                    <input type="date" value={deployForm.startDate} onChange={(e) => setDeployForm({ ...deployForm, startDate: e.target.value })}
                      className="w-full border rounded px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">종료일 (예정)</label>
                    <input type="date" value={deployForm.endDate} onChange={(e) => setDeployForm({ ...deployForm, endDate: e.target.value })}
                      className="w-full border rounded px-3 py-2 text-sm" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">메모 (선택)</label>
                  <input value={deployForm.notes} onChange={(e) => setDeployForm({ ...deployForm, notes: e.target.value })}
                    className="w-full border rounded px-3 py-2 text-sm" placeholder="투입 관련 메모" />
                </div>
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
    </AppLayout>
  );
}
