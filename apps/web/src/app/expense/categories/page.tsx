"use client";

import { useEffect, useState } from "react";
import { expenseApi } from "@/lib/api";

export default function CategoriesPage() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setItems(await expenseApi.listCategories());
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const standard = items.filter((c) => c.scope === "STANDARD");
  const personal = items.filter((c) => c.scope === "PERSONAL");

  return (
    <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
      <Section title="전사 표준" subtitle="ADMIN이 관리. 본인은 분류만 가능">
        {loading ? (
          <p className="text-sm text-gray-400">불러오는 중...</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {standard.map((c) => (
              <div key={c.id} className="border border-gray-200 rounded-md px-3 py-2 text-sm bg-gray-50">
                <div className="font-medium text-gray-900">{c.name}</div>
                <div className="text-xs text-gray-500">{c.code}</div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section
        title="내 개인 카테고리"
        subtitle="본인 정산용. 표준에 없는 항목 추가 가능"
        action={<button onClick={() => setShowForm(true)} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md">+ 개인 카테고리</button>}
      >
        {personal.length === 0 ? (
          <p className="text-sm text-gray-400">등록된 개인 카테고리가 없습니다.</p>
        ) : (
          <div className="space-y-1">
            {personal.map((c) => (
              <div key={c.id} className="flex items-center justify-between border border-gray-200 rounded-md px-3 py-2">
                <div>
                  <span className="text-sm font-medium">{c.name}</span>
                  <span className="text-xs text-gray-500 ml-2">{c.code}</span>
                </div>
                <button onClick={async () => {
                  if (confirm("삭제하시겠습니까? (사용 중이면 비활성화하세요)")) {
                    try {
                      await expenseApi.deletePersonalCategory(c.id);
                      load();
                    } catch (e: any) {
                      alert(e.message);
                    }
                  }
                }} className="text-xs text-red-500 hover:underline">삭제</button>
              </div>
            ))}
          </div>
        )}
      </Section>

      {showForm && <PersonalCategoryForm onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); load(); }} />}
    </div>
  );
}

function Section({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-sm font-bold text-gray-700">{title}</h2>
          {subtitle && <p className="text-xs text-gray-500 mb-2">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function PersonalCategoryForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ code: "", name: "", sheetName: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.code.trim() || !form.name.trim()) { setErr("코드·이름 모두 필요"); return; }
    setSaving(true);
    try {
      await expenseApi.createPersonalCategory({
        code: form.code.toUpperCase().replace(/[^A-Z0-9_]/g, "_"),
        name: form.name,
        sheetName: form.sheetName || form.name,
      });
      onSaved();
    } catch (e: any) { setErr(e.message); setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
        <h3 className="font-semibold text-gray-900 mb-4">개인 카테고리 추가</h3>
        <form onSubmit={submit} className="space-y-3">
          <Field label="코드">
            <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })}
              placeholder="예: MY_CONSULT (영문 대문자·숫자)" className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
          </Field>
          <Field label="이름">
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="예: 컨설팅" className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
          </Field>
          <Field label="Excel 시트명 (선택)">
            <input value={form.sheetName} onChange={(e) => setForm({ ...form, sheetName: e.target.value })}
              placeholder="비워두면 이름과 동일" className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
          </Field>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 border border-gray-300 rounded-md py-2 text-sm">취소</button>
            <button type="submit" disabled={saving} className="flex-1 bg-blue-600 text-white rounded-md py-2 text-sm font-medium">
              {saving ? "저장 중..." : "저장"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  );
}
