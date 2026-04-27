// 수리 현황표 엑셀에서 기관·고객담당자·내부담당자 추출 후 ERP와 매칭한 검토용 엑셀 생성.
// 사용자가 채울 수 있는 "최종 결정" 열 포함.
//
// 사용:
//   node build-matching-workbook.js <input.xlsx> <erp_entities.txt> <output.xlsx>
//
// 기본:
//   /tmp/repair_status.xlsx, /tmp/erp_entities.txt, /tmp/matching_workbook.xlsx

const xlsx = require("xlsx");
const fs = require("fs");

const INPUT = process.argv[2] || "/tmp/repair_status.xlsx";
const ERP = process.argv[3] || "/tmp/erp_entities.txt";
const OUTPUT = process.argv[4] || "/tmp/matching_workbook.xlsx";

// ERP 데이터 로드
const erpCustomers = []; // { id, name, nameNorm }
const erpContacts = []; // { id, customerName, name, nameNorm }
const erpUsers = []; // { id, name, nameNorm }

function norm(s) {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, "");
}

const lines = fs.readFileSync(ERP, "utf8").split("\n").filter((l) => l);
for (const l of lines) {
  const parts = l.split("|");
  if (parts[0] === "CUST") erpCustomers.push({ id: parts[1], name: parts[2], nameNorm: norm(parts[2]) });
  else if (parts[0] === "CONT") erpContacts.push({ id: parts[1], customerName: parts[2], name: parts[3], nameNorm: norm(parts[3]) });
  else if (parts[0] === "USER") erpUsers.push({ id: parts[1], name: parts[2], nameNorm: norm(parts[2]) });
}
console.log("ERP:", erpCustomers.length, "고객사 /", erpContacts.length, "담당자 /", erpUsers.length, "유저");

// 간단 fuzzy: Levenshtein 거리 (문자열 짧아서 OK)
function lev(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp = Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, prev + 1, dp[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
    dp[0] = i;
  }
  return dp[b.length];
}

// 후보 검색: exact > substring > fuzzy(d<=1 for short, d<=2 for long)
function findCandidates(excelName, pool, { limit = 3, contextFilter = null } = {}) {
  const q = norm(excelName);
  if (!q) return [];
  let candidates = pool;
  if (contextFilter) candidates = candidates.filter(contextFilter);

  const exact = candidates.filter((c) => c.nameNorm === q);
  if (exact.length) return exact.slice(0, limit).map((c) => ({ ...c, match: "EXACT" }));

  const substr = candidates.filter((c) => c.nameNorm.includes(q) || q.includes(c.nameNorm));
  if (substr.length) return substr.slice(0, limit).map((c) => ({ ...c, match: "SUBSTR" }));

  const maxDist = q.length <= 5 ? 1 : 2;
  const fuzzy = candidates
    .map((c) => ({ ...c, dist: lev(q, c.nameNorm) }))
    .filter((c) => c.dist <= maxDist)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, limit)
    .map((c) => ({ ...c, match: "FUZZY(d=" + c.dist + ")" }));
  return fuzzy;
}

// 엑셀에서 기관·담당자 추출
function extractNames(wb) {
  const customers = new Map(); // name → { count, sheets }
  const contacts = new Map(); // "org|name" → { org, name, count }
  const users = new Map(); // name → { count, roles }

  function bumpMap(map, key, meta = {}) {
    const e = map.get(key) || { count: 0, ...meta };
    e.count++;
    for (const k of Object.keys(meta)) {
      e[k] = e[k] || meta[k];
    }
    map.set(key, e);
  }

  const sheets = [
    { name: "수리완료", dataStart: 3, cols: { org: 3, custContact: 4, repairer: 9, shipper: null }, maxCol: 25 },
    { name: "수리 현황", dataStart: 6, cols: { org: 3, custContact: 4, repairer: 9, shipper: 10 }, maxCol: 16 },
  ];

  for (const s of sheets) {
    const sh = wb.Sheets[s.name];
    if (!sh) continue;
    const range = xlsx.utils.decode_range(sh["!ref"]);
    range.e.c = Math.min(range.e.c, s.maxCol);
    sh["!ref"] = xlsx.utils.encode_range(range);
    const d = xlsx.utils.sheet_to_json(sh, { header: 1, raw: false, defval: "" });

    for (let i = s.dataStart; i < d.length; i++) {
      const row = d[i];
      if (!row || !row.some((c) => String(c || "").trim())) continue;
      const org = String(row[s.cols.org] || "").trim();
      const cust = String(row[s.cols.custContact] || "").trim();
      const rep = String(row[s.cols.repairer] || "").trim();
      const shp = s.cols.shipper != null ? String(row[s.cols.shipper] || "").trim() : "";

      if (org && org !== "-" && org.toLowerCase() !== "n/a") bumpMap(customers, org, { sheet: s.name });
      if (cust && cust !== "-" && cust.toLowerCase() !== "n/a" && org) {
        bumpMap(contacts, `${org}|${cust}`, { org, name: cust, sheet: s.name });
      }
      if (rep && rep !== "-" && rep.toLowerCase() !== "n/a") bumpMap(users, rep, { roles: new Set(["수리진행"]) });
      if (shp && shp !== "-" && shp.toLowerCase() !== "n/a") {
        const e = users.get(shp) || { count: 0, roles: new Set() };
        e.count++;
        e.roles = e.roles || new Set();
        e.roles.add("운송발주");
        users.set(shp, e);
      }
      // 수리진행자가 있는 경우 수리진행 역할 명시
      if (rep && users.has(rep)) {
        const e = users.get(rep);
        e.roles = e.roles || new Set();
        e.roles.add("수리진행");
      }
    }
  }

  return { customers, contacts, users };
}

