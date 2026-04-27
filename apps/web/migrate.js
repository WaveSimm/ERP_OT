// 수리현황 시트(20건) → RepairOrder 일괄 이관
// AS 번호: SA-2026-0001~0020
// receivedAt: 2026-01-01 (placeholder)
// status: RECEIVED
// 기관 매핑: 인하대학교→인하대, 오션재고→오션테크, 오션테크(데모)→오션테크
// 담당자 매핑: 홍→홍다운 (이전 IGNORE 결정 override)
//
// 실행: web 컨테이너 (xlsx 필요) → SQL 생성 → psql 실행은 외부에서

const xlsx = require("xlsx");
const fs = require("fs");

const customerMap = JSON.parse(fs.readFileSync("/tmp/final_customer_map.json", "utf8"));
const userMap = JSON.parse(fs.readFileSync("/tmp/final_user_map.json", "utf8"));

// 기관 override
const CUST_OVERRIDE = {
  "인하대학교": "인하대",
  "오션재고": "오션테크",
  "오션테크(데모)": "오션테크",
};
// 담당자 override
const USER_OVERRIDE = {
  "홍": "홍다운",
};

function customerIdFor(org) {
  let o = org;
  if (CUST_OVERRIDE[o]) o = CUST_OVERRIDE[o];
  // customer_map 값은 {id, targetName, kind} 또는 {id: null}
  const entry = customerMap[o];
  if (entry && entry.id) return entry.id;
  // CUST_OVERRIDE로 바뀐 이름이 customerMap에 없을 수도 있음 — 역 탐색
  for (const [excel, e] of Object.entries(customerMap)) {
    if (e.targetName === o && e.id) return e.id;
  }
  return null;
}

function userIdFor(name) {
  let n = name;
  if (USER_OVERRIDE[n]) n = USER_OVERRIDE[n];
  const entry = userMap[n];
  if (entry && entry.id) return entry.id;
  // 매핑 없으면 원본 이름으로 찾기 (other SUBSTR 등)
  for (const [excel, e] of Object.entries(userMap)) {
    if (e.targetName === n && e.id) return e.id;
  }
  return null;
}

const wb = xlsx.readFile("/tmp/repair_status.xlsx");
const sh = wb.Sheets["수리 현황"];
const range = xlsx.utils.decode_range(sh["!ref"]); range.e.c = Math.min(range.e.c, 16); sh["!ref"] = xlsx.utils.encode_range(range);
const d = xlsx.utils.sheet_to_json(sh, { header: 1, raw: false, defval: "" });

const rows = [];
let missingReport = [];
for (let i = 6; i < d.length; i++) {
  const r = d[i];
  if (!r || !r.some((c) => String(c || "").trim())) continue;
  const org = String(r[3] || "").trim();
  const custPerson = String(r[4] || "").trim();
  const maker = String(r[5] || "").trim();
  const name = String(r[6] || "").trim();
  const sn = String(r[7] || "").trim();
  const symptom = String(r[8] || "").trim();
  const repairer = String(r[9] || "").trim();
  const shipper = String(r[10] || "").trim();
  const rma = String(r[11] || "").trim();
  const loc = String(r[12] || "").trim();
  const notes = String(r[13] || "").trim();
  const inv = String(r[1] || "").trim();

  const customerId = customerIdFor(org);
  const assigneeId = repairer ? userIdFor(repairer) : null;
  const assigneeName = repairer ? (USER_OVERRIDE[repairer] || repairer) : null;
  const shippingAssigneeName = shipper ? (USER_OVERRIDE[shipper] || shipper) : null;

  if (org && !customerId) missingReport.push({ type: "customer", org });
  if (repairer && !assigneeId) missingReport.push({ type: "user", name: repairer });

  rows.push({
    idx: rows.length + 1,
    orderNumber: `SA-2026-${String(rows.length + 1).padStart(4, "0")}`,
    status: "RECEIVED",
    customerId,
    customerContactName: custPerson && custPerson !== "-" ? custPerson : null,
    productMaker: maker || null,
    productName: name || null,
    productSerial: sn && sn !== "-" ? sn : null,
    otInventoryNo: inv && inv !== "-" ? inv : null,
    symptom: symptom && symptom !== "-" ? symptom : null,
    assigneeId,
    assigneeName,
    shippingAssigneeName,
    mfgReferenceNo: rma || null,
    currentLocation: loc || null,
    notes: notes || null,
    receivedAt: "2026-01-01",
  });
}

if (missingReport.length > 0) {
  console.log("WARNING: missing mappings:", JSON.stringify(missingReport, null, 2));
}

// SQL 생성
function sqlStr(v) {
  if (v === null || v === undefined) return "NULL";
  return `$$${String(v).replace(/\$/g, "$$$$")}$$`;
}

function makeId() {
  const crypto = require("crypto");
  return "migsa_" + crypto.randomBytes(12).toString("hex").slice(0, 20);
}

const insertRows = rows.map((r) => {
  const id = makeId();
  r.dbId = id;
  return `(${[
    sqlStr(id),
    sqlStr(r.orderNumber),
    "'REPAIR'",
    `'${r.status}'`,
    "'NORMAL'",
    sqlStr(r.customerId),
    sqlStr(r.customerContactName),
    sqlStr(r.productMaker),
    sqlStr(r.productName),
    sqlStr(r.productSerial),
    sqlStr(r.otInventoryNo),
    sqlStr(r.symptom),
    sqlStr(r.assigneeId),
    sqlStr(r.assigneeName),
    sqlStr(r.shippingAssigneeName),
    sqlStr(r.mfgReferenceNo),
    sqlStr(r.currentLocation),
    sqlStr(r.notes),
    `'${r.receivedAt}'::timestamp`,
    "now()",
    "now()",
  ].join(", ")})`;
}).join(",\n");

const sql = `
INSERT INTO equipment.repair_orders (
  id, "orderNumber", "orderType", status, priority,
  "customerId", "customerContactName",
  "productName", "productMaker", "productSerial",
  "otInventoryNo", symptom,
  "assigneeId", "assigneeName", "shippingAssigneeName",
  "mfgReferenceNo", "currentLocation", notes,
  "receivedAt", "createdAt", "updatedAt"
) VALUES
${insertRows};
`;

// productName/productMaker 순서 주의 — 스키마 순서와 다름. 고치자.
// 스키마 순서: productName, productMaker, productSerial (확인 필요)
fs.writeFileSync("/tmp/migrate_active_repairs.sql", sql);
fs.writeFileSync("/tmp/migrate_active_repairs_rows.json", JSON.stringify(rows, null, 2));
console.log("Generated", rows.length, "rows");
console.log("SQL: /tmp/migrate_active_repairs.sql");
console.log("Preview first row:", JSON.stringify(rows[0], null, 2));
