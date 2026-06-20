import { PrismaClient } from "@prisma/client";

// 통합테스트 공용 헬퍼.
//   - DATABASE_URL 은 격리된 테스트 DB를 가리켜야 함(절대 운영 DB 금지).
//     셋업: prisma db push 로 스키마 적용 후 test:integration 실행.
//   - 단일 PrismaClient 재사용. afterEach 에서 truncateAll() 로 격리.

if (!process.env.DATABASE_URL) {
  throw new Error(
    "[integration] DATABASE_URL 미설정 — 격리된 테스트 DB 필요. " +
    "예: DATABASE_URL=postgresql://...@localhost:5432/erp_ot_test pnpm test:integration",
  );
}

export const prisma = new PrismaClient();

/** equipment 스키마의 모든 테이블 TRUNCATE (FK 무시, identity 리셋) — 테스트 간 격리. */
export async function truncateAll(): Promise<void> {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'equipment'
  `;
  if (rows.length === 0) return;
  const list = rows.map((r) => `equipment."${r.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

export async function disconnect(): Promise<void> {
  await prisma.$disconnect();
}
