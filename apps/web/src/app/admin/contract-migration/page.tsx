"use client";

/**
 * 계약 마이그레이션 (ADMIN 전용) — 2026-06-25
 * 흐름: 엑셀 선택 → 브라우저 파싱 → 미리보기(신규/중복/오류) → 신규만 적재
 * 중복 판정 = contractNumber 기준. 신규 0건이면 "이미 마이그레이션됨"으로 적재 차단.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getUser } from "@/lib/api";
import { procurementApi } from "@/lib/api/equipment";
import { parseContractWorkbook, type ParsedContract } from "@/lib/contract-import";

type Preview = Awaited<ReturnType<typeof procurementApi.importContractsPreview>>;
type ImportResult = Awaited<ReturnType<typeof procurementApi.importContracts>>;

export default function ContractMigrationPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [authorized, setAuthorized] = useState(false);
  const [fileName, setFileName] = useState<string>("");
  const [parsed, setParsed] = useState<ParsedContract[]>([]);
  const [parseSkipped, setParseSkipped] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const me = getUser();
    if (!me) { router.push("/login"); return; }
    if (me.role !== "ADMIN") { setError("관리자만 접근할 수 있습니다."); return; }
    setAuthorized(true);
  }, [router]);

  function reset() {
    setFileName(""); setParsed([]); setParseSkipped(0);
    setPreview(null); setResult(null); setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setError(null); setPreview(null); setResult(null);
    setParsed([]); setParseSkipped(0); setFileName(file.name);
    try {
      const { records, skipped } = await parseContractWorkbook(file);
      setParsed(records);
      setParseSkipped(skipped);
      if (records.length === 0) {
        setError("파싱된 계약이 없습니다. 파일 양식을 확인해주세요.");
        return;
      }
      const pv = await procurementApi.importContractsPreview(records);
      setPreview(pv);
    } catch (err: any) {
      setError(err?.message ?? "파일 처리 중 오류가 발생했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function onImport() {
    if (!preview || preview.newCount === 0) return;
    setBusy(true); setError(null);
    try {
      const res = await procurementApi.importContracts(parsed);
      setResult(res);
      setPreview(null);
    } catch (err: any) {
      setError(err?.message ?? "적재 중 오류가 발생했습니다.");
    } finally {
      setBusy(false);
    }
  }

  if (error && !authorized) {
    return <div className="p-8 text-center text-red-600 dark:text-red-400">{error}</div>;
  }
  if (!authorized) {
    return <div className="p-8 text-center text-gray-400">확인 중…</div>;
  }

  const allDuplicate = preview != null && preview.newCount === 0 && preview.invalidCount === 0 && preview.duplicateCount > 0;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">계약 마이그레이션</h1>
        <p className="mt-1 text-sm text-gray-500">
          연도별 계약 엑셀(예: <code className="px-1 bg-gray-100 rounded">2026년 계약파일리스트.xlsx</code>)을 업로드하면
          계약번호(<code className="px-1 bg-gray-100 rounded">#YY-순번</code>) 기준으로 중복을 검사해 <b>신규 건만</b> 적재합니다.
          이미 등록된 계약은 자동으로 건너뜁니다.
        </p>
      </div>

      {/* 업로드 */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={onFile}
            disabled={busy}
            className="block text-sm text-gray-700 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-blue-700 hover:file:bg-blue-100 disabled:opacity-50"
          />
          {(fileName || preview || result) && (
            <button onClick={reset} disabled={busy} className="ml-auto text-sm text-gray-500 hover:text-gray-700">
              초기화
            </button>
          )}
        </div>
        {fileName && (
          <p className="mt-2 text-xs text-gray-500">
            선택: <b>{fileName}</b>
            {parsed.length > 0 && <> · 파싱 {parsed.length.toLocaleString()}건{parseSkipped > 0 && <> · 연번누락 {parseSkipped}건 제외</>}</>}
          </p>
        )}
        {busy && <p className="mt-2 text-sm text-blue-600 dark:text-blue-400">처리 중…</p>}
      </div>

      {error && authorized && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</div>
      )}

      {/* 미리보기 */}
      {preview && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="전체" value={preview.total} tone="gray" />
            <StatCard label="신규(적재 대상)" value={preview.newCount} tone="green" />
            <StatCard label="중복(이미 있음)" value={preview.duplicateCount} tone="amber" />
            <StatCard label="오류(누락)" value={preview.invalidCount} tone="red" />
          </div>

          {allDuplicate && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
              ⚠️ 이 파일의 계약은 <b>모두 이미 마이그레이션</b>되어 있습니다. 적재할 신규 항목이 없습니다.
            </div>
          )}

          {preview.sampleDuplicates.length > 0 && (
            <SampleTable title={`중복 건 (이미 등록됨) — 상위 ${preview.sampleDuplicates.length}건`} rows={preview.sampleDuplicates} tone="amber" />
          )}
          {preview.sampleInvalid.length > 0 && (
            <SampleTable
              title={`오류 건 (계약번호/건명 누락) — 상위 ${preview.sampleInvalid.length}건`}
              rows={preview.sampleInvalid.map((r) => ({ contractNumber: r.contractNumber, name: r.name, client: "" }))}
              tone="red"
            />
          )}
          {preview.sampleNew.length > 0 && (
            <SampleTable title={`신규 건 (적재 예정) — 상위 ${preview.sampleNew.length}건`} rows={preview.sampleNew} tone="green" />
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={onImport}
              disabled={busy || preview.newCount === 0}
              className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              신규 {preview.newCount.toLocaleString()}건 적재
            </button>
            {preview.newCount === 0 && <span className="text-sm text-gray-500">적재할 신규 항목이 없습니다.</span>}
          </div>
        </div>
      )}

      {/* 결과 */}
      {result && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-5 space-y-2">
          <p className="text-sm font-semibold text-green-800 dark:text-green-300">✅ 마이그레이션 완료</p>
          <ul className="text-sm text-green-900 space-y-0.5 dark:text-green-300">
            <li>• 적재 성공: <b>{result.imported.toLocaleString()}건</b></li>
            <li>• 중복 건너뜀: {result.duplicateInDb.toLocaleString()}건</li>
            <li>• 오류(누락): {result.invalid.toLocaleString()}건</li>
            <li>• 전체 처리: {result.total.toLocaleString()}건</li>
          </ul>
          <Link href="/procurement/contracts" className="inline-block mt-2 text-sm font-medium text-blue-700 hover:underline dark:text-blue-300">
            → 계약 목록에서 확인하기
          </Link>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: "gray" | "green" | "amber" | "red" }) {
  const tones: Record<string, string> = {
    gray: "bg-gray-50 border-gray-200 text-gray-700",
    green: "bg-green-50 border-green-200 text-green-700 dark:text-green-300",
    amber: "bg-amber-50 border-amber-200 text-amber-700 dark:text-amber-300",
    red: "bg-red-50 border-red-200 text-red-700 dark:text-red-300",
  };
  return (
    <div className={`rounded-lg border p-3 ${tones[tone]}`}>
      <div className="text-2xl font-bold">{value.toLocaleString()}</div>
      <div className="text-xs">{label}</div>
    </div>
  );
}

function SampleTable({ title, rows, tone }: { title: string; rows: { contractNumber: string; name: string; client: string }[]; tone: "green" | "amber" | "red" }) {
  const head: Record<string, string> = {
    green: "text-green-700 dark:text-green-300",
    amber: "text-amber-700 dark:text-amber-300",
    red: "text-red-700 dark:text-red-300",
  };
  return (
    <details className="rounded-lg border border-gray-200 bg-white">
      <summary className={`cursor-pointer px-4 py-2.5 text-sm font-medium ${head[tone]}`}>{title}</summary>
      <div className="max-h-64 overflow-auto border-t border-gray-100">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="px-3 py-1.5 text-left font-medium w-28">계약번호</th>
              <th className="px-3 py-1.5 text-left font-medium">계약건명</th>
              <th className="px-3 py-1.5 text-left font-medium w-40">고객사</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.contractNumber}-${i}`} className="border-t border-gray-50">
                <td className="px-3 py-1.5 font-mono text-gray-600">{r.contractNumber || "—"}</td>
                <td className="px-3 py-1.5 text-gray-800">{r.name || "—"}</td>
                <td className="px-3 py-1.5 text-gray-600">{r.client || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
