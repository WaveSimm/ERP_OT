// 엑셀 기관명 → ERP Customer ID 최종 매핑 생성
// 입력:
//   /tmp/customer_mapping.json (엑셀 결정 분류)
//   /tmp/created_customers.json (신규 생성 결과)
//   /tmp/erp_entities.txt (기존 ERP 고객사)
// 출력:
//   /tmp/final_customer_map.json (Excel name → Customer ID)

const fs = require("fs");

const mapping = JSON.parse(fs.readFileSync("/tmp/customer_mapping.json", "utf8"));
const created = JSON.parse(fs.readFileSync("/tmp/created_customers.json", "utf8"));
const entities = fs.readFileSync("/tmp/erp_entities.txt", "utf8").split("\n");

// 이름 → ID 룩업
const nameToId = new Map();
for (const line of entities) {
  const [t, id, name] = line.split("|");
  if (t === "CUST") nameToId.set(name, id);
}
for (const c of created) {
  nameToId.set(c.name, c.id);
}

// 최종 맵
const finalMap = {}; // Excel name → { id, targetName, kind }
const stats = { resolved: 0, notResolved: 0, empty: 0 };
for (const m of mapping) {
  if (m.kind === "EMPTY") {
    finalMap[m.excel] = { id: null, kind: "EMPTY" };
    stats.empty++;
  } else if (m.kind === "ID") {
    finalMap[m.excel] = { id: m.erpId, kind: "ID" };
    stats.resolved++;
  } else if (m.kind === "EXISTS") {
    finalMap[m.excel] = { id: m.erpId, targetName: m.targetName, kind: "EXISTS" };
    stats.resolved++;
  } else if (m.kind === "NEW") {
    const id = nameToId.get(m.targetName);
    if (id) {
      finalMap[m.excel] = { id, targetName: m.targetName, kind: "NEW" };
      stats.resolved++;
    } else {
      finalMap[m.excel] = { id: null, targetName: m.targetName, kind: "MISSING" };
      stats.notResolved++;
    }
  }
}

fs.writeFileSync("/tmp/final_customer_map.json", JSON.stringify(finalMap, null, 2));
console.log("Stats:", stats);
console.log("Total mapping entries:", Object.keys(finalMap).length);
console.log("Saved: /tmp/final_customer_map.json");