const wb = xlsx.readFile(INPUT);
const { customers, contacts, users } = extractNames(wb);
console.log("엑셀 추출: 기관", customers.size, "/ 고객담당자", contacts.size, "/ 내부담당자", users.size);

// 매칭 결과 생성
const outWb = xlsx.utils.book_new();

// 시트 1: 기관 매칭
const custRows = [["엑셀 기관명", "엑셀 등장 건수", "매칭 상태", "ERP 후보 1 (이름)", "ERP 후보 1 (ID)", "ERP 후보 2 (이름)", "ERP 후보 2 (ID)", "ERP 후보 3 (이름)", "ERP 후보 3 (ID)", "최종 결정 (ERP ID 또는 NEW)", "비고"]];
const sortedCust = Array.from(customers.entries()).sort((a, b) => b[1].count - a[1].count);
for (const [name, meta] of sortedCust) {
  const cands = findCandidates(name, erpCustomers);
  const row = [name, meta.count, cands[0]?.match || "NONE"];
  for (let k = 0; k < 3; k++) {
    row.push(cands[k]?.name || "", cands[k]?.id || "");
  }
  row.push("", ""); // 최종 결정, 비고
  custRows.push(row);
}
const sh1 = xlsx.utils.aoa_to_sheet(custRows);
sh1["!cols"] = [{ wch: 28 }, { wch: 8 }, { wch: 12 }, { wch: 26 }, { wch: 30 }, { wch: 26 }, { wch: 30 }, { wch: 26 }, { wch: 30 }, { wch: 28 }, { wch: 20 }];
xlsx.utils.book_append_sheet(outWb, sh1, "기관_매칭");

// 시트 2: 고객 담당자 매칭 (같은 기관 범위 내에서만 후보 검색)
const contRows = [["엑셀 기관명", "엑셀 담당자명", "엑셀 등장 건수", "매칭 상태", "ERP 후보 1 (담당자)", "ERP 후보 1 (ID)", "ERP 후보 2 (담당자)", "ERP 후보 2 (ID)", "최종 결정 (ERP ID 또는 NEW)", "비고"]];
const sortedCont = Array.from(contacts.entries()).sort((a, b) => {
  if (a[1].org !== b[1].org) return a[1].org.localeCompare(b[1].org);
  return b[1].count - a[1].count;
});
for (const [key, meta] of sortedCont) {
  const cands = findCandidates(meta.name, erpContacts, { limit: 2, contextFilter: (c) => norm(c.customerName) === norm(meta.org) });
  const row = [meta.org, meta.name, meta.count, cands[0]?.match || "NONE"];
  for (let k = 0; k < 2; k++) {
    row.push(cands[k]?.name || "", cands[k]?.id || "");
  }
  row.push("", "");
  contRows.push(row);
}
const sh2 = xlsx.utils.aoa_to_sheet(contRows);
sh2["!cols"] = [{ wch: 28 }, { wch: 20 }, { wch: 8 }, { wch: 12 }, { wch: 20 }, { wch: 30 }, { wch: 20 }, { wch: 30 }, { wch: 28 }, { wch: 20 }];
xlsx.utils.book_append_sheet(outWb, sh2, "고객담당자_매칭");

// 시트 3: 내부 담당자 매칭
const userRows = [["엑셀 담당자명", "역할", "엑셀 등장 건수", "매칭 상태", "ERP User 후보 1 (이름)", "ERP User 후보 1 (ID)", "ERP User 후보 2 (이름)", "ERP User 후보 2 (ID)", "최종 결정 (ERP ID 또는 NEW/IGNORE)", "비고"]];
const sortedUsers = Array.from(users.entries()).sort((a, b) => b[1].count - a[1].count);
for (const [name, meta] of sortedUsers) {
  const cands = findCandidates(name, erpUsers, { limit: 2 });
  const row = [name, Array.from(meta.roles || []).join(", "), meta.count, cands[0]?.match || "NONE"];
  for (let k = 0; k < 2; k++) {
    row.push(cands[k]?.name || "", cands[k]?.id || "");
  }
  row.push("", "");
  userRows.push(row);
}
const sh3 = xlsx.utils.aoa_to_sheet(userRows);
sh3["!cols"] = [{ wch: 20 }, { wch: 20 }, { wch: 8 }, { wch: 12 }, { wch: 16 }, { wch: 30 }, { wch: 16 }, { wch: 30 }, { wch: 28 }, { wch: 20 }];
xlsx.utils.book_append_sheet(outWb, sh3, "내부담당자_매칭");

xlsx.writeFile(outWb, OUTPUT);

// 매칭 통계
function matchStats(list) {
  const s = { EXACT: 0, SUBSTR: 0, FUZZY: 0, NONE: 0 };
  for (const row of list.slice(1)) {
    const m = row[3] || "NONE";
    if (m.startsWith("FUZZY")) s.FUZZY++;
    else s[m] = (s[m] || 0) + 1;
  }
  return s;
}
console.log("기관 매칭:", JSON.stringify(matchStats(custRows)));
console.log("고객담당자 매칭:", JSON.stringify(matchStats(contRows)));
console.log("내부담당자 매칭:", JSON.stringify(matchStats(userRows)));
console.log("Written:", OUTPUT);
