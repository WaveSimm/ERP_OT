// 계약 업서트 — contractNumber(#YY-N) 기준. 기존 번호는 유지(건드리지 않음), 없는 번호만 생성.
// 삭제 없음 → 발주/정산 FK 안전. equipment 컨테이너에서 실행.
// 실행: node import-contracts.cjs <json> [--dry]
const { PrismaClient } = require("@prisma/client");
const fs = require("fs");

(async () => {
  const file = process.argv[2];
  const DRY = process.argv.includes("--dry");
  const prisma = new PrismaClient();
  const records = JSON.parse(fs.readFileSync(file, "utf-8"));

  const existing = new Set(
    (await prisma.contract.findMany({ select: { contractNumber: true } })).map((c) => c.contractNumber),
  );
  const toCreate = records.filter((r) => !existing.has(r.contractNumber));
  console.log(`총 ${records.length} | 기존유지 ${records.length - toCreate.length} | 신규생성 ${toCreate.length}`);

  // 연도별 신규
  const byYear = {};
  for (const r of toCreate) byYear[r.year] = (byYear[r.year] || 0) + 1;
  console.log("신규 연도별:", JSON.stringify(byYear));

  if (DRY) {
    console.log("[DRY-RUN] 변경 없음. 신규 샘플 3건:");
    toCreate.slice(0, 3).forEach((r) => console.log("  ", r.contractNumber, r.name, "|", r.client, "|", r.contractDate));
    await prisma.$disconnect();
    return;
  }

  let created = 0, failed = 0;
  for (const r of toCreate) {
    try {
      await prisma.contract.create({
        data: {
          contractNumber: r.contractNumber,
          name: r.name || "(미상)",
          client: r.client || "(미상)",
          clientContact: r.clientContact || null,
          manufacturer: r.manufacturer || null,
          category: r.category || "물품",
          contractType: r.contractType || "내자",
          contractDate: r.contractDate ? new Date(r.contractDate) : null,
          deadline: r.deadline ? new Date(r.deadline) : null,
          manager: r.manager || null,
          notes: r.notes || null,
        },
      });
      created++;
    } catch (e) {
      failed++;
      if (failed <= 5) console.log("  실패", r.contractNumber, String(e.message).slice(0, 80));
    }
  }
  console.log(`생성 완료: ${created} | 실패: ${failed}`);
  const total = await prisma.contract.count();
  console.log("현재 계약 총건수:", total);
  await prisma.$disconnect();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
