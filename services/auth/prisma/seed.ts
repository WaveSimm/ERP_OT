import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const STANDARD_WRITE_ROLES = ["OPERATOR", "MANAGER", "ADMIN"];

async function seedAdmin() {
  const adminEmail = process.env.ADMIN_EMAIL ?? "admin@erp-ot.local";
  const adminPassword = process.env.ADMIN_INITIAL_PASSWORD ?? "Admin1234!";

  const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!existing) {
    await prisma.user.create({
      data: {
        email: adminEmail,
        name: "시스템 관리자",
        passwordHash: await bcrypt.hash(adminPassword, 12),
        role: "ADMIN",
      },
    });
    console.log(`Admin user created: ${adminEmail}`);
  } else {
    console.log(`Admin user already exists: ${adminEmail}`);
  }
}

async function seedBoards() {
  const categories: Array<{ code: string; name: string; icon: string; sortOrder: number; isVisible: boolean }> = [
    { code: "notice", name: "공지사항", icon: "📢", sortOrder: 1, isVisible: true },
    { code: "wiki", name: "게시판", icon: "📚", sortOrder: 2, isVisible: true },
    { code: "department", name: "부서별 게시판", icon: "🏢", sortOrder: 3, isVisible: false },
  ];

  for (const c of categories) {
    // 보안 일괄패치 PDCA Layer 1 회귀 방지: 운영자가 카테고리 name을 수정한 값을 보존
    // create 시점만 name 설정, update에서는 name 제외 (운영자 자율)
    await prisma.boardCategory.upsert({
      where: { code: c.code },
      create: c,
      update: { icon: c.icon, sortOrder: c.sortOrder, isVisible: c.isVisible },
    });
  }

  const noticeCat = await prisma.boardCategory.findUniqueOrThrow({ where: { code: "notice" } });
  const wikiCat = await prisma.boardCategory.findUniqueOrThrow({ where: { code: "wiki" } });

  const boards: Array<{
    categoryId: string;
    code: string;
    name: string;
    description: string;
    sortOrder: number;
  }> = [
    { categoryId: noticeCat.id, code: "notice-company", name: "전사 공지", description: "전 직원 대상 공지사항", sortOrder: 1 },
    { categoryId: noticeCat.id, code: "notice-dept", name: "부서 공지", description: "부서별 공지사항", sortOrder: 2 },
    { categoryId: wikiCat.id, code: "wiki-debug", name: "장비 관련", description: "장비 설치·점검·트러블슈팅 노하우", sortOrder: 1 },
    { categoryId: wikiCat.id, code: "wiki-field", name: "현장 업무", description: "현장 업무 진행 자료·노하우", sortOrder: 2 },
    { categoryId: wikiCat.id, code: "wiki-tech", name: "기술 정보", description: "기술 자료, 매뉴얼, 문서", sortOrder: 3 },
    { categoryId: wikiCat.id, code: "wiki-misc", name: "기타 자유", description: "자유 게시판", sortOrder: 4 },
  ];

  for (const b of boards) {
    await prisma.board.upsert({
      where: { code: b.code },
      create: {
        ...b,
        writeRoles: STANDARD_WRITE_ROLES,
        readAudience: "ALL",
        allowComments: true,
        allowAttachments: true,
        postPinnable: true,
      },
      update: {
        name: b.name,
        description: b.description,
        sortOrder: b.sortOrder,
        writeRoles: STANDARD_WRITE_ROLES,
      },
    });
  }

  console.log(`Boards seeded: ${categories.length} categories, ${boards.length} boards`);
}

async function main() {
  await seedAdmin();
  await seedBoards();
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
