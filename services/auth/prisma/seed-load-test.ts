/**
 * 부하테스트 PDCA — auth-service 부하 사용자 시드
 *
 * 환경변수:
 *   LOAD_TEST_USER_COUNT (default 90)
 *   LOAD_TEST_PASSWORD   (default loadtest123!)
 *
 * 실행:
 *   docker exec erp-ot-auth pnpm prisma db seed --schema=load-test
 *   또는: node -r ts-node/register prisma/seed-load-test.ts
 *
 * Idempotent: upsert 사용 — 반복 실행 안전.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const COUNT = parseInt(process.env.LOAD_TEST_USER_COUNT ?? "90", 10);
const PASSWORD = process.env.LOAD_TEST_PASSWORD ?? "loadtest123!";
const DOMAIN = process.env.LOAD_TEST_DOMAIN ?? "@erp-ot.load";

async function main() {
  console.log(`[load-seed] creating ${COUNT} load test users (domain: ${DOMAIN})`);
  const hash = bcrypt.hashSync(PASSWORD, 10);

  // 부서 round-robin 배정용
  const depts = await prisma.department.findMany({
    where: { isActive: true },
    select: { id: true },
    orderBy: { sortOrder: "asc" },
  });
  if (depts.length === 0) {
    console.warn("[load-seed] no active departments — profiles will have departmentId=null");
  }

  let ok = 0;
  for (let i = 1; i <= COUNT; i++) {
    const idx = String(i).padStart(3, "0");
    const id = `loadtest-${idx}`;
    const email = `loadtest-${idx}${DOMAIN}`;
    const name = `[LOAD] 테스트${i}`;
    const deptId = depts.length > 0 ? depts[i % depts.length]!.id : null;

    await prisma.user.upsert({
      where: { id },
      create: {
        id,
        email,
        name,
        passwordHash: hash,
        role: "OPERATOR",
        isActive: true,
        // 자원-모델-분리 PDCA Phase 3c (2026-05-04): status 명시
        status: "ACTIVE",
      },
      update: {
        name,
        passwordHash: hash,
        isActive: true,
        status: "ACTIVE",
        retirementDate: null,
      },
    });

    await prisma.userProfile.upsert({
      where: { userId: id },
      create: {
        userId: id,
        ...(deptId ? { departmentId: deptId } : {}),
        position: "사원",
      },
      update: {
        ...(deptId ? { departmentId: deptId } : {}),
      },
    });

    ok++;
    if (i % 10 === 0) process.stdout.write(`.`);
  }
  console.log(`\n[load-seed] done — ok=${ok}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
