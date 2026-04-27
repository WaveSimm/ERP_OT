// 고객 담당자 Option A: EXACT/SUBSTR은 기존 ID 사용, NONE 174건은 자동 신규 생성
// 노이즈 필터: 빈 이름, 전화번호 형식, 순수 숫자 제외
//
// 실행: web 컨테이너 (xlsx 접근) + postgres 직접 SQL

const xlsx = require("xlsx");
const fs = require("fs");
const { execSync } = require("child_process");

const MATCHING_FILE = "/tmp/matching_reviewed.xlsx";
const CUSTOMER_MAP_FILE = "/tmp/final_customer_map.json";

const wb = xlsx.readFile(MATCHING_FILE);
const sh = wb.Sheets["고객담당자_매칭"];
const d = xlsx.utils.sheet_to_json(sh, { header: 1, raw: false, defval: "" });

const customerMap = JSON.parse(fs.readFileSync(CUSTOMER_MAP_FILE, "utf8"));

function isNoise(name) {
  if (!name || !name.trim()) return true;
  const s = name.trim();
  if (/^[\d\-\s\(\)]+$/.test(s)) return true; // 전화번호·숫자만
  if (s.length < 2) return true;
  return false;
}

const finalMap = {}; // "org|person" → { id, kind }
const toCreate = []; // [{ org, person, customerId }]
const stats = { EXACT: 0, SUBSTR: 0, NEW: 0, NOISE: 0, NO_CUSTOMER: 0 };

for (let i = 1; i < d.length; i++) {
  const org = String(d[i][0] || "").trim();
  const person = String(d[i][1] || "").trim();
  const status = d[i][3];
  const cand1id = d[i][5];
  const key = `${org}|${person}`;
  if (!org || !person) continue;

  if ((status === "EXACT" || status === "SUBSTR") && cand1id) {
    finalMap[key] = { id: cand1id, kind: status };
    stats[status]++;
    continue;
  }

  // NONE → 신규 생성 대상
  if (isNoise(person)) {
    finalMap[key] = { id: null, kind: "NOISE", note: "phone number or invalid name" };
    stats.NOISE++;
    continue;
  }
  const custEntry = customerMap[org];
  if (!custEntry || !custEntry.id) {
    finalMap[key] = { id: null, kind: "NO_CUSTOMER", note: "customer not resolved: " + org };
    stats.NO_CUSTOMER++;
    continue;
  }
  toCreate.push({ org, person, customerId: custEntry.id });
}

console.log("Classification:", JSON.stringify(stats));
console.log("To create:", toCreate.length);

// SQL 생성
const now = new Date().toISOString();
const valuesList = toCreate.map((c, idx) => {
  const id = `migcc_${Buffer.from(Math.random().toString() + idx).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20)}`;
  c.newId = id;
  return `('${id}', '${c.customerId}', $$${c.person.replace(/'/g, "''")}$$, NULL, NULL, NULL, NULL, false, NULL, now(), now())`;
}).join(",\n");

const sql = `
INSERT INTO equipment.customer_contacts (id, "customerId", name, department, position, phone, email, "isPrimary", notes, "createdAt", "updatedAt")
VALUES
${valuesList}
ON CONFLICT DO NOTHING
RETURNING id, name;
`;

fs.writeFileSync("/tmp/create_contacts.sql", sql);
fs.writeFileSync("/tmp/contact_to_create.json", JSON.stringify(toCreate, null, 2));

// 최종 맵 1차 (NEW는 SQL 실행 후 업데이트)
for (const c of toCreate) {
  finalMap[`${c.org}|${c.person}`] = { id: c.newId, kind: "NEW", customerId: c.customerId };
}
fs.writeFileSync("/tmp/final_contact_map.json", JSON.stringify(finalMap, null, 2));

console.log("SQL written to /tmp/create_contacts.sql");
console.log("Sample NEW entries (first 5):");
toCreate.slice(0, 5).forEach(c => console.log("  " + c.org + " / " + c.person + " → id=" + c.newId));
