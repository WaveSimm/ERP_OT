"use client";

/**
 * 프로젝트 마이그레이션 (ADMIN 전용)
 * 흐름: 엑셀 여러 개 선택 → 브라우저 파싱 + 담당자 매칭 → 미리보기(신규/중복/오류) → 신규만 일괄 적재
 *   - 중복 = 동일 프로젝트명이 DB에 이미 존재 (서버도 멱등으로 재차 차단)
 *   - 폴더 분류 없이 루트에 바로 적재 ([팀명] 접두어는 이름에만 유지)
 *   - 적재는 서버 단일 트랜잭션(POST /projects/import-planner) — 순차 REST 부하 회피
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getUser, projectApi, folderApi, userManagementApi } from "@/lib/api";
import { parsePlannerWorkbook, toImportPayload, type PlannerParsed, type PlannerUser } from "@/lib/planner-import";

type Status = "new" | "duplicate" | "error";

interface FileEntry {
  file: File;
  parsed: PlannerParsed;
  status: Status;
  reason?: string;
  folderExists: boolean;
}

interface ImportRow {
  name: string;
  ok: boolean;
  detail: string;
  projectId?: string;
}

const STATUS_META: Record<Status, { label: string; cls: string }> = {
  new: { label: "신규", cls: "bg-green-50 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800" },
  duplicate: { label: "중복", cls: "bg-amber-50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800" },
  error: { label: "오류", cls: "bg-red-50 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800" },
};

export default function ProjectMigrationPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [authorized, setAuthorized] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [users, setUsers] = useState<PlannerUser[]>([]);
  const [existingNames, setExistingNames] = useState<Set<string>>(new Set());
  const [folderNames, setFolderNames] = useState<Set<string>>(new Set());
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ImportRow[] | null>(null);

  useEffect(() => {
    const me = getUser();
    if (!me) { router.push("/login"); return; }
    if (me.role !== "ADMIN") { setAuthError("관리자만 접근할 수 있습니다."); return; }
    setAuthorized(true);
    (async () => {
      try {
        const [u, p, f] = await Promise.all([
          userManagementApi.list().catch(() => ({ items: [] as any[] })),
          projectApi.list().catch(() => ({ items: [] as any[] }) as any),
          folderApi.list().catch(() => [] as any[]),
        ]);
        const ulist: any[] = (u as any).items ?? [];
        setUsers(ulist.map((x) => ({ id: x.id, name: x.name })));
        setExistingNames(new Set((((p as any).items ?? []) as any[]).map((x) => x.name)));
        setFolderNames(new Set((f as any[]).map((x) => x.name)));
      } catch { /* 무시 — 매칭/중복판정은 빈 목록으로도 동작, 서버가 백스톱 */ }
    })();
  }, [router]);

  function reset() {
    setEntries([]); setResults(null); setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setBusy(true); setError(null); setResults(null); setEntries([]);
    try {
      const seen = new Set<string>();
      const out: FileEntry[] = [];
      for (const file of files) {
        const parsed = await parsePlannerWorkbook(file, users);
        let status: Status = "new";
        let reason: string | undefined;
        if (parsed.error) { status = "error"; reason = parsed.error; }
        else if (!parsed.tasks.length) { status = "error"; reason = "태스크가 없습니다."; }
        else if (!parsed.ownerMatched) { status = "error"; reason = `소유자 '${parsed.ownerName ?? "?"}' 계정 미매칭`; }
        else if (existingNames.has(parsed.projectName) || seen.has(parsed.projectName)) { status = "duplicate"; reason = "이미 적재됨"; }
        seen.add(parsed.projectName);
        out.push({ file, parsed, status, reason, folderExists: parsed.teamName ? folderNames.has(parsed.teamName) : true });
      }
      setEntries(out);
    } catch (err: any) {
      setError(err?.message ?? "파일 처리 중 오류가 발생했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function onImport() {
    const news = entries.filter((e) => e.status === "new");
    if (!news.length) return;
    setBusy(true); setError(null);

    const rows: ImportRow[] = [];
    for (const e of news) {
      try {
        // 팀 폴더에 넣지 않고 루트에 바로 적재 (folderId 미지정)
        const payload = toImportPayload(e.parsed, e.parsed.ownerId!, undefined);
        const res = await projectApi.importPlanner(payload);
        if (res.aborted) {
          rows.push({ name: e.parsed.projectName, ok: false, detail: "중복(이미 존재) — 건너뜀" });
        } else {
          rows.push({
            name: e.parsed.projectName, ok: true, projectId: res.projectId,
            detail: `태스크 ${res.tasks} · 세그먼트 ${res.segments} · 배정 ${res.assignments} · 의존성 ${res.dependencies}`,
          });
        }
      } catch (err: any) {
        rows.push({ name: e.parsed.projectName, ok: false, detail: err?.message ?? "적재 실패" });
      }
    }
    setResults(rows);
    setBusy(false);
    const importedOk = new Set(rows.filter((r) => r.ok).map((r) => r.name));
    setExistingNames((prev) => { const n = new Set(prev); importedOk.forEach((x) => n.add(x)); return n; });
    setEntries((prev) => prev.map((e) =>
      importedOk.has(e.parsed.projectName) ? { ...e, status: "duplicate" as Status, reason: "방금 적재됨" } : e,
    ));
  }

  if (authError) return <div className="p-8 text-center text-red-600 dark:text-red-400">{authError}</div>;
  if (!authorized) return <div className="p-8 text-center text-gray-400">확인 중…</div>;

  const counts = {
    total: entries.length,
    new: entries.filter((e) => e.status === "new").length,
    dup: entries.filter((e) => e.status === "duplicate").length,
    err: entries.filter((e) => e.status === "error").length,
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">프로젝트 마이그레이션</h1>
        <p className="mt-1 text-sm text-gray-500">
          MS Planner 내보내기 엑셀(<code className="px-1 bg-gray-100 rounded">[팀명] 프로젝트.xlsx</code>)을 <b>여러 개 한 번에</b> 올리면,
          프로젝트명 기준으로 <b>중복을 검사해 신규만</b> 적재합니다. 폴더 분류 없이 루트에 바로 등록되며, 담당자는 이름으로 자동 매칭됩니다.
        </p>
      </div>

      {/* 업로드 */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            multiple
            onChange={onFiles}
            disabled={busy}
            className="block text-sm text-gray-700 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-blue-700 dark:file:text-blue-300 hover:file:bg-blue-100 disabled:opacity-50"
          />
          {(entries.length > 0 || results) && (
            <button onClick={reset} disabled={busy} className="ml-auto text-sm text-gray-500 hover:text-gray-700">초기화</button>
          )}
        </div>
        {busy && <p className="mt-2 text-sm text-blue-600 dark:text-blue-400">처리 중…</p>}
      </div>

      {error && <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</div>}

      {/* 미리보기 */}
      {entries.length > 0 && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="전체" value={counts.total} tone="gray" />
            <StatCard label="신규(적재 대상)" value={counts.new} tone="green" />
            <StatCard label="중복(이미 있음)" value={counts.dup} tone="amber" />
            <StatCard label="오류" value={counts.err} tone="red" />
          </div>

          <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
            <div className="overflow-auto max-h-[28rem]">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium w-20">상태</th>
                    <th className="px-3 py-2 text-left font-medium">프로젝트명</th>
                    <th className="px-3 py-2 text-left font-medium w-28">소유자</th>
                    <th className="px-3 py-2 text-left font-medium w-28">폴더</th>
                    <th className="px-3 py-2 text-right font-medium w-16">태스크</th>
                    <th className="px-3 py-2 text-right font-medium w-16">배정</th>
                    <th className="px-3 py-2 text-right font-medium w-16">의존성</th>
                    <th className="px-3 py-2 text-left font-medium">비고</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e, i) => {
                    const m = STATUS_META[e.status];
                    return (
                      <tr key={i} className="border-t border-gray-100 align-top">
                        <td className="px-3 py-2">
                          <span className={`inline-block rounded border px-1.5 py-0.5 text-xs font-medium ${m.cls}`}>{m.label}</span>
                        </td>
                        <td className="px-3 py-2 text-gray-800">{e.parsed.projectName}</td>
                        <td className="px-3 py-2 text-gray-600">
                          {e.parsed.ownerMatched
                            ? <>✓ {e.parsed.ownerName}</>
                            : <span className="text-red-600 dark:text-red-400">✗ {e.parsed.ownerName ?? "—"}</span>}
                        </td>
                        <td className="px-3 py-2 text-gray-600">
                          {e.parsed.teamName ?? "—"}
                          {e.parsed.teamName && !e.folderExists && <span className="ml-1 text-xs text-blue-600 dark:text-blue-400">(신규)</span>}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-700">{e.parsed.tasks.length || "—"}</td>
                        <td className="px-3 py-2 text-right text-gray-700">
                          {e.parsed.tasks.reduce((s, t) => s + t.assigneeIds.length, 0) || "—"}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-700">{e.parsed.deps.length || "—"}</td>
                        <td className="px-3 py-2 text-gray-500">
                          {e.reason && <div>{e.reason}</div>}
                          {e.parsed.unmatchedNames.length > 0 && (
                            <div className="text-xs text-amber-600 dark:text-amber-400">미매칭 담당자: {e.parsed.unmatchedNames.join(", ")} (미배정)</div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onImport}
              disabled={busy || counts.new === 0}
              className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              신규 {counts.new}건 적재
            </button>
            {counts.new === 0 && <span className="text-sm text-gray-500">적재할 신규 프로젝트가 없습니다.</span>}
          </div>
        </div>
      )}

      {/* 결과 */}
      {results && (
        <div className="rounded-xl border border-green-200 dark:border-green-800 bg-green-50 p-5 space-y-2">
          <p className="text-sm font-semibold text-green-800 dark:text-green-300">✅ 적재 결과 ({results.filter((r) => r.ok).length}/{results.length} 성공)</p>
          <ul className="text-sm space-y-1">
            {results.map((r, i) => (
              <li key={i} className={r.ok ? "text-green-900 dark:text-green-300" : "text-red-700 dark:text-red-300"}>
                {r.ok ? "•" : "⚠️"} <b>{r.name}</b> — {r.detail}
              </li>
            ))}
          </ul>
          <Link href="/projects" className="inline-block mt-2 text-sm font-medium text-blue-700 dark:text-blue-300 hover:underline">
            → 프로젝트 목록에서 확인하기
          </Link>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: "gray" | "green" | "amber" | "red" }) {
  const tones: Record<string, string> = {
    gray: "bg-gray-50 border-gray-200 text-gray-700",
    green: "bg-green-50 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300",
    amber: "bg-amber-50 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300",
    red: "bg-red-50 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300",
  };
  return (
    <div className={`rounded-lg border p-3 ${tones[tone]}`}>
      <div className="text-2xl font-bold">{value.toLocaleString()}</div>
      <div className="text-xs">{label}</div>
    </div>
  );
}
