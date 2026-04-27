// notes_extracted.json 의 events를 RepairOrder 필드 + Shipment에 적용
// SAFE ROWS: 0007~0020 (14건)
// SKIP: 0001~0006 (애매)

const fs = require("fs");
const crypto = require("crypto");

const results = JSON.parse(fs.readFileSync("/tmp/notes_extracted.json", "utf8"));
const SKIP = new Set(["SA-2026-0001", "SA-2026-0002", "SA-2026-0003", "SA-2026-0004", "SA-2026-0005", "SA-2026-0006"]);

const updateStmts = [];
const insertStmts = [];

function cuid() {
  return "migevt_" + crypto.randomBytes(10).toString("hex").slice(0, 18);
}

for (const r of results) {
  if (SKIP.has(r.orderNumber)) continue;
  const byField = {};
  for (const e of r.events) {
    // 같은 필드 여러 이벤트면 마지막(더 최근) 우선 OR 첫(더 과거) 우선?
    // 사용자 워크플로우상 "최초 시점" 선호 — 예: 입고(stocked)는 최초 입고일
    // 여기서는 '시간순 정렬 후 첫 발생'을 저장 (events는 최신→과거 순이니 뒤쪽이 과거)
    byField[e.field] = e.date; // 같은 필드 반복 시 최신이 덮어쓰지만 대부분 한 번씩만 등장
  }

  // RepairOrder UPDATE 필드
  const roFields = [];
  if (byField.stockedAt) roFields.push(`"stockedAt" = '${byField.stockedAt}'::timestamp`);
  if (byField.handedToTechAt) roFields.push(`"handedToTechAt" = '${byField.handedToTechAt}'::timestamp`);
  if (byField.quoteReceivedAt) roFields.push(`"quoteReceivedAt" = '${byField.quoteReceivedAt}'::timestamp`);
  if (byField.quoteApprovedAt) roFields.push(`"quoteApprovedAt" = '${byField.quoteApprovedAt}'::timestamp`);
  if (byField.poIssuedAt) roFields.push(`"poIssuedAt" = '${byField.poIssuedAt}'::timestamp`);

  if (roFields.length > 0) {
    updateStmts.push(`UPDATE equipment.repair_orders SET ${roFields.join(", ")}, "updatedAt" = now() WHERE "orderNumber" = '${r.orderNumber}';`);
  }

  // OUTBOUND Shipment 생성 조건: shippedAt 또는 receivedAt 있으면
  const hasOutbound = byField.outboundShippedAt || byField.outboundReceivedAt;
  if (hasOutbound) {
    const status = byField.outboundReceivedAt ? "DELIVERED" : "SHIPPED";
    const shipId = cuid();
    const shippedAt = byField.outboundShippedAt ? `'${byField.outboundShippedAt}'::timestamp` : "NULL";
    const receivedAt = byField.outboundReceivedAt ? `'${byField.outboundReceivedAt}'::timestamp` : "NULL";
    const rma = r.rma ? `'${r.rma.replace(/'/g, "''")}'` : "NULL";
    insertStmts.push(`INSERT INTO equipment.shipments (id, "repairOrderId", direction, status, "rmaNumber", "shippedAt", "receivedAt", "createdAt", "updatedAt") SELECT '${shipId}', id, 'OUTBOUND', '${status}', ${rma}, ${shippedAt}, ${receivedAt}, now(), now() FROM equipment.repair_orders WHERE "orderNumber" = '${r.orderNumber}';`);
  }

  // INBOUND Shipment (본사 도착/입고)
  if (byField.inboundReceivedAt) {
    const shipId = cuid();
    insertStmts.push(`INSERT INTO equipment.shipments (id, "repairOrderId", direction, status, "receivedAt", "createdAt", "updatedAt") SELECT '${shipId}', id, 'INBOUND', 'DELIVERED', '${byField.inboundReceivedAt}'::timestamp, now(), now() FROM equipment.repair_orders WHERE "orderNumber" = '${r.orderNumber}';`);
  }
}

const full = ["BEGIN;", ...updateStmts, ...insertStmts, "COMMIT;"].join("\n");
fs.writeFileSync("/tmp/apply_events.sql", full);
console.log("UPDATE stmts:", updateStmts.length);
console.log("INSERT stmts:", insertStmts.length);
console.log("Written: /tmp/apply_events.sql");
