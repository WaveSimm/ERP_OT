/**
 * 부하테스트 PDCA — project-service 부하 사용자 Resource 시드
 *
 * Resource.userId는 auth-service의 user.email(또는 user.id) 중 어떤 키로 매칭하는지가
 * 코드에 따라 다른데, 현재 이 프로젝트는 "userId = email" 패턴을 사용함
 * (참고: work-log.service.ts의 prisma.resource.findFirst({ where: { userId: user.email } }))
 *
 * 환경변수: LOAD_TEST_USER_COUNT (default 90), LOAD_TEST_DOMAIN (default @erp-ot.load)
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const COUNT = parseInt(process.env.LOAD_TEST_USER_COUNT ?? "90", 10);
const DOMAIN = process.env.LOAD_TEST_DOMAIN ?? "@erp-ot.load";

async function main() {
  console.log(`[load-seed-project] creating ${COUNT} resources for load test users`);
  let ok = 0;

  for (let i = 1; i <= COUNT; i++) {
    const idx = String(i).padStart(3, "0");
    const userKey = `loadtest-${idx}${DOMAIN}`;        // = email (work-log.service.ts 기준)
    const name = `[LOAD] 테스트${i}`;

    // userId는 unique이므로 upsert
    await prisma.resource.upsert({
      where: { userId: userKey },
      create: {
        userId: userKey,
        name,
        type: "PERSON",
        dailyCapacityHours: 8.0,
        isActive: true,
      },
      update: {
        name,
        isActive: true,
      },
    });
    ok++;
    if (i % 10 === 0) process.stdout.write(`.`);
  }
  console.log(`\n[load-seed-project] done — ok=${ok}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
