"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { equipmentApi, sensorApi, equipmentCategoryApi, equipmentScheduleApi, supplierApi } from "@/lib/api";
import SearchableSelect from "@/components/SearchableSelect";

const EQ_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  AVAILABLE: { label: "가용", color: "bg-green-100 text-green-800" },
  IN_OPERATION: { label: "운용중", color: "bg-blue-100 text-blue-800" },
  IN_MAINTENANCE: { label: "정비중", color: "bg-yellow-100 text-yellow-800" },
  BROKEN: { label: "고장", color: "bg-red-100 text-red-800" },
  RETIRED: { label: "퇴역", color: "bg-gray-100 text-gray-500" },
};

const SN_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  AVAILABLE: { label: "가용", color: "bg-green-100 text-green-800" },
  DEPLOYED: { label: "투입중", color: "bg-blue-100 text-blue-800" },
  IN_MAINTENANCE: { label: "정비중", color: "bg-yellow-100 text-yellow-800" },
  BROKEN: { label: "고장", color: "bg-red-100 text-red-800" },
  RETIRED: { label: "퇴역", color: "bg-gray-100 text-gray-500" },
};

type EquipmentTab = "equipment" | "sensors" | "schedule";

export default function EquipmentPage() {
  const searchParams = useSearchParams();
  const urlTab = searchParams.get("tab");
  const tab: EquipmentTab = (urlTab === "sensors" || urlTab === "schedule") ? urlTab : "equipment";

  return (
    <>
      {tab === "equipment" && <EquipmentListTab />}
      {tab === "sensors" && <SensorListTab />}
      {tab === "schedule" && <ScheduleTab />}
    </>
  );
}

