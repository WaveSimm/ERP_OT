// 과거(2008~2018) 계약 마이그레이션 파서 — '계약#/건명' 구양식 전용.
//   2019+ 양식(scripts/import-contracts.py)과 별개. 헤더명 기반 매핑이라 열 밀림 허용.
//   계약번호는 '계약#' 컬럼값(08-01, 10-305, #10-124 …)에서 정규화 → #YY-N.
//   Contract 모델에 없는 필드(금액/입금/완료)는 notes에 합쳐 보존.
//   대상 시트: '계약리스트' (없으면 첫 시트).
//
// 사용:
//   node scripts/migrate-legacy-contracts.js <파일|폴더> [..]   → tmp/legacy_parsed.json + tmp/legacy_nums.txt
//   (DB 적재/중복검사는 별도 단계. 이 스크립트는 파싱만 = 안전)
const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");

const norm = (s) => String(s ?? "").replace(/\s+/g, "").trim();

function listFiles(args) {
  const out = [];
  for (const a of args) {
    const st = fs.statSync(a);
    if (st.isDirectory()) {
      for (const f of fs.readdirSync(a)) if (/\.(xlsx|xls)$/i.test(f)) out.push(path.join(a, f));
    } else out.push(a);
  }
  return out;
}

function pickSheet(wb) {
  const named = wb.SheetNames.find((n) => norm(n).includes("계약리스트"));
  return wb.Sheets[named || wb.SheetNames[0]];
}

function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(8, rows.length); i++) {
    const c = (rows[i] || []).map(norm);
    const hasNum = c.some((x) => x.includes("계약#") || x === "계약번호");
    const hasName = c.some((x) => x.includes("건명") || x.includes("품명"));
    if (hasNum && (hasName || c.some((x) => x.includes("거래처")))) return i;
  }
  return -1;
}

function colMap(header) {
  const cells = (header || []).map(norm);
  const m = {};
  cells.forEach((c, i) => {
    if (!c) return;
    if ((c.includes("계약#") || c === "계약번호") && m.num == null) m.num = i;
    else if (c.includes("거래처") && m.client == null) m.client = i;
    else if (c === "담당" && m.clientContact == null) m.clientContact = i;
    else if ((c.includes("계약건명") || c === "건명" || c.includes("품명")) && m.name == null) m.name = i;
    else if (c === "구분" && m.category == null) m.category = i;
    else if (c.includes("계약종류") && m.ctype == null) m.ctype = i;
    else if (c.includes("계약일자") && m.cdate == null) m.cdate = i;
    else if (c === "납기" && m.deadline == null) m.deadline = i;
    else if (c.includes("금액") && m.amount == null) m.amount = i;
    else if (c.includes("입금") && m.payment == null) m.payment = i;
    else if (c === "비고" && m.notes == null) m.notes = i;
    else if (c.includes("완료") && m.done == null) m.done = i;
  });
  return m;
}

