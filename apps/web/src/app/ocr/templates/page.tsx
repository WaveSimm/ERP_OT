"use client";

import { useEffect, useState } from "react";
import { ocrApi } from "@/lib/api";

const FIELD_TYPE_LABELS: Record<string, string> = {
  STRING: "문자",
  NUMBER: "숫자",
  DATE: "날짜",
  BIZ_NO: "사업자번호",
  CURRENCY: "통화",
  PHONE: "전화번호",
};

export default function OcrTemplatesPage() {
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);

  useEffect(() => {
    ocrApi.listTemplates()
      .then(setTemplates)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const toggleExpand = async (code: string) => {
    if (expanded === code) {
      setExpanded(null);
      setDetail(null);
      return;
    }
    setExpanded(code);
    try {
      const d = await ocrApi.getTemplate(code);
      setDetail(d);
    } catch {
      setDetail(null);
    }
  };

  if (loading) return <div className="py-12 text-center text-gray-400">불러오는 중...</div>;

  return (
    <div>
      <p className="text-sm text-gray-500 mb-4">
        OCR 인식에 사용되는 문서 유형과 필드 매핑을 관리합니다. 총 {templates.length}개 템플릿.
      </p>

      <div className="space-y-3">
        {templates.map((t: any) => (
          <div key={t.code} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            {/* 헤더 */}
            <button
              onClick={() => toggleExpand(t.code)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50"
            >
              <span className={`w-2 h-2 rounded-full ${t.isActive ? "bg-green-400" : "bg-gray-300"}`} />
              <div className="flex-1">
                <span className="font-medium text-sm">{t.name}</span>
                <span className="ml-2 text-xs text-gray-400 font-mono">{t.code}</span>
              </div>
              <span className="text-xs text-gray-400">{t.description || ""}</span>
              <span className="text-gray-400">{expanded === t.code ? "\u25B2" : "\u25BC"}</span>
            </button>

            {/* 상세 (필드 목록) */}
            {expanded === t.code && detail && (
              <div className="border-t px-4 py-3 bg-gray-50">
                <div className="text-xs text-gray-500 mb-2">
                  연동: {detail.targetService} &rarr; {detail.targetEndpoint}
                </div>
                <table className="w-full text-xs">
                  <thead className="text-gray-500">
                    <tr>
                      <th className="text-left py-1 pr-3">필드 키</th>
                      <th className="text-left py-1 pr-3">라벨</th>
                      <th className="text-left py-1 pr-3">별칭</th>
                      <th className="text-left py-1 pr-3">타입</th>
                      <th className="text-center py-1 pr-3">필수</th>
                      <th className="text-left py-1">ERP 필드</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {(detail.fields || []).map((f: any) => (
                      <tr key={f.id}>
                        <td className="py-1.5 pr-3 font-mono">{f.key}</td>
                        <td className="py-1.5 pr-3">{f.label}</td>
                        <td className="py-1.5 pr-3 text-gray-400">{(f.aliases || []).join(", ") || "-"}</td>
                        <td className="py-1.5 pr-3">
                          <span className="px-1.5 py-0.5 bg-gray-100 rounded">{FIELD_TYPE_LABELS[f.type] || f.type}</span>
                        </td>
                        <td className="py-1.5 pr-3 text-center">{f.required ? "\u2713" : ""}</td>
                        <td className="py-1.5 font-mono text-gray-500">{f.erpFieldName || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