/* ── 장비 관리 탭 ───────────────────────────────────────────────────── */
function EquipmentListTab() {
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ categoryId: "", status: "", search: "" });
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", serialNumber: "", categoryId: "", manufacturer: "", model: "", description: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", serialNumber: "", categoryId: "", manufacturer: "", model: "", description: "", status: "" });

  useEffect(() => {
    equipmentCategoryApi.list("EQUIPMENT").then(setCategories).catch(() => {});
  }, []);

  const load = () => {
    setLoading(true);
    equipmentApi.list(filters).then((res) => {
      setItems(res.items);
      setTotal(res.total);
    }).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [filters]);

  const handleCreate = async () => {
    if (!form.name || !form.serialNumber || !form.categoryId) return alert("이름, 일련번호, 카테고리는 필수입니다.");
    try {
      await equipmentApi.create(form);
      setShowForm(false);
      setForm({ name: "", serialNumber: "", categoryId: "", manufacturer: "", model: "", description: "" });
      load();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const startEdit = (eq: any) => {
    setEditingId(eq.id);
    setEditForm({
      name: eq.name ?? "",
      serialNumber: eq.serialNumber ?? "",
      categoryId: eq.categoryId ?? eq.category?.id ?? "",
      manufacturer: eq.manufacturer ?? "",
      model: eq.model ?? "",
      description: eq.description ?? "",
      status: eq.status ?? "",
    });
  };

  const handleUpdate = async () => {
    if (!editingId) return;
    if (!editForm.name || !editForm.serialNumber) return alert("이름, 일련번호는 필수입니다.");
    try {
      await equipmentApi.update(editingId, {
        name: editForm.name,
        serialNumber: editForm.serialNumber,
        categoryId: editForm.categoryId || undefined,
        manufacturer: editForm.manufacturer || undefined,
        model: editForm.model || undefined,
        description: editForm.description || undefined,
      });
      if (editForm.status) {
        const orig = items.find((i) => i.id === editingId);
        if (orig && orig.status !== editForm.status) {
          await equipmentApi.changeStatus(editingId, editForm.status);
        }
      }
      setEditingId(null);
      load();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`"${name}" 장비를 삭제하시겠습니까?\n관련 이력도 함께 삭제됩니다.`)) return;
    try {
      await equipmentApi.remove(id);
      load();
    } catch (err: any) {
      alert(err.message);
    }
  };

  return (
    <>
      <div className="flex items-center justify-start mb-4">
        <button onClick={() => setShowForm(true)} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm">
          + 장비 등록
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <select value={filters.categoryId} onChange={(e) => setFilters({ ...filters, categoryId: e.target.value })}
          className="border rounded px-3 py-2 text-sm">
          <option value="">전체 종류</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          className="border rounded px-3 py-2 text-sm">
          <option value="">전체 상태</option>
          {Object.entries(EQ_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <input type="text" placeholder="이름/일련번호 검색" value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          className="border rounded px-3 py-2 text-sm flex-1" />
      </div>

      {/* Create Form */}
      {showForm && (
        <div className="bg-white border rounded-lg p-4 mb-4 space-y-3">
          <h3 className="font-semibold">장비 등록</h3>
          <div className="grid grid-cols-2 gap-3">
            <input placeholder="장비명 *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="border rounded px-3 py-2 text-sm" />
            <input placeholder="일련번호 *" value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })}
              className="border rounded px-3 py-2 text-sm" />
            <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
              className="border rounded px-3 py-2 text-sm">
              <option value="">카테고리 선택 *</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <SearchableSelect
              value={form.manufacturer}
              onChange={(v) => setForm({ ...form, manufacturer: v })}
              placeholder="제조사 검색..."
              allowCustom
              className="border rounded px-3 py-2 text-sm"
              loadOptions={async (q) => {
                const res = await supplierApi.list({ search: q, limit: 20 });
                return (res.items || []).map((s: any) => ({ id: s.id, name: s.name, sub: s.country || undefined }));
              }}
            />
            <input placeholder="모델명" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })}
              className="border rounded px-3 py-2 text-sm" />
            <input placeholder="설명" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="border rounded px-3 py-2 text-sm" />
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowForm(false)} className="px-4 py-2 border rounded text-sm">취소</button>
            <button onClick={handleCreate} className="px-4 py-2 bg-blue-600 text-white rounded text-sm">등록</button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">불러오는 중...</div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-gray-400">등록된 장비가 없습니다.</div>
      ) : (
        <div className="space-y-2">
          {items.map((eq) => {
            const st = EQ_STATUS_LABELS[eq.status] ?? { label: eq.status, color: "bg-gray-100" };
            const isEditing = editingId === eq.id;

            if (isEditing) {
              return (
                <div key={eq.id} className="bg-white border-2 border-blue-300 rounded-lg p-4 space-y-3">
                  <h3 className="font-semibold text-sm text-blue-700">장비 수정</h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <input placeholder="장비명 *" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      className="border rounded px-3 py-2 text-sm" />
                    <input placeholder="일련번호 *" value={editForm.serialNumber} onChange={(e) => setEditForm({ ...editForm, serialNumber: e.target.value })}
                      className="border rounded px-3 py-2 text-sm" />
                    <select value={editForm.categoryId} onChange={(e) => setEditForm({ ...editForm, categoryId: e.target.value })}
                      className="border rounded px-3 py-2 text-sm">
                      <option value="">카테고리 선택</option>
                      {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <SearchableSelect
                      value={editForm.manufacturer}
                      onChange={(v) => setEditForm({ ...editForm, manufacturer: v })}
                      placeholder="제조사 검색..."
                      allowCustom
                      className="border rounded px-3 py-2 text-sm"
                      loadOptions={async (q) => {
                        const res = await supplierApi.list({ search: q, limit: 20 });
                        return (res.items || []).map((s: any) => ({ id: s.id, name: s.name, sub: s.country || undefined }));
                      }}
                    />
                    <input placeholder="모델명" value={editForm.model} onChange={(e) => setEditForm({ ...editForm, model: e.target.value })}
                      className="border rounded px-3 py-2 text-sm" />
                    <select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                      className="border rounded px-3 py-2 text-sm">
                      {Object.entries(EQ_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                  </div>
                  <input placeholder="설명" value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    className="w-full border rounded px-3 py-2 text-sm" />
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setEditingId(null)} className="px-4 py-2 border rounded text-sm">취소</button>
                    <button onClick={handleUpdate} className="px-4 py-2 bg-blue-600 text-white rounded text-sm">저장</button>
                  </div>
                </div>
              );
            }

            return (
              <div key={eq.id} className="bg-white border rounded-lg p-4 hover:shadow-md transition flex items-center gap-4">
                <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center text-2xl shrink-0 cursor-pointer"
                  onClick={() => router.push(`/equipment/${eq.id}`)}>
                  {eq.category?.name === "USV" ? "🚤" : eq.category?.name === "AUV" ? "🤿" : "🔧"}
                </div>
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => router.push(`/equipment/${eq.id}`)}>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{eq.name}</span>
                    <span className="text-xs text-gray-500">{eq.category?.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${st.color}`}>{st.label}</span>
                  </div>
                  <div className="text-sm text-gray-500 truncate">
                    SN: {eq.serialNumber} {eq.manufacturer && `| ${eq.manufacturer}`} {eq.model && eq.model}
                  </div>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button onClick={() => startEdit(eq)}
                    className="px-3 py-1.5 text-xs font-medium border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors">
                    수정
                  </button>
                  <button onClick={() => handleDelete(eq.id, eq.name)}
                    className="px-3 py-1.5 text-xs font-medium border border-red-200 rounded-lg text-red-500 hover:bg-red-50 transition-colors">
                    삭제
                  </button>
                </div>
              </div>
            );
          })}
          <div className="text-sm text-gray-400 text-center py-2">총 {total}건</div>
        </div>
      )}
    </>
  );
}

/* ── 센서 관리 탭 ───────────────────────────────────────────────────── */
function SensorListTab() {
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ categoryId: "", status: "", search: "" });
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", serialNumber: "", categoryId: "", manufacturer: "", model: "", calibrationIntervalDays: "", description: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", serialNumber: "", categoryId: "", manufacturer: "", model: "", calibrationIntervalDays: "", description: "", status: "" });

  useEffect(() => {
    equipmentCategoryApi.list("SENSOR").then(setCategories).catch(() => {});
  }, []);

  const load = () => {
    setLoading(true);
    sensorApi.list(filters).then((res) => {
      setItems(res.items);
      setTotal(res.total);
    }).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [filters]);

  const handleCreate = async () => {
    if (!form.name || !form.serialNumber || !form.categoryId) return alert("이름, 일련번호, 카테고리는 필수입니다.");
    try {
      await sensorApi.create({
        ...form,
        calibrationIntervalDays: form.calibrationIntervalDays ? parseInt(form.calibrationIntervalDays) : undefined,
      });
      setShowForm(false);
      setForm({ name: "", serialNumber: "", categoryId: "", manufacturer: "", model: "", calibrationIntervalDays: "", description: "" });
      load();
    } catch (err: any) { alert(err.message); }
  };

  const startEdit = (sn: any) => {
    setEditingId(sn.id);
    setEditForm({
      name: sn.name ?? "",
      serialNumber: sn.serialNumber ?? "",
      categoryId: sn.categoryId ?? sn.category?.id ?? "",
      manufacturer: sn.manufacturer ?? "",
      model: sn.model ?? "",
      calibrationIntervalDays: sn.calibrationIntervalDays != null ? String(sn.calibrationIntervalDays) : "",
      description: sn.description ?? "",
      status: sn.status ?? "",
    });
  };

  const handleUpdate = async () => {
    if (!editingId) return;
    if (!editForm.name || !editForm.serialNumber) return alert("이름, 일련번호는 필수입니다.");
    try {
      await sensorApi.update(editingId, {
        name: editForm.name,
        serialNumber: editForm.serialNumber,
        categoryId: editForm.categoryId || undefined,
        manufacturer: editForm.manufacturer || undefined,
        model: editForm.model || undefined,
        calibrationIntervalDays: editForm.calibrationIntervalDays ? parseInt(editForm.calibrationIntervalDays) : undefined,
        description: editForm.description || undefined,
      });
      if (editForm.status) {
        const orig = items.find((i) => i.id === editingId);
        if (orig && orig.status !== editForm.status) {
          await sensorApi.changeStatus(editingId, editForm.status);
        }
      }
      setEditingId(null);
      load();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`"${name}" 센서를 삭제하시겠습니까?\n관련 이력도 함께 삭제됩니다.`)) return;
    try {
      await sensorApi.remove(id);
      load();
    } catch (err: any) {
      alert(err.message);
    }
  };

  return (
    <>
      <div className="flex items-center justify-start mb-4">
        <button onClick={() => setShowForm(true)} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm">
          + 센서 등록
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <select value={filters.categoryId} onChange={(e) => setFilters({ ...filters, categoryId: e.target.value })}
          className="border rounded px-3 py-2 text-sm">
          <option value="">전체 종류</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          className="border rounded px-3 py-2 text-sm">
          <option value="">전체 상태</option>
          {Object.entries(SN_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <input type="text" placeholder="이름/일련번호 검색" value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          className="border rounded px-3 py-2 text-sm flex-1" />
      </div>

      {/* Create Form */}
      {showForm && (
        <div className="bg-white border rounded-lg p-4 mb-4 space-y-3">
          <h3 className="font-semibold">센서 등록</h3>
          <div className="grid grid-cols-2 gap-3">
            <input placeholder="센서명 *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="border rounded px-3 py-2 text-sm" />
            <input placeholder="일련번호 *" value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} className="border rounded px-3 py-2 text-sm" />
            <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} className="border rounded px-3 py-2 text-sm">
              <option value="">카테고리 선택 *</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <SearchableSelect
              value={form.manufacturer}
              onChange={(v) => setForm({ ...form, manufacturer: v })}
              placeholder="제조사 검색..."
              allowCustom
              className="border rounded px-3 py-2 text-sm"
              loadOptions={async (q) => {
                const res = await supplierApi.list({ search: q, limit: 20 });
                return (res.items || []).map((s: any) => ({ id: s.id, name: s.name, sub: s.country || undefined }));
              }}
            />
            <input placeholder="모델명" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} className="border rounded px-3 py-2 text-sm" />
            <input placeholder="교정 주기 (일)" type="number" value={form.calibrationIntervalDays}
              onChange={(e) => setForm({ ...form, calibrationIntervalDays: e.target.value })} className="border rounded px-3 py-2 text-sm" />
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowForm(false)} className="px-4 py-2 border rounded text-sm">취소</button>
            <button onClick={handleCreate} className="px-4 py-2 bg-blue-600 text-white rounded text-sm">등록</button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">불러오는 중...</div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-gray-400">등록된 센서가 없습니다.</div>
      ) : (
        <div className="space-y-2">
          {items.map((sn) => {
            const st = SN_STATUS_LABELS[sn.status] ?? { label: sn.status, color: "bg-gray-100" };
            const isEditing = editingId === sn.id;

            if (isEditing) {
              return (
                <div key={sn.id} className="bg-white border-2 border-blue-300 rounded-lg p-4 space-y-3">
                  <h3 className="font-semibold text-sm text-blue-700">센서 수정</h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <input placeholder="센서명 *" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      className="border rounded px-3 py-2 text-sm" />
                    <input placeholder="일련번호 *" value={editForm.serialNumber} onChange={(e) => setEditForm({ ...editForm, serialNumber: e.target.value })}
                      className="border rounded px-3 py-2 text-sm" />
                    <select value={editForm.categoryId} onChange={(e) => setEditForm({ ...editForm, categoryId: e.target.value })}
                      className="border rounded px-3 py-2 text-sm">
                      <option value="">카테고리 선택</option>
                      {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <SearchableSelect
                      value={editForm.manufacturer}
                      onChange={(v) => setEditForm({ ...editForm, manufacturer: v })}
                      placeholder="제조사 검색..."
                      allowCustom
                      className="border rounded px-3 py-2 text-sm"
                      loadOptions={async (q) => {
                        const res = await supplierApi.list({ search: q, limit: 20 });
                        return (res.items || []).map((s: any) => ({ id: s.id, name: s.name, sub: s.country || undefined }));
                      }}
                    />
                    <input placeholder="모델명" value={editForm.model} onChange={(e) => setEditForm({ ...editForm, model: e.target.value })}
                      className="border rounded px-3 py-2 text-sm" />
                    <input placeholder="교정 주기 (일)" type="number" value={editForm.calibrationIntervalDays}
                      onChange={(e) => setEditForm({ ...editForm, calibrationIntervalDays: e.target.value })} className="border rounded px-3 py-2 text-sm" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                      className="border rounded px-3 py-2 text-sm">
                      {Object.entries(SN_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                    <input placeholder="설명" value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                      className="border rounded px-3 py-2 text-sm" />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setEditingId(null)} className="px-4 py-2 border rounded text-sm">취소</button>
                    <button onClick={handleUpdate} className="px-4 py-2 bg-blue-600 text-white rounded text-sm">저장</button>
                  </div>
                </div>
              );
            }

            return (
              <div key={sn.id} className="bg-white border rounded-lg p-4 hover:shadow-md transition flex items-center gap-4">
                <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center text-lg shrink-0 cursor-pointer"
                  onClick={() => router.push(`/equipment/sensors/${sn.id}`)}>📡</div>
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => router.push(`/equipment/sensors/${sn.id}`)}>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{sn.name}</span>
                    <span className="text-xs text-gray-500">{sn.category?.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${st.color}`}>{st.label}</span>
                  </div>
                  <div className="text-sm text-gray-500 truncate">
                    SN: {sn.serialNumber} {sn.manufacturer && `| ${sn.manufacturer}`}
                    {sn.currentLocation && ` | ${sn.currentLocation}`}
                    {sn.calibrationDaysRemaining != null && (
                      <span className={sn.calibrationDaysRemaining <= 30 ? " text-orange-500 font-medium" : ""}>
                        {" "}| 교정 D-{sn.calibrationDaysRemaining}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button onClick={() => startEdit(sn)}
                    className="px-3 py-1.5 text-xs font-medium border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors">
                    수정
                  </button>
                  <button onClick={() => handleDelete(sn.id, sn.name)}
                    className="px-3 py-1.5 text-xs font-medium border border-red-200 rounded-lg text-red-500 hover:bg-red-50 transition-colors">
                    삭제
                  </button>
                </div>
              </div>
            );
          })}
          <div className="text-sm text-gray-400 text-center py-2">총 {total}건</div>
        </div>
      )}
    </>
  );
}

