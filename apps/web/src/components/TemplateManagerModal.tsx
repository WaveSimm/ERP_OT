"use client";

import { useEffect, useState, useCallback } from "react";
import { templateApi } from "@/lib/api";
import type { ProjectTemplate } from "@/lib/api/types";
import { fmtDate } from "@/lib/datetime";

const errMsg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export default function TemplateManagerModal({ onClose }: { onClose: () => void }) {
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    templateApi.list().then(setTemplates).catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const updateField = async (id: string, field: "name" | "category", value: string) => {
    const tpl = templates.find((t) => t.id === id);
    if (!tpl || (tpl[field] ?? "") === value) return;
    if (!value.trim()) { load(); return; }
    setSavingId(id);
    try { await templateApi.update(id, { [field]: value.trim() }); load(); }
    catch (e) { alert(errMsg(e, "수정 실패")); load(); }
    finally { setSavingId(null); }
  };

  const toggleRecommended = async (id: string, cur: boolean) => {
    setSavingId(id);
    try { await templateApi.update(id, { isRecommended: !cur }); load(); }
    catch (e) { alert(errMsg(e, "변경 실패")); load(); }
    finally { setSavingId(null); }
  };

  const del = async (id: string, name: string) => {
    if (!confirm(`템플릿 "${name}"을 삭제하시겠습니까?\n되돌릴 수 없습니다.`)) return;
    try { await templateApi.delete(id); load(); }
    catch (e) { alert(errMsg(e, "삭제 실패")); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">템플릿 관리</h2>
            <p className="text-xs text-gray-500 mt-0.5">이름·카테고리 수정, 추천 설정, 삭제</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl font-light">×</button>
        </div>

        {/* 검색 */}
        <div className="px-6 pt-3 pb-1 shrink-0">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이름 또는 카테고리 검색..."
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="overflow-y-auto flex-1 p-4 pt-2">
          {(() => {
            const q = search.trim().toLowerCase();
            const filtered = q
              ? templates.filter((t) => (t.name ?? "").toLowerCase().includes(q) || (t.category ?? "").toLowerCase().includes(q))
              : templates;
            return loading ? (
            <p className="text-sm text-gray-400 text-center py-10">불러오는 중...</p>
          ) : templates.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-10">저장된 템플릿이 없습니다.</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-10">검색 결과가 없습니다.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 border-b">
                  <th className="text-left font-medium py-2 px-2">이름</th>
                  <th className="text-left font-medium py-2 px-2 w-28">카테고리</th>
                  <th className="text-right font-medium py-2 px-2 w-14">태스크</th>
                  <th className="text-right font-medium py-2 px-2 w-14">사용</th>
                  <th className="text-center font-medium py-2 px-2 w-12">추천</th>
                  <th className="text-left font-medium py-2 px-2 w-24">생성일</th>
                  <th className="py-2 px-2 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr key={t.id} className={`border-b border-gray-50 ${savingId === t.id ? "opacity-50" : ""}`}>
                    <td className="py-1.5 px-2">
                      <input
                        defaultValue={t.name}
                        onBlur={(e) => updateField(t.id, "name", e.target.value)}
                        className="w-full text-sm bg-transparent border border-transparent hover:border-gray-200 focus:border-blue-400 rounded px-1.5 py-0.5 focus:outline-none"
                      />
                    </td>
                    <td className="py-1.5 px-2">
                      <input
                        defaultValue={t.category}
                        onBlur={(e) => updateField(t.id, "category", e.target.value)}
                        className="w-full text-xs bg-transparent border border-transparent hover:border-gray-200 focus:border-blue-400 rounded px-1.5 py-0.5 focus:outline-none"
                      />
                    </td>
                    <td className="py-1.5 px-2 text-right text-gray-500">{t._count?.templateTasks ?? 0}</td>
                    <td className="py-1.5 px-2 text-right text-gray-500">{t.usageCount ?? 0}</td>
                    <td className="py-1.5 px-2 text-center">
                      <button
                        onClick={() => toggleRecommended(t.id, !!t.isRecommended)}
                        title={t.isRecommended ? "추천 해제" : "추천 설정"}
                        className={t.isRecommended ? "text-amber-500" : "text-gray-300 hover:text-amber-400"}
                      >
                        ★
                      </button>
                    </td>
                    <td className="py-1.5 px-2 text-xs text-gray-400">{fmtDate(t.createdAt)}</td>
                    <td className="py-1.5 px-2 text-right">
                      <button onClick={() => del(t.id, t.name)} className="text-gray-300 hover:text-red-500" title="삭제">🗑</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          );
          })()}
        </div>
        <div className="px-6 py-3 border-t border-gray-100 bg-gray-50 text-right shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-100">닫기</button>
        </div>
      </div>
    </div>
  );
}
