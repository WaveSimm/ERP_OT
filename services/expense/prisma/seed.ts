// 표준 카테고리 10종 seed (Plan §9 Q1 — 하이브리드)
// 개인 카테고리는 사용자가 추가, 표준은 admin이 관리

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const STANDARD_CATEGORIES = [
  { code: "MEAL",        name: "식대",        sheetName: "식대",        displayOrder: 1 },
  { code: "TRANSPORT",   name: "교통비",      sheetName: "교통비",      displayOrder: 2 },
  { code: "ENTERTAIN",   name: "접대",        sheetName: "접대비",      displayOrder: 3 },
  { code: "TRIP",        name: "출장경비",    sheetName: "출장경비",    displayOrder: 4 },
  { code: "FIELDWORK",   name: "외근",        sheetName: "외근",        displayOrder: 5 },
  { code: "SUPPLIES",    name: "소모품",      sheetName: "소모품",      displayOrder: 6 },
  { code: "TELECOM",     name: "통신비",      sheetName: "통신비",      displayOrder: 7 },
  { code: "BOOK",        name: "도서",        sheetName: "도서",        displayOrder: 8 },
  { code: "EDUCATION",   name: "교육",        sheetName: "교육",        displayOrder: 9 },
  { code: "OFFICE",      name: "사무용품",    sheetName: "사무용품",    displayOrder: 10 },
  { code: "AI_SUB",      name: "AI구독",      sheetName: "AI구독",      displayOrder: 11 },
  { code: "MISC",        name: "기타",        sheetName: "기타",        displayOrder: 99 },
  { code: "PERSONAL",    name: "미정산(개인)", sheetName: "미정산",      displayOrder: 100 },
];

async function main() {
  for (const c of STANDARD_CATEGORIES) {
    await prisma.expenseCategory.upsert({
      where: { code: c.code },
      create: {
        scope: "STANDARD",
        ownerUserId: null,
        code: c.code,
        name: c.name,
        sheetName: c.sheetName,
        displayOrder: c.displayOrder,
        active: true,
      },
      update: {
        name: c.name,
        sheetName: c.sheetName,
        displayOrder: c.displayOrder,
      },
    });
  }
  console.log(`Seeded ${STANDARD_CATEGORIES.length} standard categories`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
