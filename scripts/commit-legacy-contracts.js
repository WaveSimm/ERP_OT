// 과거 계약 적재(commit) — tmp/legacy_parsed.json → equipment.contracts.
//   컨테이너 안에서 실행: docker exec -w /app erp-ot-equipment node /tmp/commit-legacy-contracts.js /tmp/legacy_parsed.json
//   - createdBy='legacy-migration' 표식 (롤백: DELETE ... WHERE created_by='legacy-migration')
//   - contractNumber 기준 dedup + createMany skipDuplicates (멱등)
//   - status ACTIVE
const { PrismaClient } = require("@prisma/client");

async function main() {
  const jsonPath = process.argv[2] || "/tmp/legacy_parsed.json";
  const raw = JSON.parse(require("fs").readFileSync(jsonPath, "utf8"));

  // contractNumber 기준 파일간 중복 제거(첫 항목 우선)
  const seen = new Set();
  const recs = [];
  for (const r of raw) {
    const cn = String(r.contractNumber || "").trim();
    if (!cn || !r.name || !String(r.name).trim()) continue;
    if (seen.has(cn)) continue;
    seen.add(cn);
    recs.push(r);
  }

  const toDate = (v) => {
    if (!v) return null;
    const d = new Date(String(v));
    return isNaN(d.getTime()) ? null : d;
  };
  const data = recs.map((r) => ({
    contractNumber: String(r.contractNumber).trim(),
    name: String(r.name).trim().slice(0, 200),
    client: r.client ? String(r.client).trim().slice(0, 200) : "",
    clientContact: r.clientContact ? String(r.clientContact).slice(0, 100) : null,
    manufacturer: r.manufacturer ? String(r.manufacturer).slice(0, 200) : null,
    category: r.category === "용역" ? "용역" : "물품",
    contractType: r.contractType === "외자" ? "외자" : "내자",
    contractDate: toDate(r.contractDate),
    deadline: toDate(r.deadline),
    manager: r.manager ? String(r.manager).slice(0, 100) : null,
    notes: r.notes ? String(r.notes).slice(0, 500) : null,
    status: "ACTIVE",
    createdBy: "legacy-migration",
  }));

  const p = new PrismaClient();
  const before = await p.contract.count();
  const result = await p.contract.createMany({ data, skipDuplicates: true });
  const after = await p.contract.count();
  const legacy = await p.contract.count({ where: { createdBy: "legacy-migration" } });
  await p.$disconnect();

  console.log(JSON.stringify({
    parsedUnique: recs.length,
    inserted: result.count,
    skipped: data.length - result.count,
    contractsBefore: before,
    contractsAfter: after,
    legacyTagged: legacy,
  }, null, 2));
}

main().catch((e) => { console.error("적재 실패:", e.message); process.exit(1); });
