// 거래 상태 재동기화 — 정산분류(정산묶음 배정) 기준.
//   PENDING/CATEGORIZED 거래만 대상(EXCLUDED/CANCELED는 보존).
//   미배정→PENDING(미정산분류) / DRAFT·REJECTED 묶음→CATEGORIZED(정산분류완료) / 상신·완료 묶음→SETTLED.
const { PrismaClient } = require("@prisma/client");
(async () => {
  const prisma = new PrismaClient();
  const txs = await prisma.expenseTransaction.findMany({
    where: { status: { in: ["PENDING", "CATEGORIZED"] } },
    select: { id: true, settlementItems: { select: { settlement: { select: { status: true } } } } },
  });
  const setPending = [], setCat = [], setSettled = [];
  for (const t of txs) {
    if (t.settlementItems.length === 0) { setPending.push(t.id); continue; }
    const finalized = t.settlementItems.some((si) =>
      ["SUBMITTED", "APPROVED", "RECEIVED", "PAID"].includes(si.settlement.status));
    (finalized ? setSettled : setCat).push(t.id);
  }
  if (setPending.length) await prisma.expenseTransaction.updateMany({ where: { id: { in: setPending } }, data: { status: "PENDING" } });
  if (setCat.length) await prisma.expenseTransaction.updateMany({ where: { id: { in: setCat } }, data: { status: "CATEGORIZED" } });
  if (setSettled.length) await prisma.expenseTransaction.updateMany({ where: { id: { in: setSettled } }, data: { status: "SETTLED" } });
  console.log(`재동기화 — 미정산분류:${setPending.length} 정산분류완료:${setCat.length} 정산됨:${setSettled.length}`);
  const dist = await prisma.expenseTransaction.groupBy({ by: ["status"], _count: true });
  console.log("최종 분포:", JSON.stringify(dist));
  await prisma.$disconnect();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
