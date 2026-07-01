"use client";

// MS Teams Planner export(.xlsx) → 프로젝트 마이그레이션용 브라우저 파서.
//   scripts/planner-import.js 로직 포팅 + import-planner.py의 "마일스톤 자식 강제 해제" 안전장치.
//   - 메타: 1~8행 (A열=키, B열=값)
//   - 헤더: '개요 번호'+'할당 대상' 있는 행 (보통 9행), 그 다음부터 데이터
//   - 담당자 이름은 "윤송 심"(이름 성) → "심윤송"(성 이름) 뒤집어 매칭
import * as XLSX from "xlsx";

export interface PlannerUser {
  id: string;
  name: string;
}

export interface PlannerParsedTask {
  outline: string;
  parentOutline: string | null;
  name: string;
  sortOrder: number;
  isMilestone: boolean;
  start: string | null; // YYYY-MM-DD
  end: string | null;
  progress: number; // 0~100
  hasSegment: boolean;
  assigneeIds: string[];
  assigneeNames: string[];
  unmatched: string[];
  workLogs: string[]; // 비고·메모 원문(비어있지 않은 것) — 작업일지(WorkLog)로 적재
}

export interface PlannerParsed {
  projectName: string; // 적재될 프로젝트 이름 (파일명 기준)
  metaProjectName: string; // 엑셀 메타 '프로젝트 이름'
  teamName: string | null; // 파일명 [팀명]
  ownerName: string | null;
  ownerId: string | null;
  ownerMatched: boolean;
  metaProgress: number | null; // 0~100
  tasks: PlannerParsedTask[];
  deps: { predOutline: string; succOutline: string; type: string }[];
  unmatchedNames: string[]; // distinct 미매칭 담당자 이름
  error?: string;
}

const strip = (s: unknown) => String(s ?? "").replace(/\s+/g, "").trim();

function buildUserMap(users: PlannerUser[]): Map<string, PlannerUser> {
  const m = new Map<string, PlannerUser>();
  for (const u of users) m.set(strip(u.name), u);
  return m;
}

/** "윤송 심" → "심윤송" 뒤집기 후 매칭, 안 되면 직접 매칭 */
function matchUser(plannerName: string, byKey: Map<string, PlannerUser>): PlannerUser | null {
  const reversed = String(plannerName).trim().split(/\s+/).reverse().join("");
  if (byKey.has(reversed)) return byKey.get(reversed)!;
  const direct = strip(plannerName);
  if (byKey.has(direct)) return byKey.get(direct)!;
  return null;
}

/** Excel 직렬 날짜(또는 문자열) → YYYY-MM-DD */
function asDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    const d = new Date(Math.round((v - 25569) * 86400000));
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const m = String(v).match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[0] : null;
}

/** % 완료: 0~1 비율이면 ×100, 이미 0~100이면 그대로 */
function asPct(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace("%", ""));
  if (isNaN(n)) return 0;
  const pct = n <= 1 ? Math.round(n * 100) : Math.round(n);
  return Math.max(0, Math.min(100, pct));
}

const DEP_RE = /(\d+)\s*(FS|SS|FF|SF)?/gi;
function parseDeps(v: unknown): { predNo: number; type: string }[] {
  const out: { predNo: number; type: string }[] = [];
  const s = String(v ?? "");
  let m: RegExpExecArray | null;
  DEP_RE.lastIndex = 0;
  while ((m = DEP_RE.exec(s))) out.push({ predNo: Number(m[1]), type: (m[2] || "FS").toUpperCase() });
  return out;
}

function teamFromName(fileName: string): string | null {
  const m = fileName.match(/^\[([^\]]+)\]/);
  return m ? m[1].trim() : null;
}

