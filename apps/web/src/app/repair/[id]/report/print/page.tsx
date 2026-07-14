"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { repairApi } from "@/lib/api";
import { COMPANY_INFO } from "@/lib/company";

// 수리관리 v2.1 (2026-05-05) — 점검보고서 인쇄 페이지
// AS관리_2022_V10.xlsx "점검보고서(샘플)" 양식 매핑
//
// 라우트: /repair/[id]/report/print
// 동작: 인쇄 버튼 + window.print() / ?auto=1이면 마운트 후 자동 인쇄
// 권한: 보고서가 작성된 RepairOrder만 (없으면 안내 + 뒤로 가기 버튼)

function fmtDate(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface StepAttachment {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  url: string;
  isImage: boolean;
}

interface InspectionStep {
  step?: number;
  content?: string;
  result?: string;
  attachments?: StepAttachment[];
}

export default function ReportPrintPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const auto = search.get("auto") === "1";

  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const o = await repairApi.getRepairOrder(params.id);
        if (!cancelled) setOrder(o);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "조회 실패");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  // 자동 인쇄
  useEffect(() => {
    if (auto && order?.inspectionReport) {
      const t = setTimeout(() => window.print(), 400);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [auto, order]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="max-w-md mx-auto p-8 text-center text-gray-500">
        <p>{error ?? "수리 건을 찾을 수 없습니다."}</p>
        <button onClick={() => { try { window.close(); } catch {} }} className="mt-4 text-sm text-blue-600 underline">× 닫기</button>
      </div>
    );
  }

  // 보고서 row 없어도 양식 출력 (RepairOrder 정보만으로 빈 양식). 수리관리 v2.2
  const report = order.inspectionReport ?? {};

  // ─── 양식 매핑 ──────────────────────────────────────────────────────────────
  const reportNumber = report.reportNumber || order.orderNumber || "-";
  const manufacturer = order.customerAsset?.manufacturer || order.equipment?.manufacturer || order.sensor?.manufacturer || "-";
  const serialNumber = order.customerAsset?.serialNumber || order.equipment?.serialNumber || order.sensor?.serialNumber || order.productSerial || "-";
  const customerName = order.customer?.name || "자사 장비";
  const contactName = order.customerContactName || "-";
  const contactPhone = order.customerContactPhone || "-";
  const inspectorName = report.inspectorName || order.assigneeName || order.inspector1stName || "-";
  const receivedAt = fmtDate(order.receivedAt || order.createdAt);
  const symptom = report.symptom || order.symptom || "";
  const result = report.result || "";
  const needsMfg = report.needsMfgRepair === true;
  const mfgReason = report.mfgRepairReason || "";

  // 4-phase 매핑 (수리관리 v1.2, 2026-05-06)
  const decision1st = order.decision1st as string | null;
  const isInHouse = decision1st === "IN_HOUSE_REPAIR";
  const isMfg = decision1st === "SEND_TO_MFG";
  const decisionLabelMap: Record<string, string> = {
    IN_HOUSE_REPAIR: "본사수리",
    SEND_TO_MFG: "제조사발송",
    NORMAL: "정상",
    KEEP_AS_IS: "수리안함",
  };
  const decisionLabel = (d: string | null) => d ? (decisionLabelMap[d] || d) : "-";

  const phaseAtts = report.phaseAttachments || {};
  const firstAtts: StepAttachment[] = Array.isArray(phaseAtts.first) ? phaseAtts.first : [];
  const inHouseAtts: StepAttachment[] = Array.isArray(phaseAtts.inHouse) ? phaseAtts.inHouse : [];
  const mfgAtts: StepAttachment[] = Array.isArray(phaseAtts.mfg) ? phaseAtts.mfg : [];
  const secondAtts: StepAttachment[] = Array.isArray(phaseAtts.second) ? phaseAtts.second : [];
  const resultAtts: StepAttachment[] = Array.isArray(phaseAtts.result) ? phaseAtts.result : [];

  // legacy inspectionSteps (백워드 호환)
  const legacySteps: InspectionStep[] = Array.isArray(report.inspectionSteps) ? report.inspectionSteps : [];

  const renderPhaseImages = (atts: StepAttachment[]) => {
    const images = atts.filter((a) => a.isImage);
    if (images.length === 0) return null;
    return (
      <div className="step-images">
        {images.map((a) => (
          <figure key={a.id} className="step-image">
            <img src={a.url} alt={a.fileName} />
          </figure>
        ))}
      </div>
    );
  };
  const renderPhaseFiles = (atts: StepAttachment[]) => {
    const files = atts.filter((a) => !a.isImage);
    if (files.length === 0) return null;
    return (
      <div className="phase-files">📎 {files.map((f) => f.fileName).join(", ")}</div>
    );
  };

  return (
    <div className="report-print-root">
      {/* 인쇄 시 숨김 — 상단 액션 바 */}
      <div className="no-print sticky top-0 bg-gray-100 border-b border-gray-300 px-4 py-2 flex items-center gap-2 z-10">
        <a
          href={`/repair/${order.id}`}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-white"
        >
          ← 수리 상세
        </a>
        <div className="flex-1" />
        <span className="text-xs text-gray-500">미리보기 — 인쇄 버튼을 눌러 출력하거나 PDF로 저장하세요</span>
        <button onClick={() => window.print()} className="px-4 py-1.5 bg-blue-600 text-white rounded text-sm font-semibold hover:bg-blue-700">
          🖨 인쇄 / PDF 저장
        </button>
      </div>

      {/* A4 본문 */}
      <article className="report-a4">
        {/* 제목 */}
        <h1 className="report-title">수리/점검 보고서</h1>

        {/* 기본 정보 표 */}
        <table className="info-table">
          <tbody>
            <tr>
              <th className="th-narrow">접수번호</th>
              <td colSpan={3}>{reportNumber}</td>
            </tr>
            <tr>
              <th rowSpan={2} className="th-narrow">장비이력</th>
              <th className="th-sub">제작사</th>
              <td>{manufacturer}</td>
            </tr>
            <tr>
              <th className="th-sub">일련번호</th>
              <td>{serialNumber}</td>
            </tr>
            <tr>
              <th rowSpan={2} className="th-narrow">사용자</th>
              <th className="th-sub">회사명</th>
              <td>{customerName}</td>
            </tr>
            <tr>
              <th className="th-sub">담당연락처</th>
              <td>
                {contactName !== "-" && <span>{contactName}</span>}
                {contactName !== "-" && contactPhone !== "-" && <span> / </span>}
                {contactPhone !== "-" && <span>{contactPhone}</span>}
                {contactName === "-" && contactPhone === "-" && <span>-</span>}
              </td>
            </tr>
            <tr>
              <th rowSpan={2} className="th-narrow">수리점검<br />담당자</th>
              <th className="th-sub">담당자</th>
              <td>{inspectorName}</td>
            </tr>
            <tr>
              <th className="th-sub">접수일</th>
              <td>{receivedAt}</td>
            </tr>
          </tbody>
        </table>

        {/* 접수 증상 */}
        <section className="report-section">
          <h3 className="section-title">접수 증상</h3>
          <div className="section-body symptom">
            {symptom ? <pre>{symptom}</pre> : <span className="text-gray-400">-</span>}
          </div>
        </section>

        {/* ① 1차 점검 — 항상 */}
        <section className="report-section">
          <h3 className="section-title">① 1차 점검</h3>
          <div className="section-body">
            {order.diagnosis1st && <div className="phase-line"><strong>소견:</strong> {order.diagnosis1st}</div>}
            {decision1st && (
              <div className="phase-line">
                <strong>판단:</strong> {decisionLabel(decision1st)}
                {order.decision1stReason && <span> / 사유: {order.decision1stReason}</span>}
              </div>
            )}
            {!order.diagnosis1st && !decision1st && <span className="text-gray-400">-</span>}
            {renderPhaseImages(firstAtts)}
            {renderPhaseFiles(firstAtts)}
          </div>
        </section>

        {/* ② 본사 수리 — IN_HOUSE_REPAIR */}
        {isInHouse && (
          <section className="report-section">
            <h3 className="section-title">② 본사 수리</h3>
            <div className="section-body">
              {order.repairDetails ? <pre>{order.repairDetails}</pre> : <span className="text-gray-400">-</span>}
              {renderPhaseImages(inHouseAtts)}
              {renderPhaseFiles(inHouseAtts)}
            </div>
          </section>
        )}

        {/* ③ 제조사 수리 — SEND_TO_MFG */}
        {isMfg && (
          <section className="report-section">
            <h3 className="section-title">③ 제조사 수리</h3>
            <div className="section-body">
              {order.mfgReferenceNo && <div className="phase-line"><strong>Maker Ref:</strong> {order.mfgReferenceNo}</div>}
              {order.mfgInspectionResult && <div className="phase-line"><strong>제조사 점검 결과:</strong> {order.mfgInspectionResult}</div>}
              {order.mfgRepairDetails && <div className="phase-line"><strong>제조사 수리 내용:</strong> {order.mfgRepairDetails}</div>}
              {!order.mfgReferenceNo && !order.mfgInspectionResult && !order.mfgRepairDetails && <span className="text-gray-400">-</span>}
              {renderPhaseImages(mfgAtts)}
              {renderPhaseFiles(mfgAtts)}
            </div>
          </section>
        )}

        {/* ④ 2차 점검 — SEND_TO_MFG */}
        {isMfg && (
          <section className="report-section">
            <h3 className="section-title">④ 2차 점검</h3>
            <div className="section-body">
              {order.diagnosis2nd && <div className="phase-line"><strong>소견:</strong> {order.diagnosis2nd}</div>}
              {order.decision2nd && (
                <div className="phase-line">
                  <strong>판단:</strong> {decisionLabel(order.decision2nd)}
                  {order.decision2ndReason && <span> / 사유: {order.decision2ndReason}</span>}
                </div>
              )}
              {!order.diagnosis2nd && !order.decision2nd && <span className="text-gray-400">-</span>}
              {renderPhaseImages(secondAtts)}
              {renderPhaseFiles(secondAtts)}
            </div>
          </section>
        )}

        {/* legacy inspectionSteps — 백워드 호환 */}
        {legacySteps.length > 0 && (
          <section className="report-section">
            <h3 className="section-title">점검 단계 <span style={{ fontSize: "9pt", fontWeight: "normal", color: "#92400e" }}>(이전 데이터)</span></h3>
            <div className="section-body">
              <ol className="step-list">
                {legacySteps.map((s, i) => {
                  const images = (s.attachments ?? []).filter((a) => a.isImage);
                  return (
                    <li key={i}>
                      <span className="step-content">{s.content || ""}</span>
                      {s.result && <div className="step-result">→ {s.result}</div>}
                      {images.length > 0 && (
                        <div className="step-images">
                          {images.map((a) => (
                            <figure key={a.id} className="step-image">
                              <img src={a.url} alt={a.fileName} />
                            </figure>
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>
          </section>
        )}

        {/* 점검 결과 */}
        <section className="report-section">
          <h3 className="section-title">점검 결과</h3>
          <div className="section-body">
            {result ? <pre>{result}</pre> : <span className="text-gray-400">-</span>}
            {renderPhaseImages(resultAtts)}
            {renderPhaseFiles(resultAtts)}
          </div>
        </section>

        {/* 제조사 수리 여부 */}
        <section className="report-section">
          <h3 className="section-title">제조사 수리 여부</h3>
          <div className="section-body">
            <span className="mfg-mark">{needsMfg ? "☑ 필요" : "☑ 불필요"}</span>
            {needsMfg && mfgReason && <span className="mfg-reason">  사유: {mfgReason}</span>}
          </div>
        </section>

        {/* 풋터 — 회사 로고 + 주소 */}
        <footer className="report-footer">
          <img src={COMPANY_INFO.logoUrl} alt={COMPANY_INFO.name} className="footer-logo" />
          <div className="footer-text">
            <div>{COMPANY_INFO.nameKor}</div>
            <div>{COMPANY_INFO.addressKor}</div>
            <div className="footer-en">{COMPANY_INFO.address}</div>
          </div>
        </footer>
      </article>

      {/* 인쇄용 + 화면 미리보기 CSS */}
      <style jsx global>{`
        body { background: #f3f4f6; }
        .report-print-root { min-height: 100vh; }

        /* 화면 미리보기에서 A4 비율 */
        .report-a4 {
          width: 21cm;
          min-height: 29.7cm;
          margin: 1.5rem auto;
          padding: 1.6cm 1.6cm 1.2cm;
          background: white;
          box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
          color: #111827;
          font-family: "Malgun Gothic", "Apple SD Gothic Neo", system-ui, sans-serif;
          font-size: 11pt;
          line-height: 1.5;
        }

        .report-title {
          text-align: center;
          font-size: 20pt;
          font-weight: 700;
          margin: 0 0 0.5cm 0;
          padding-bottom: 0.2cm;
          border-bottom: 2px solid #1e3a8a;
        }

        .info-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 0.5cm;
          font-size: 10.5pt;
        }
        .info-table th, .info-table td {
          border: 1px solid #4b5563;
          padding: 6px 10px;
          text-align: left;
          vertical-align: middle;
        }
        .info-table th {
          background: #f3f4f6;
          font-weight: 600;
          width: 18%;
        }
        .info-table .th-narrow { width: 12%; text-align: center; }
        .info-table .th-sub { width: 14%; background: #fafafa; text-align: center; }

        .report-section {
          margin-top: 0.4cm;
        }
        .section-title {
          font-size: 12pt;
          font-weight: 700;
          background: #e5e7eb;
          padding: 4px 10px;
          margin: 0;
          border-left: 4px solid #1e3a8a;
        }
        .section-body {
          padding: 8px 12px;
          border: 1px solid #d1d5db;
          border-top: 0;
          min-height: 1.2cm;
        }
        .section-body pre {
          margin: 0;
          font-family: inherit;
          white-space: pre-wrap;
          word-break: break-word;
        }

        .step-list {
          margin: 0;
          padding-left: 1.5em;
        }
        .step-list li {
          margin-bottom: 4px;
        }
        .step-content {
          font-weight: 500;
        }
        .step-result {
          margin-left: 1em;
          color: #4b5563;
          font-size: 10pt;
        }
        /* 수리관리 v1.2 phase 매핑 */
        .phase-line {
          margin: 2px 0;
        }
        .phase-line strong {
          color: #1f2937;
          margin-right: 4px;
        }
        .phase-files {
          margin-top: 4px;
          font-size: 9pt;
          color: #4b5563;
        }

        .step-images {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 4px;
          margin: 6px 0 4px 1em;
          max-width: 16cm;
        }
        .step-image {
          margin: 0;
          border: 1px solid #d1d5db;
          background: #f9fafb;
          aspect-ratio: 4 / 3;
          overflow: hidden;
        }
        .step-image img {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }

        .mfg-mark {
          font-weight: 700;
          font-size: 12pt;
        }
        .mfg-reason {
          color: #4b5563;
        }

        .report-footer {
          margin-top: 0.6cm;
          padding-top: 0.3cm;
          border-top: 1px solid #9ca3af;
          position: relative;
          text-align: center;
          font-size: 9pt;
          color: #4b5563;
          line-height: 1.4;
          min-height: 1.2cm;
        }
        .footer-logo {
          position: absolute;
          left: 0;
          top: 50%;
          transform: translateY(-30%);
          height: 1cm;
          width: auto;
        }
        .footer-text {
          /* 가운데 정렬 (text-align: center 부모 상속) */
        }
        .footer-en {
          margin-top: 2px;
          font-size: 8pt;
          color: #6b7280;
        }

        /* 인쇄 시 */
        @media print {
          body { background: white !important; }
          .no-print { display: none !important; }
          /* AppLayout 전역 헤더/네비 등 페이지 크롬이 인쇄물에 섞이는 것 방지 */
          header, nav, aside, header.app-header, .app-shell-header, .app-sidebar { display: none !important; }
          .report-a4 {
            width: auto;
            min-height: auto;
            margin: 0;
            padding: 0;
            box-shadow: none;
          }
          @page {
            size: A4;
            margin: 1.2cm 1.2cm 1.5cm;
          }
        }
      `}</style>
    </div>
  );
}
