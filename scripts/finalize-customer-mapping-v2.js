// 중복 통합 + EMPTY 3건 신규 생성 통합 스크립트 (equipment-service에서 실행)
const { PrismaClient } = require("@prisma/client");
const fs = require("fs");

const prisma = new PrismaClient();

const MERGES = {
  "㈜해원문화재연구소": { keep: "해원문화재연구소", keepId: "cmoci264f0014zhteh5niff9g" },
  "남동해 수산연구소":   { keep: "남동해수산연구소",  keepId: "cmoci262c000bzhtee325c0qk" },
};
// EMPTY → 신규 생성
const EMPTY_NEW = ["새한항업", "해군", "바란산업"];
// Excel 원본명 → 사용자가 원하는 최종명 (원본은 물음표 포함된 경우 있음)
const EMPTY_EXCEL_MAP = {
  "새한항업": "새한항업",
  "해군": "해군",
  "바란산업?": "바란산업",
};

async function main() {
  // 1) EMPTY 3건 신규 생성
  const newlyCreated = {};
  for (const name of EMPTY_NEW) {
    const existing = await prisma.customer.findFirst({ where: { name } });
    if (existing) {
      newlyCreated[name] = existing.id;
      continue;
    }
    const c = await prisma.customer.create({ data: { name } });
    newlyCreated[name] = c.id;
  }
  console.log("Newly created:", newlyCreated);

  // 2) final_customer_map 로드 + 수정
  const map = JSON.parse(fs.readFileSync("/tmp/final_customer_map.json", "utf8"));

  // merges 반영
  let mergedCount = 0;
  for (const excelName of Object.keys(map)) {
    const entry = map[excelName];
    if (entry.targetName && MERGES[entry.targetName]) {
      const mg = MERGES[entry.targetName];
      entry.id = mg.keepId;
      entry.targetName = mg.keep;
      entry.note = "merged from previous duplicate";
      mergedCount++;
    }
  }

  // EMPTY 반영
  let emptyResolved = 0;
  for (const excelName of Object.keys(map)) {
    const entry = map[excelName];
    if (entry.kind === "EMPTY") {
      const finalName = EMPTY_EXCEL_MAP[excelName];
      if (finalName && newlyCreated[finalName]) {
        entry.id = newlyCreated[finalName];
        entry.targetName = finalName;
        entry.kind = "NEW";
        entry.note = "EMPTY resolved via user directive";
        emptyResolved++;
      }
    }
  }

  fs.writeFileSync("/tmp/final_customer_map.json", JSON.stringify(map, null, 2));

  console.log("Merged entries:", mergedCount);
  console.log("EMPTY resolved:", emptyResolved);
  console.log("Total entries:", Object.keys(map).length);

  // 최종 요약
  const kindCount = {};
  for (const e of Object.values(map)) {
    kindCount[e.kind] = (kindCount[e.kind] || 0) + 1;
  }
  console.log("Final kind distribution:", kindCount);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
