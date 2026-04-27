// 수리 현황표 엑셀에 "연도" 컬럼 추가. 순차성 가정 없이 여러 단서로 연도 추정.
// 단서 우선순위: SN 매핑(ERP 기존 AS) > 계약번호(YY-XXX) > 비고(YY/MM/DD or YYYY)
// 입력:
//   /app/add-year.js <input.xlsx> <output.xlsx> <sn_year_map.txt>
// 또는 기본: /tmp/repair_status.xlsx → /tmp/repair_status_with_year.xlsx, /tmp/sn_year_map.txt

const xlsx = require("xlsx");
const fs = require("fs");

const INPUT = process.argv[2] || "/tmp/repair_status.xlsx";
const OUTPUT = process.argv[3] || "/tmp/repair_status_with_year.xlsx";
const SN_MAP_FILE = process.argv[4] || "/tmp/sn_year_map.txt";
const INV_MAP_FILE = process.argv[5] || "/tmp/inv_year_map.txt";

function loadMap(file) {
  const m = new Map();
  if (!fs.existsSync(file)) return m;
  fs.readFileSync(file, "utf8").split("\n").forEach((line) => {
    const [k, y] = line.split("|");
    if (k && y) m.set(k.trim().toLowerCase(), +y);
  });
  return m;
}

const snMap = loadMap(SN_MAP_FILE);
const invMap = loadMap(INV_MAP_FILE);
console.log("SN map:", snMap.size, "| Inventory map:", invMap.size);

// SN 정규화: 영문·숫자만 남기고 lowercase (공백/하이픈/언더스코어/괄호 등 제거)
function normalizeSN(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function yearFromSN(sn) {
  const n = normalizeSN(sn);
  if (n.length < 4 || n === "na") return null;
  return snMap.get(n) || null;
}

function yearFromInventory(inv) {
  const n = normalizeSN(inv);
  if (n.length < 2 || n === "na") return null;
  return invMap.get(n) || null;
}

function yearFromContract(s) {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{2})[-\/]/);
  if (m) {
    const y = +m[1];
    return y >= 70 ? 1900 + y : 2000 + y;
  }
  return null;
}

function yearFromNotes(s) {
  if (!s) return null;
  s = String(s);
  // YY/MM/DD 우선 (명시적 연도)
  let m = s.match(/(\d{2})\/\d{1,2}\/\d{1,2}/);
  if (m) {
    const y = +m[1];
    return y >= 70 ? 1900 + y : 2000 + y;
  }
  // 4자리 연도: 2010~2030 범위만 (전화번호·SN·기타 숫자 노이즈 배제)
  m = s.match(/20[12][0-9]/);
  if (m) return +m[0];
  return null;
}

// 이상치 필터: 2015~2026 범위 밖은 무효 처리
function validateYear(y) {
  if (!y) return null;
  if (y < 2015 || y > 2026) return null;
  return y;
}

function processSheet(wb, sheetName, cfg) {
  const sh = wb.Sheets[sheetName];
  const range = xlsx.utils.decode_range(sh["!ref"]);
  range.e.c = Math.min(range.e.c, cfg.maxCol);
  sh["!ref"] = xlsx.utils.encode_range(range);
  const data = xlsx.utils.sheet_to_json(sh, { header: 1, raw: false, defval: "" });

  const stats = { sn: 0, inv: 0, contract: 0, notes: 0, propagated: 0, none: 0 };
  const years = new Array(data.length).fill(null);
  const sourceSN = new Array(data.length).fill(null);
  const sourceInv = new Array(data.length).fill(null);

  // 1차 패스: 직접 단서로 연도 결정
  for (let i = cfg.dataStartRow; i < data.length; i++) {
    const row = data[i];
    if (!row || !row.some((c) => String(c || "").trim())) continue;

    const sn = row[cfg.snCol];
    const inv = row[cfg.invCol];
    const contract = row[cfg.contractCol];
    const notes = row[cfg.notesCol];

    sourceSN[i] = normalizeSN(sn);
    sourceInv[i] = normalizeSN(inv);

    let y = validateYear(yearFromSN(sn));
    if (y) { stats.sn++; }
    else {
      y = validateYear(yearFromInventory(inv));
      if (y) stats.inv++;
    }
    if (!y) {
      y = validateYear(yearFromContract(contract));
      if (y) stats.contract++;
    }
    if (!y) {
      y = validateYear(yearFromNotes(notes));
      if (y) stats.notes++;
    }
    years[i] = y;
  }

  // 2차 패스: 엑셀 내 동일 SN 또는 동일 재고번호 행끼리 연도 전파 (둘 중 최대 연도 공유)
  const groupYear = new Map(); // key → year
  for (let i = cfg.dataStartRow; i < data.length; i++) {
    if (years[i] == null) continue;
    for (const key of [sourceSN[i], sourceInv[i]]) {
      if (!key || key.length < 3) continue;
      const prev = groupYear.get(key);
      if (prev == null || years[i] > prev) groupYear.set(key, years[i]);
    }
  }
  for (let i = cfg.dataStartRow; i < data.length; i++) {
    if (years[i] != null) continue;
    const row = data[i];
    if (!row || !row.some((c) => String(c || "").trim())) continue;
    for (const key of [sourceSN[i], sourceInv[i]]) {
      if (!key || key.length < 3) continue;
      const y = groupYear.get(key);
      if (y) { years[i] = y; stats.propagated++; break; }
    }
    if (years[i] == null) stats.none++;
  }

  // 행마다 연도 컬럼 삽입 (splice at insertAt, 왼쪽의 비고 왼쪽 위치)
  for (let i = 0; i < data.length; i++) {
    const row = data[i] || [];
    if (row.length > cfg.maxCol + 1) row.length = cfg.maxCol + 1;
    while (row.length < cfg.insertAt) row.push("");
    const val = i >= cfg.dataStartRow && years[i] != null ? years[i] : "";
    row.splice(cfg.insertAt, 0, val);
    data[i] = row;
  }

  // 헤더 "연도" 라벨 (splice 이후)
  if (data[cfg.headerRows[0]]) {
    while (data[cfg.headerRows[0]].length <= cfg.insertAt) data[cfg.headerRows[0]].push("");
    data[cfg.headerRows[0]][cfg.insertAt] = "연도";
  }

  wb.Sheets[sheetName] = xlsx.utils.aoa_to_sheet(data);

  const yearCounts = {};
  for (let i = cfg.dataStartRow; i < data.length; i++) {
    const y = data[i][cfg.insertAt];
    if (y) yearCounts[y] = (yearCounts[y] || 0) + 1;
  }

  return { stats, yearCounts };
}

const wb = xlsx.readFile(INPUT);

// 수리완료: SN=col 7, 재고번호=col 1, 계약번호=col 2, 비고=col 13 (원본 기준)
const r1 = processSheet(wb, "수리완료", {
  dataStartRow: 3,
  headerRows: [1, 2],
  insertAt: 13,
  maxCol: 25,
  snCol: 7,
  invCol: 1,
  contractCol: 2,
  notesCol: 13,
});
console.log("수리완료:", JSON.stringify(r1));

// 수리 현황
const r2 = processSheet(wb, "수리 현황", {
  dataStartRow: 6,
  headerRows: [4, 5],
  insertAt: 13,
  maxCol: 16,
  snCol: 7,
  invCol: 1,
  contractCol: 2,
  notesCol: 13,
});
console.log("수리 현황:", JSON.stringify(r2));

xlsx.writeFile(wb, OUTPUT);
console.log("Written:", OUTPUT);