/* ── 운영 일정 탭 ───────────────────────────────────────────────────── */
const SCHED_TYPE_COLORS: Record<string, string> = {
  PROJECT: "#3b82f6",
  MAINTENANCE: "#f59e0b",
  CALIBRATION: "#8b5cf6",
  TRAINING: "#10b981",
  STANDBY: "#d1d5db",
};

const SCHED_TYPE_LABELS: Record<string, string> = {
  PROJECT: "프로젝트 투입",
  MAINTENANCE: "정비",
  CALIBRATION: "교정",
  TRAINING: "교육",
  STANDBY: "대기",
};

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function formatMonth(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function ScheduleTab() {
  const [baseDate, setBaseDate] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [assetType, setAssetType] = useState("ALL");

  const startDate = useMemo(() => {
    const d = new Date(baseDate);
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  }, [baseDate]);

  const endDate = useMemo(() => {
    const d = addMonths(new Date(baseDate), 1);
    d.setDate(0);
    return d.toISOString().slice(0, 10);
  }, [baseDate]);

  useEffect(() => {
    setLoading(true);
    equipmentScheduleApi
      .getTimeline({ startDate, endDate, assetType: assetType === "ALL" ? undefined : assetType })
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [startDate, endDate, assetType]);

  const daysInMonth = useMemo(() => {
    const d = addMonths(new Date(baseDate), 1);
    d.setDate(0);
    return d.getDate();
  }, [baseDate]);

  const monthStart = new Date(startDate);

  function dayOffset(dateStr: string): number {
    const d = new Date(dateStr);
    return Math.max(0, Math.floor((d.getTime() - monthStart.getTime()) / (1000 * 60 * 60 * 24)));
  }

  function barWidth(start: string, end: string): number {
    const s = Math.max(0, dayOffset(start));
    const e = Math.min(daysInMonth, dayOffset(end) + 1);
    return Math.max(0, e - s);
  }

  return (
    <>
      <div className="flex items-center gap-3 mb-2">
        <select value={assetType} onChange={(e) => setAssetType(e.target.value)} className="border rounded px-3 py-1.5 text-sm">
          <option value="ALL">전체</option>
          <option value="EQUIPMENT">장비만</option>
          <option value="SENSOR">센서만</option>
        </select>
        <button onClick={() => setBaseDate(addMonths(baseDate, -1))} className="px-3 py-1.5 border rounded text-sm">&lt; 이전월</button>
        <span className="font-semibold">{formatMonth(baseDate)}</span>
        <button onClick={() => setBaseDate(addMonths(baseDate, 1))} className="px-3 py-1.5 border rounded text-sm">다음월 &gt;</button>
      </div>
      <div className="flex gap-4 text-xs mb-4">
        {Object.entries(SCHED_TYPE_LABELS).map(([k, v]) => (
          <div key={k} className="flex items-center gap-1">
            <div className="w-3 h-3 rounded" style={{ backgroundColor: SCHED_TYPE_COLORS[k] }} />
            <span>{v}</span>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">불러오는 중...</div>
      ) : !data?.assets?.length ? (
        <div className="text-center py-12 text-gray-400">일정이 없습니다.</div>
      ) : (
        <div className="bg-white border rounded-lg overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: `${200 + daysInMonth * 28}px` }}>
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="p-2 text-left w-48 sticky left-0 bg-gray-50 z-10">자산</th>
                {Array.from({ length: daysInMonth }, (_, i) => (
                  <th key={i} className="p-1 text-center text-xs text-gray-400 w-7">
                    {i + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.assets.map((asset: any) => (
                <tr key={asset.id} className="border-b hover:bg-gray-50">
                  <td className="p-2 sticky left-0 bg-white z-10">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-gray-400">{asset.type === "EQUIPMENT" ? "🔧" : "📡"}</span>
                      <span className="font-medium text-xs truncate max-w-[160px]">{asset.name}</span>
                    </div>
                  </td>
                  <td colSpan={daysInMonth} className="relative h-8">
                    {asset.schedules?.map((s: any) => {
                      const left = dayOffset(s.startDate);
                      const width = barWidth(s.startDate, s.endDate);
                      if (width <= 0) return null;
                      return (
                        <div key={s.id} className="absolute top-1 h-6 rounded text-[10px] text-white flex items-center px-1 overflow-hidden"
                          style={{
                            left: `${(left / daysInMonth) * 100}%`,
                            width: `${(width / daysInMonth) * 100}%`,
                            backgroundColor: SCHED_TYPE_COLORS[s.type] ?? "#6b7280",
                          }}
                          title={`${s.title} (${new Date(s.startDate).toLocaleDateString()}~${new Date(s.endDate).toLocaleDateString()})`}>
                          {s.title}
                        </div>
                      );
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