export async function parsePlannerWorkbook(file: File, users: PlannerUser[]): Promise<PlannerParsed> {
  const byKey = buildUserMap(users);
  const projectName = file.name.replace(/\.(xlsx|xls)$/i, "").trim();
  const teamName = teamFromName(file.name);

  const base: PlannerParsed = {
    projectName, metaProjectName: "", teamName,
    ownerName: null, ownerId: null, ownerMatched: false, metaProgress: null,
    tasks: [], deps: [], unmatchedNames: [],
  };

  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", raw: true, cellDates: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: true, defval: null });

    // 메타 (1~8행)
    const meta: Record<string, unknown> = {};
    for (let i = 0; i < 8 && i < rows.length; i++) {
      const k = rows[i]?.[0];
      if (k != null && String(k).trim()) meta[String(k).trim()] = rows[i]?.[1] ?? null;
    }
    base.metaProjectName = String(meta["프로젝트 이름"] ?? "").trim();
    base.metaProgress = meta["% 완료"] != null ? asPct(meta["% 완료"]) : null;
    const ownerRaw = meta["플랜 소유자"] != null ? String(meta["플랜 소유자"]).trim() : "";
    if (ownerRaw) {
      base.ownerName = ownerRaw;
      const ou = matchUser(ownerRaw, byKey);
      if (ou) { base.ownerId = ou.id; base.ownerMatched = true; }
    }

    // 헤더행
    let hidx = rows.findIndex((r) =>
      (r || []).some((c) => String(c).includes("개요 번호")) && (r || []).some((c) => String(c).includes("할당 대상")),
    );
    if (hidx < 0) hidx = 8;
    const header = rows[hidx] || [];
    const col: Record<string, number> = {};
    header.forEach((h, i) => { if (h != null) col[String(h).trim()] = i; });
    const get = (row: any[], key: string) => { const i = col[key]; return i != null ? row[i] : null; };
    if (col["이름"] == null || col["개요 번호"] == null) {
      return { ...base, error: "'개요 번호'/'이름' 컬럼을 찾지 못했습니다. Planner 내보내기 양식인지 확인하세요." };
    }

    // 데이터 행
    const raw: { outline: string; no: number; row: any[] }[] = [];
    const allOutlines = new Set<string>();
    for (let r = hidx + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row) continue;
      const name = get(row, "이름");
      if (!name || !String(name).trim()) continue;
      const outline = String(get(row, "개요 번호") ?? "").trim();
      if (!outline) continue;
      raw.push({ outline, no: Number(get(row, "작업 번호")), row });
      allOutlines.add(outline);
    }
    // 자식이 있는 outline (마일스톤이라도 자식 있으면 일반 task로 강제)
    const hasChildren = new Set<string>();
    for (const o of allOutlines) {
      for (const x of allOutlines) { if (x !== o && x.startsWith(o + ".")) { hasChildren.add(o); break; } }
    }
    const parentSet = hasChildren;
    const noToOutline = new Map<number, string>();
    for (const { no, outline } of raw) if (!isNaN(no)) noToOutline.set(no, outline);

    const unmatchedNames = new Set<string>();
    const tasks: PlannerParsedTask[] = raw.map(({ outline, row }) => {
      const names = String(get(row, "할당 대상") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      const assigneeIds: string[] = [];
      const assigneeNames: string[] = [];
      const unmatched: string[] = [];
      for (const a of names) {
        const u = matchUser(a, byKey);
        if (u) { assigneeIds.push(u.id); assigneeNames.push(u.name); }
        else { unmatched.push(a); unmatchedNames.add(a); }
      }
      const start = asDate(get(row, "시작"));
      const end = asDate(get(row, "마침"));
      const milestoneRaw = String(get(row, "마일스톤") ?? "").includes("예");
      // 비고·메모 → 작업일지 원문(라벨/접두어 없이). 비어있지 않은 것만, 비고 먼저.
      const workLogs: string[] = [];
      for (const key of ["비고", "내용", "메모"]) {
        const v = String(get(row, key) ?? "").trim();
        if (v) workLogs.push(v);
      }
      return {
        outline,
        parentOutline: outline.includes(".") ? outline.split(".").slice(0, -1).join(".") : null,
        name: String(get(row, "이름")).trim().slice(0, 200),
        sortOrder: Number(outline.split(".").pop()) || 0,
        isMilestone: milestoneRaw && !parentSet.has(outline),
        start, end,
        progress: asPct(get(row, "% 완료")),
        hasSegment: !!(start && end) && !parentSet.has(outline),
        assigneeIds, assigneeNames, unmatched, workLogs,
      };
    });

    // 의존성 (작업번호 → outline)
    const deps: { predOutline: string; succOutline: string; type: string }[] = [];
    for (const { outline, row } of raw) {
      for (const d of parseDeps(get(row, "종속 대상"))) {
        const predOutline = noToOutline.get(d.predNo);
        if (predOutline && predOutline !== outline) deps.push({ predOutline, succOutline: outline, type: d.type });
      }
    }

    return { ...base, tasks, deps, unmatchedNames: [...unmatchedNames] };
  } catch (e: any) {
    return { ...base, error: e?.message ?? "파일 파싱 중 오류가 발생했습니다." };
  }
}

/** 적재용 페이로드 (서버 importPlanner DTO와 일치) */
export function toImportPayload(parsed: PlannerParsed, ownerId: string, folderId?: string) {
  return {
    name: parsed.projectName,
    ownerId,
    ...(folderId ? { folderId } : {}),
    metaProgress: parsed.metaProgress,
    tasks: parsed.tasks.map((t) => ({
      outline: t.outline,
      parentOutline: t.parentOutline,
      name: t.name,
      sortOrder: t.sortOrder,
      isMilestone: t.isMilestone,
      start: t.start,
      end: t.end,
      progress: t.progress,
      hasSegment: t.hasSegment,
      assigneeIds: t.assigneeIds,
      workLogs: t.workLogs,
    })),
    deps: parsed.deps,
  };
}
