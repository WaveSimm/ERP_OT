"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { auditApi } from "@/lib/api";
import { DateInput } from "@/components/ui/DateInput";

const STATUS_COLORS: Record<string, string> = { PLANNED: "bg-gray-100 text-gray-600", IN_PROGRESS: "bg-yellow-100 text-yellow-700", PAUSED: "bg-blue-100 text-blue-700", CANCELLED: "bg-red-100 text-red-700", COMPLETED: "bg-green-100 text-green-700" };
const STATUS_LABELS: Record<string, string> = { PLANNED: "예정", IN_PROGRESS: "진행중", PAUSED: "일시정지", CANCELLED: "취소", COMPLETED: "완료" };

export default function AuditsPage() {
  const router = useRouter();
  const [audits, setAudits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: "", plannedDate: new Date().toISOString().slice(0, 10), notes: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    auditApi.list().then(setAudits).catch(() => setAudits([])).finally(() => setLoading(false));
  }, []);

  const handleCreate = async () => {
    if (!form.name) return;
    setSaving(true);
    try {
      const result = await auditApi.create(form);
      router.push(`/procurement/audits/${result.id}`);
    } catch (e: any) { alert(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div />
        <button onClick={() => setShowModal(true)} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">
          + 실사 생성
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">로딩 중...</div>
      ) : audits.length === 0 ? (
        <div className="text-center py-12 text-gray-400">실사 데이터가 없습니다.</div>
      ) : (
        <div className="space-y-3">
          {audits.map((a: any) => (
            <div key={a.id} className="bg-white border rounded-lg p-4 hover:border-blue-300 cursor-pointer"
              onClick={() => router.push(`/procurement/audits/${a.id}`)}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">{a.name}</div>
                  <div className="text-xs text-gray-500">
                    예정일: {new Date(a.plannedDate).toLocaleDateString("ko-KR")} · 항목: {a._count?.items || 0}건
                  </div>
                </div>
                <span className={`text-xs px-2 py-1 rounded ${STATUS_COLORS[a.status]}`}>
                  {STATUS_LABELS[a.status]}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">실사 생성</h3>
            <div className="space-y-3">
              <div>
                <label className="text-sm text-gray-600">실사명 *</label>
                <input value={form.name} onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))}
                  className="w-full border rounded px-3 py-2 text-sm" placeholder="2026년 상반기 정기 실사" />
              </div>
              <div>
                <label className="text-sm text-gray-600">예정일</label>
                <DateInput value={form.plannedDate} onChange={(e) => setForm(p => ({ ...p, plannedDate: e.target.value }))}
                  className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-sm text-gray-600">메모</label>
                <textarea value={form.notes} onChange={(e) => setForm(p => ({ ...p, notes: e.target.value }))}
                  className="w-full border rounded px-3 py-2 text-sm" rows={2} />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 border rounded-lg text-sm">취소</button>
              <button onClick={handleCreate} disabled={saving}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50">생성</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