// '08-01', '10-305', '#10-124', '#10-124\\5,000' → '#08-1' / '#10-305' / '#10-124'
function normNumber(v) {
  const s = String(v ?? "").trim();
  const mt = s.match(/#?\s*(\d{2})\s*-\s*(\d+)/);
  if (!mt) return null;
  return `#${mt[1]}-${parseInt(mt[2], 10)}`;
}

function asDate(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    const d = new Date(Math.round((v - 25569) * 86400000));
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  // 문자열 날짜는 양식이 제각각('4/28','08/01/09','ThuDec23201000')이라 신뢰 불가 → null
  return null;
}

const cat = (v) => (norm(v).includes("용역") ? "용역" : "물품");
const ctype = (v) => (norm(v).includes("외자") ? "외자" : "내자");

function buildNotes(orig, amount, payment, done) {
  const parts = [];
  if (orig && norm(orig)) parts.push(String(orig).trim());
  const extra = [];
  if (amount && norm(amount)) extra.push(`금액:${String(amount).trim()}`);
  if (payment && norm(payment)) extra.push(`입금:${String(payment).trim()}`);
  if (done && norm(done)) extra.push(`완료:${String(done).trim()}`);
  if (extra.length) parts.push(`[원본] ${extra.join(" / ")}`);
  const s = parts.join(" | ").slice(0, 500);
  return s || null;
}

function parseFile(file) {
  const wb = XLSX.readFile(file, { cellDates: true });
  const ws = pickSheet(wb);
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  const hidx = findHeaderRow(rows);
  if (hidx < 0) return { records: [], invalid: 0, note: "헤더(계약#/건명) 미발견" };
  const m = colMap(rows[hidx]);
  if (m.num == null || m.name == null) return { records: [], invalid: 0, note: "계약#/건명 컬럼 매핑 실패" };

  const records = [];
  const errors = [];
  const seen = new Set();
  let invalid = 0;
  for (let r = hidx + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const cell = (k) => (m[k] != null && m[k] < row.length ? row[m[k]] : null);
    const name = cell("name");
    const rawNum = cell("num");
    if (!(name && norm(name)) && !(rawNum && norm(rawNum))) continue; // 빈 행
    const cnum = normNumber(rawNum);
    if (!cnum || !(name && norm(name))) {
      invalid++;
      errors.push({
        source: path.basename(file),
        row: r + 1, // 엑셀 행번호(1-based)
        계약번호: rawNum == null ? "" : String(rawNum).trim().slice(0, 30),
        건명: name == null ? "" : String(name).trim().slice(0, 40),
        사유: !cnum ? "계약번호 형식불가" : "건명 없음",
        rawRow: row.map((c) => (c == null ? "" : String(c).trim().slice(0, 20))).filter(Boolean).slice(0, 8).join(" | "),
      });
      continue;
    }
    if (seen.has(cnum)) continue; // 파일 내 중복
    seen.add(cnum);

    const s = (v, max) => (v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, max));
    records.push({
      contractNumber: cnum,
      name: String(name).trim().slice(0, 200),
      client: cell("client") ? String(cell("client")).trim().slice(0, 200) : "",
      clientContact: s(cell("clientContact"), 100),
      manufacturer: null,
      category: m.category != null ? cat(cell("category")) : "물품",
      contractType: ctype(cell("ctype")),
      contractDate: asDate(cell("cdate")),
      deadline: asDate(cell("deadline")),
      manager: null,
      notes: buildNotes(cell("notes"), cell("amount"), cell("payment"), cell("done")),
      source: path.basename(file),
    });
  }
  return { records, invalid, errors, note: null };
}

const args = process.argv.slice(2);
if (!args.length) {
  console.error("사용: node scripts/migrate-legacy-contracts.js <파일|폴더> [..]");
  process.exit(1);
}
const files = listFiles(args);
const all = [];
const allErrors = [];
console.log("=== 파일별 파싱 ===");
for (const f of files) {
  try {
    const { records, invalid, errors, note } = parseFile(f);
    console.log(`  ${path.basename(f)} : ${records.length}건${invalid ? ` (오류 ${invalid})` : ""}${note ? ` [${note}]` : ""}` +
      (records.length ? ` 범위 ${records[0].contractNumber}~${records[records.length - 1].contractNumber}` : ""));
    all.push(...records);
    if (errors) allErrors.push(...errors);
  } catch (e) {
    console.log(`  ${path.basename(f)} : 읽기 실패 — ${e.message}`);
  }
}
fs.mkdirSync("tmp", { recursive: true });
fs.writeFileSync("tmp/legacy_parsed.json", JSON.stringify(all, null, 0), "utf8");
fs.writeFileSync("tmp/legacy_nums.txt", [...new Set(all.map((r) => r.contractNumber))].join("\n") + "\n", "utf8");
fs.writeFileSync("tmp/legacy_errors.json", JSON.stringify(allErrors, null, 2), "utf8");
console.log(`\n총 파싱: ${all.length}건 → tmp/legacy_parsed.json`);
if (allErrors.length) {
  console.log(`\n=== 오류(건너뛴) ${allErrors.length}건 ===`);
  for (const e of allErrors) {
    console.log(`  [${e.source} ${e.row}행] 사유:${e.사유} | 계약#:"${e.계약번호}" 건명:"${e.건명}"`);
    console.log(`      원본행: ${e.rawRow}`);
  }
}
