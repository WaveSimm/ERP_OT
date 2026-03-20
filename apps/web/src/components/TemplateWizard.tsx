"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { templateApi } from "@/lib/api";
import clsx from "clsx";

interface Props {
  projectId: string;
  onClose: () => void;
  onSuccess: () => void;
}

type Step = 1 | 2 | 3;

export default function TemplateWizard({ projectId, onClose, onSuccess }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [templates, setTemplates] = useState<any[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [selectedTemplate, setSelectedTemplate] = useState<any>(null);
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [includeAssignments, setIncludeAssignments] = useState(true);
  const [projectName, setProjectName] = useState("");
  const [preview, setPreview] = useState<any>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    templateApi.list().then(setTemplates).catch(() => {}).finally(() => setLoadingTemplates(false));
  }, []);

  const loadPreview = async (templateId: string, date: string) => {
    if (!templateId || !date) return;
    setLoadingPreview(true);
    setPreview(null);
    try {
      const res = await templateApi.preview(templateId, { startDate: date });
      setPreview(res);
    } catch {
      setPreview(null);
    } finally {
      setLoadingPreview(false);
    }
  };

  const goToStep2 = () => {
    if (!selectedTemplate) return;
    setStep(2);
  };

  const goToStep3 = () => {
    if (!startDate) { setError("시작일을 선택해주세요."); return; }
    setError("");
    loadPreview(selectedTemplate.id, startDate);
    setStep(3);
  };

  const handleApply = async () => {
    setApplying(true);
    setError("");
    try {
      const newProject = await templateApi.instantiate(selectedTemplate.id, {
        projectName: projectName.trim() || selectedTemplate.name,
        startDate,
        includeAssignments,
      });
      onClose();
      router.push(`/projects/${newProject.id}`);
    } catch (e: any) {
      setError(e.message ?? "적용 실패");
      setApplying(false);
    }
  };

  const stepLabels = ["템플릿 선택", "설정", "확인"];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">템플릿에서 태스크 추가</h2>
            {/* Step indicator */}
            <div className="flex items-center gap-2 mt-2">
              {stepLabels.map((label, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <div className={clsx(
                    "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold transition-colors",
                    step > i + 1 ? "bg-green-500 text-white" :
                    step === i + 1 ? "bg-blue-600 text-white" :
                    "bg-gray-200 text-gray-500"
                  )}>
                    {step > i + 1 ? "✓" : i + 1}
                  </div>
                  <span className={clsx(
                    "text-xs transition-colors",
                    step === i + 1 ? "text-blue-600 font-medium" : "text-gray-400"
                  )}>{label}</span>
                  {i < stepLabels.length - 1 && <span className="text-gray-200 text-xs mx-0.5">›</span>}
                </div>
              ))}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors text-xl font-light">×</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* Step 1: 템플릿 선택 */}
          {step === 1 && (
            <div className="space-y-2">
              {loadingTemplates && (
                <div className="text-center py-12 text-gray-400 text-sm">템플릿 목록 로딩 중…</div>
              )}
              {!loadingTemplates && templates.length === 0 && (
                <div className="text-center py-12 text-gray-400">
                  <div className="text-4xl mb-3">📋</div>
                  <p className="text-sm">등록된 템플릿이 없습니다.</p>
                </div>
              )}
              {templates.map((t) => (
                <div
                  key={t.id}
                  onClick={() => setSelectedTemplate(t)}
                  className={clsx(
                    "rounded-xl border-2 p-4 cursor-pointer transition-all",
                    selectedTemplate?.id === t.id
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                  )}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 text-sm">{t.name}</p>
                      {t.description && (
                        <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{t.description}</p>
                      )}
                      <div className="flex items-center gap-2 mt-2">
                        {t.category && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-600 font-medium">
                            {t.category}
                          </span>
                        )}
                        {t.isRecommended && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-600 font-medium">
                            ⭐ 추천
                          </span>
                        )}
                        {t.scope && (
                          <span className="text-[10px] text-gray-400">{t.scope}</span>
                        )}
                      </div>
                    </div>
                    {selectedTemplate?.id === t.id && (
                      <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center text-white text-[10px] font-bold shrink-0 ml-2">
                        ✓
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Step 2: 설정 */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">새 프로젝트 이름</label>
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder={selectedTemplate?.name ?? "프로젝트 이름"}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">프로젝트 시작일</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-400 mt-1">템플릿의 dayOffset이 이 날짜를 기준으로 계산됩니다.</p>
              </div>

              <label className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeAssignments}
                  onChange={(e) => setIncludeAssignments(e.target.checked)}
                  className="mt-0.5 rounded text-blue-600 focus:ring-blue-500"
                />
                <div>
                  <p className="text-sm font-medium text-gray-800">자원 배정 포함</p>
                  <p className="text-xs text-gray-400">세그먼트에 배정된 자원 정보를 포함합니다.</p>
                </div>
              </label>

              {error && <p className="text-sm text-red-500">{error}</p>}
            </div>
          )}

          {/* Step 3: 확인 및 미리보기 */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="rounded-xl bg-blue-50 border border-blue-200 p-4 text-sm">
                <p className="font-medium text-blue-800 mb-1">새 프로젝트 생성 요약</p>
                <ul className="text-blue-700 space-y-0.5 text-xs">
                  <li>프로젝트명: <strong>{projectName.trim() || selectedTemplate?.name}</strong></li>
                  <li>템플릿: <strong>{selectedTemplate?.name}</strong></li>
                  <li>시작일: <strong>{startDate}</strong></li>
                  <li>포함: {includeAssignments ? "자원배정" : "태스크만"}</li>
                </ul>
                <p className="mt-2 text-xs text-blue-500">확인 후 새 프로젝트 페이지로 이동합니다.</p>
              </div>

              {loadingPreview && (
                <div className="text-center py-8 text-gray-400 text-sm">미리보기 로딩 중…</div>
              )}

              {preview && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    태스크 미리보기 ({preview.tasks?.length ?? 0}개)
                  </p>
                  <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                    {(preview.tasks ?? []).map((t: any, i: number) => (
                      <div key={i} className="flex items-center gap-3 rounded-lg border border-gray-100 px-3 py-2 bg-gray-50 text-sm">
                        <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-600 text-[10px] font-bold flex items-center justify-center shrink-0">
                          {i + 1}
                        </span>
                        <span className="flex-1 text-gray-800 truncate">{t.name}</span>
                        {t.segments?.length > 0 && (
                          <span className="text-xs text-gray-400 shrink-0">
                            {t.segments[0].startDate} ~ {t.segments[t.segments.length - 1].endDate}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {error && <p className="text-sm text-red-500">{error}</p>}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50">
          <div>
            {step > 1 && (
              <button
                onClick={() => setStep((s) => (s - 1) as Step)}
                disabled={applying}
                className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                ← 이전
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors">
              취소
            </button>
            {step < 3 && (
              <button
                onClick={step === 1 ? goToStep2 : goToStep3}
                disabled={step === 1 && !selectedTemplate}
                className="px-5 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                다음 →
              </button>
            )}
            {step === 3 && (
              <button
                onClick={handleApply}
                disabled={applying}
                className="px-5 py-2 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {applying ? "생성 중…" : "프로젝트 생성"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
