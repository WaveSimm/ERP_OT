// MS Teams Planner 엑셀 → 프로젝트 시스템 적재 플랜 빌더 (파싱/매칭/검증).
//   기본 = DRY-RUN(플랜 JSON + 요약 출력, DB 무변경).
//   사용: node scripts/planner-import.js <xlsx> <users.tsv>
//   users.tsv: "id\tname" (활성 사용자)
const XLSX = require("xlsx");
const fs = require("fs");

const xlsxPath = process.argv[2];
const usersPath = process.argv[3] || "tmp/users.tsv";

// ── 사용자 맵: 공백제거 이름 → {id,name}
const usersByKey = new Map();
for (const line of fs.readFileSync(usersPath, "utf8").split("\n")) {
  if (!line.trim()) continue;
  const [id, name] = line.split("\t");
  if (id && name) usersByKey.set(name.replace(/\s+/g, ""), { id, name });
}

const strip = (s) => String(s ?? "").replace(/\s+/g, "").trim();
// Planner "윤송 심"(이름 성) → "심윤송"(성 이름). 공백 기준 뒤집기 후 매칭. 직접도 시도.
function matchUser(plannerName) {
  const reversed = String(plannerName).trim().split(/\s+/).reverse().join("");
  if (usersByKey.has(reversed)) return usersByKey.get(reversed);
  const direct = strip(plannerName);
  if (usersByKey.has(direct)) return usersByKey.get(direct);
  return null;
}

const wb = XLSX.readFile(xlsxPath, { cellDates: false });
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: null });

// 메타
const meta = {};
for (let i = 0; i < 8; i++) {
  const k = rows[i] && rows[i][0];
  const v = rows[i] && rows[i][1];
  if (k) meta[String(k).trim()] = v == null ? null : String(v).trim();
}

// 헤더행
let hidx = rows.findIndex((r) => (r || []).some((c) => String(c).includes("개요 번호")) && (r || []).some((c) => String(c).includes("할당 대상")));
if (hidx < 0) hidx = 8;
const H = rows[hidx];
const col = {};
H.forEach((h, i) => { if (h != null) col[String(h).trim()] = i; });
const get = (row, k) => { const i = col[k]; return i != null ? row[i] : null; };

const parseDate = (v) => { const m = String(v ?? "").match(/(\d{4})-(\d{2})-(\d{2})/); return m ? m[0] : null; };
const parsePct = (v) => { const m = String(v ?? "").match(/(\d+)\s*%/); return m ? Number(m[1]) : null; };
const parseDeps = (v) => { const out = []; const re = /(\d+)\s*(FS|SS|FF|SF)/gi; let m; while ((m = re.exec(String(v ?? "")))) out.push({ predNo: Number(m[1]), type: m[2].toUpperCase() }); return out; };

const tasks = [];
const noToOutline = new Map();
const unmatchedOcc = []; // {outline, name}
for (let r = hidx + 1; r < rows.length; r++) {
  const row = rows[r]; if (!row) continue;
  const name = get(row, "이름"); if (!name || !String(name).trim()) continue;
  const outline = String(get(row, "개요 번호") ?? "").trim();
  const no = Number(get(row, "작업 번호"));
  if (!outline) continue;
  noToOutline.set(no, outline);

  const rawAsg = String(get(row, "할당 대상") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const matched = [], unmatched = [];
  for (const a of rawAsg) {
    const u = matchUser(a);
    if (u) matched.push(u); else { unmatched.push(a); unmatchedOcc.push({ outline, name: String(name).trim(), planner: a }); }
  }
  const start = parseDate(get(row, "시작"));
  const end = parseDate(get(row, "마침"));
  const seg = (parseInt(outline) && outline.includes(".")) ? (start && end) : (start && end); // 날짜 있으면 세그먼트
  tasks.push({
    no, outline, name: String(name).trim(),
    parentOutline: outline.includes(".") ? outline.split(".").slice(0, -1).join(".") : null,
    sortOrder: Number(outline.split(".").pop()),
    isMilestone: String(get(row, "마일스톤") ?? "").includes("예"),
    start, end, hasSegment: !!(start && end),
    progress: parsePct(get(row, "% 완료")) ?? 0,
    assignees: matched, unmatched,
    deps: parseDeps(get(row, "종속 대상")),
  });
}

// 의존성 정규화 (predNo → outline)
const deps = [];
for (const t of tasks) {
  for (const d of t.deps) {
    const predOutline = noToOutline.get(d.predNo);
    if (predOutline) deps.push({ predOutline, succOutline: t.outline, type: d.type });
  }
}

// ── 출력
console.log("=== 프로젝트 메타 ===");
console.log("  이름:", meta["프로젝트 이름"], "| 소유자:", meta["플랜 소유자"], "→", (matchUser(meta["플랜 소유자"]) || {}).name || "❌");
console.log("  기간:", meta["프로젝트 시작 날짜"], "~", meta["프로젝트 완료 날짜"], "| %완료:", meta["% 완료"]);
console.log("\n=== WBS 트리 (개요 | 이름 | 담당[✓매칭/✗미매칭] | 일정 | 진척 | 의존) ===");
for (const t of tasks) {
  const depth = (t.outline.match(/\./g) || []).length;
  const asg = [...t.assignees.map((u) => "✓" + u.name), ...t.unmatched.map((u) => "✗" + u)].join(",");
  const sched = t.hasSegment ? `${t.start}~${t.end}` : "(일정없음)";
  const dep = t.deps.length ? " ⟸" + t.deps.map((d) => noToOutline.get(d.predNo) + d.type).join(",") : "";
  console.log("  ".repeat(depth) + `${t.outline} ${t.name.slice(0, 26)}` + (asg ? ` 【${asg}】` : "") + ` ${sched} ${t.progress}%` + dep + (t.isMilestone ? " ◆" : ""));
}

const leafWithSeg = tasks.filter((t) => t.hasSegment).length;
const totalAssign = tasks.reduce((s, t) => s + t.assignees.length, 0);
console.log("\n=== 요약 ===");
console.log("  총 태스크:", tasks.length, "| 세그먼트(일정有):", leafWithSeg, "| 일정無(빈 TODO):", tasks.length - leafWithSeg);
console.log("  담당자 배정(매칭됨):", totalAssign, "건 | 의존성:", deps.length, "건");
console.log("  ❌ 미매칭 배정:", unmatchedOcc.length, "건 →", [...new Set(unmatchedOcc.map((u) => u.planner))].join(", "), "(미배정 처리)");
unmatchedOcc.forEach((u) => console.log(`      - ${u.outline} ${u.name} : "${u.planner}"`));

fs.writeFileSync("tmp/planner_plan.json", JSON.stringify({ meta, tasks, deps }, null, 0), "utf8");
console.log("\n→ tmp/planner_plan.json 저장 (DB 무변경)");
