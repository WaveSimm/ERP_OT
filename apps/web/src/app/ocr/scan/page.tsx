"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ocrApi } from "@/lib/api";

/* ── 상수 ────────────────────────────────────────── */
const CONFIDENCE_BADGE: Record<string, { label: string; icon: string; color: string; bg: string }> = {
  HIGH:   { label: "높음", icon: "\u2713", color: "text-green-700", bg: "bg-green-100" },
  MEDIUM: { label: "보통", icon: "\u25B3", color: "text-yellow-700", bg: "bg-yellow-100" },
  LOW:    { label: "낮음", icon: "\u2717", color: "text-red-700", bg: "bg-red-100" },
};

function getConfidenceLevel(c: number): string {
  if (c >= 0.95) return "HIGH";
  if (c >= 0.80) return "MEDIUM";
  return "LOW";
}

/* ── 메인 페이지 ──────────────────────────────────── */
export default function OcrScanPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const existingId = searchParams.get("id");

  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const [engines, setEngines] = useState<any[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [selectedEngine, setSelectedEngine] = useState("paddle-ko");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [highlightBox, setHighlightBox] = useState<any>(null);
  const [confirming, setConfirming] = useState(false);

  // 기존 결과 로드
  useEffect(() => {
    if (existingId) {
      setLoading(true);
      ocrApi.getResult(existingId)
        .then((r) => {
          setResult(r);
          initFieldValues(r);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [existingId]);

  // 메타 데이터 로드
  useEffect(() => {
    ocrApi.listTemplates().then(setTemplates).catch(() => {});
    ocrApi.engines().then(setEngines).catch(() => {});
  }, []);

  const initFieldValues = (r: any) => {
    const vals: Record<string, string> = {};
    for (const f of r.fields || []) {
      vals[f.fieldKey] = f.confirmedValue || f.parsedValue || f.ocrValue || "";
    }
    setFieldValues(vals);
  };

  /* ── 파일 업로드 + 스캔 ──────── */
  const handleScan = async (file: File) => {
    setScanning(true);
    setResult(null);
    setHighlightBox(null);
    try {
      const r = await ocrApi.scan(file, selectedTemplate || undefined, selectedEngine || undefined);
      setResult(r);
      initFieldValues(r);
      // URL에 id 추가 (히스토리 관리)
      router.replace(`/ocr/scan?id=${r.id}`, { scroll: false });
    } catch (err: any) {
      alert(err.message || "OCR 처리 실패");
    } finally {
      setScanning(false);
    }
  };

  /* ── 필드 수정 저장 ──────── */
  const handleSaveFields = async () => {
    if (!result) return;
    const fields = Object.entries(fieldValues).map(([fieldKey, confirmedValue]) => ({ fieldKey, confirmedValue }));
    try {
      const updated = await ocrApi.updateFields(result.id, fields);
      setResult(updated);
    } catch (err: any) {
      alert(err.message);
    }
  };

  /* ── 확인 완료 ──────── */
  const handleConfirm = async () => {
    if (!result) return;
    setConfirming(true);
    try {
      // 먼저 필드 저장
      const fields = Object.entries(fieldValues).map(([fieldKey, confirmedValue]) => ({ fieldKey, confirmedValue }));
      await ocrApi.updateFields(result.id, fields);
      // 확인 완료 처리
      const updated = await ocrApi.confirmResult(result.id);
      setResult(updated);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setConfirming(false);
    }
  };

  if (loading) return <div className="py-12 text-center text-gray-400">불러오는 중...</div>;

  return (
    <div className="flex flex-col gap-4">
      {/* 상단 바 */}
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={selectedTemplate}
          onChange={(e) => setSelectedTemplate(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
        >
          <option value="">문서 유형 자동판별</option>
          {templates.map((t: any) => (
            <option key={t.code} value={t.code}>{t.name}</option>
          ))}
        </select>

        <select
          value={selectedEngine}
          onChange={(e) => setSelectedEngine(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
        >
          {engines.filter((e: any) => e.ready).map((e: any) => (
            <option key={e.id} value={e.id}>{e.name}</option>
          ))}
        </select>

        {result && (
          <div className="flex items-center gap-3 ml-auto">
            {result.templateCode && (
              <span className="text-sm font-medium text-gray-700">
                {result.template?.name || result.templateCode}
              </span>
            )}
            {result.overallConfidence != null && (
              <ConfidenceBadge confidence={result.overallConfidence} />
            )}
            <span className="text-xs text-gray-400">
              {result.processingTimeMs && `${(result.processingTimeMs / 1000).toFixed(1)}s`}
            </span>
          </div>
        )}
      </div>

      {/* 업로드 영역 (결과가 없을 때만 전체 표시, 있을 때는 축소) */}
      {!result ? (
        <UploadArea onFile={handleScan} scanning={scanning} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" style={{ minHeight: "70vh" }}>
          {/* 좌: 이미지 뷰어 */}
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden flex flex-col">
            <div className="px-4 py-2 bg-gray-50 border-b text-sm text-gray-600 flex items-center gap-2">
              <span>원본 이미지</span>
              <span className="text-xs text-gray-400">{result.originalFileName}</span>
              <div className="flex-1" />
              <UploadMini onFile={handleScan} scanning={scanning} />
            </div>
            <OcrImageViewer
              imageUrl={ocrApi.imageUrl(result.id)}
              highlightBox={highlightBox}
              fields={result.fields}
              onFieldClick={(box: any) => setHighlightBox(box)}
            />
          </div>

          {/* 우: 필드 양식 */}
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden flex flex-col">
            <div className="px-4 py-2 bg-gray-50 border-b text-sm font-medium text-gray-700">
              인식 결과 필드
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <OcrFieldForm
                fields={result.fields || []}
                templateFields={result.template?.fields || []}
                values={fieldValues}
                onChange={(key, val) => setFieldValues((v) => ({ ...v, [key]: val }))}
                onHighlight={(box) => setHighlightBox(box)}
                activeBox={highlightBox}
              />
            </div>

            {/* 하단 버튼 */}
            <div className="px-4 py-3 border-t bg-gray-50 flex items-center gap-3">
              {result.status === "PENDING_REVIEW" && (
                <>
                  <button
                    onClick={handleSaveFields}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-100"
                  >
                    임시저장
                  </button>
                  <button
                    onClick={handleConfirm}
                    disabled={confirming}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
                  >
                    {confirming ? "처리중..." : "확인 완료"}
                  </button>
                </>
              )}
              {result.status === "CONFIRMED" && (
                <span className="text-sm text-green-600 font-medium">확인 완료됨</span>
              )}
              {result.status === "APPLIED" && (
                <span className="text-sm text-indigo-600 font-medium">ERP 반영 완료</span>
              )}
              <div className="flex-1" />
              <button
                onClick={() => router.push("/ocr")}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                목록으로
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── 업로드 영역 (드래그&드롭) ─────────────────── */
function UploadArea({ onFile, scanning }: { onFile: (f: File) => void; scanning: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFile(file);
  }, [onFile]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onFile(file);
  };

  return (
    <div
      className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors ${
        dragOver ? "border-blue-400 bg-blue-50" : "border-gray-300 bg-white"
      }`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {scanning ? (
        <div className="text-gray-500">
          <div className="inline-block w-8 h-8 border-4 border-blue-400 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="font-medium">OCR 처리 중...</p>
          <p className="text-sm text-gray-400 mt-1">이미지를 분석하고 있습니다</p>
        </div>
      ) : (
        <>
          <p className="text-lg text-gray-500 mb-2">문서 이미지를 드래그하거나 클릭하여 업로드</p>
          <p className="text-sm text-gray-400 mb-4">PNG, JPG, PDF (최대 10MB)</p>
          <button
            onClick={() => inputRef.current?.click()}
            className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            파일 선택
          </button>
          <input ref={inputRef} type="file" accept=".png,.jpg,.jpeg,.pdf" className="hidden" onChange={handleChange} />
        </>
      )}
    </div>
  );
}

/* ── 미니 업로드 버튼 (결과 화면 좌상단) ──────── */
function UploadMini({ onFile, scanning }: { onFile: (f: File) => void; scanning: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        onClick={() => inputRef.current?.click()}
        disabled={scanning}
        className="px-2 py-1 text-xs bg-blue-50 text-blue-600 rounded hover:bg-blue-100 disabled:opacity-50"
      >
        {scanning ? "처리중..." : "다른 파일"}
      </button>
      <input ref={inputRef} type="file" accept=".png,.jpg,.jpeg,.pdf" className="hidden" onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) onFile(f);
      }} />
    </>
  );
}

/* ── 이미지 뷰어 (확대/축소 + 하이라이트) ─────── */
function OcrImageViewer({
  imageUrl,
  highlightBox,
  fields,
  onFieldClick,
}: {
  imageUrl: string;
  highlightBox: any;
  fields: any[];
  onFieldClick: (box: any) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [imgLoaded, setImgLoaded] = useState(false);

  return (
    <div className="flex-1 overflow-auto relative bg-gray-100" ref={containerRef}>
      {/* 확대/축소 컨트롤 */}
      <div className="sticky top-2 left-2 z-10 flex gap-1 p-1">
        <button onClick={() => setScale((s) => Math.max(0.25, s - 0.25))} className="px-2 py-1 bg-white border rounded text-sm shadow-sm hover:bg-gray-50">-</button>
        <span className="px-2 py-1 bg-white border rounded text-xs shadow-sm">{Math.round(scale * 100)}%</span>
        <button onClick={() => setScale((s) => Math.min(3, s + 0.25))} className="px-2 py-1 bg-white border rounded text-sm shadow-sm hover:bg-gray-50">+</button>
        <button onClick={() => setScale(1)} className="px-2 py-1 bg-white border rounded text-xs shadow-sm hover:bg-gray-50">맞춤</button>
      </div>

      <div className="relative inline-block" style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}>
        <img
          src={imageUrl}
          alt="OCR 원본"
          className="max-w-none"
          onLoad={() => setImgLoaded(true)}
          crossOrigin="use-credentials"
        />

        {/* 바운딩 박스 오버레이 */}
        {imgLoaded && fields?.map((f: any, i: number) => {
          if (!f.boundingBox) return null;
          const box = f.boundingBox;
          const isActive = highlightBox && highlightBox.fieldKey === f.fieldKey;
          const level = getConfidenceLevel(f.confidence);
          const borderColor = level === "HIGH" ? "border-green-400" : level === "MEDIUM" ? "border-yellow-400" : "border-red-400";
          const bgColor = isActive
            ? (level === "HIGH" ? "bg-green-200/40" : level === "MEDIUM" ? "bg-yellow-200/40" : "bg-red-200/40")
            : "bg-transparent";

          return (
            <div
              key={i}
              className={`absolute border-2 ${borderColor} ${bgColor} cursor-pointer transition-colors`}
              style={{
                left: `${box.x * 100}%`,
                top: `${box.y * 100}%`,
                width: `${box.width * 100}%`,
                height: `${box.height * 100}%`,
              }}
              onClick={() => onFieldClick({ ...box, fieldKey: f.fieldKey })}
            />
          );
        })}
      </div>
    </div>
  );
}

/* ── 필드 양식 (우측 패널) ─────────────────────── */
function OcrFieldForm({
  fields,
  templateFields,
  values,
  onChange,
  onHighlight,
  activeBox,
}: {
  fields: any[];
  templateFields: any[];
  values: Record<string, string>;
  onChange: (key: string, val: string) => void;
  onHighlight: (box: any) => void;
  activeBox: any;
}) {
  // 템플릿 필드 순서에 따라 정렬, 없으면 OCR 결과 순서
  const sortedFields = templateFields.length > 0
    ? templateFields.map((tf: any) => {
        const match = fields.find((f: any) => f.fieldKey === tf.key);
        return { ...tf, ocrField: match };
      })
    : fields.map((f: any) => ({ key: f.fieldKey, label: f.fieldKey, ocrField: f }));

  if (sortedFields.length === 0) {
    return <div className="text-center text-gray-400 py-8">매핑된 필드가 없습니다.</div>;
  }

  // LOW 필드를 먼저 표시
  const lowFields = sortedFields.filter((f: any) => f.ocrField && getConfidenceLevel(f.ocrField.confidence) === "LOW");
  const otherFields = sortedFields.filter((f: any) => !f.ocrField || getConfidenceLevel(f.ocrField.confidence) !== "LOW");

  return (
    <div className="space-y-3">
      {lowFields.length > 0 && (
        <div className="text-xs text-red-600 font-medium mb-1">
          수동 확인 필요 ({lowFields.length}건)
        </div>
      )}
      {[...lowFields, ...otherFields].map((f: any) => {
        const ocrF = f.ocrField;
        const conf = ocrF?.confidence ?? 0;
        const level = getConfidenceLevel(conf);
        const badge = CONFIDENCE_BADGE[level];
        const isActive = activeBox?.fieldKey === f.key;

        return (
          <div
            key={f.key}
            className={`flex items-start gap-2 p-2 rounded-lg transition-colors cursor-pointer ${
              isActive ? "bg-blue-50 ring-1 ring-blue-300" : "hover:bg-gray-50"
            }`}
            onClick={() => ocrF?.boundingBox && onHighlight({ ...ocrF.boundingBox, fieldKey: f.key })}
          >
            {/* 신뢰도 뱃지 */}
            <div className={`mt-1.5 w-5 h-5 flex items-center justify-center rounded text-xs font-bold ${badge.bg} ${badge.color}`}>
              {badge.icon}
            </div>

            {/* 라벨 + 입력 */}
            <div className="flex-1 min-w-0">
              <label className="text-xs text-gray-500 mb-0.5 block">
                {f.label || f.key}
                {f.required && <span className="text-red-400 ml-0.5">*</span>}
                {ocrF && <span className="ml-2 text-gray-300">{Math.round(conf * 100)}%</span>}
              </label>
              <input
                type="text"
                value={values[f.key] ?? ""}
                onChange={(e) => onChange(f.key, e.target.value)}
                className={`w-full px-2.5 py-1.5 border rounded text-sm ${
                  level === "LOW" ? "border-red-300 bg-red-50/50" :
                  level === "MEDIUM" ? "border-yellow-300" :
                  "border-gray-200"
                }`}
              />
              {ocrF?.ocrValue && ocrF.ocrValue !== (values[f.key] ?? "") && (
                <div className="text-xs text-gray-400 mt-0.5 truncate">
                  원본: {ocrF.ocrValue}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── 신뢰도 뱃지 (헤더용) ─────────────────────── */
function ConfidenceBadge({ confidence }: { confidence: number }) {
  const level = getConfidenceLevel(confidence);
  const badge = CONFIDENCE_BADGE[level];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${badge.bg} ${badge.color}`}>
      {badge.icon} {Math.round(confidence * 100)}%
    </span>
  );
}
