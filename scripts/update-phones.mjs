// References/26년5월 _내선번호 .pdf → 신규 5명 계정 생성 + 전체 61명 phone profile 업데이트
//
// 실행:
//   docker exec -w /app erp-ot-auth node update-phones.mjs           # dry-run
//   docker exec -w /app erp-ot-auth node update-phones.mjs --apply   # 실제 적용

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const INIT_PASSWORD = "oceantech";

// 매칭 키: name. PDF의 신규 5명은 email + dept 정보를 함께 보유.
// 기존 56명은 name만으로 매칭(이미 DB에 존재).
const ENTRIES = [
  ["홍성두","9001","010-4373-8495"],["이기욱","9002","010-2322-8495"],
  ["문홍배","9081","010-8628-3427"],
  ["하선종","9021","010-9030-1815"],["강성화","9082","010-2019-3132"],
  ["이학용","9022","010-6348-4866"],["오원진","9083","010-9302-4589"],
  ["현지윤","9025","010-2960-6431"],["황유진","9084","010-9262-1853"],
  ["이채연","9026","010-3091-8864", { email: "leecy979@oceant.onmicrosoft.com",     deptCode: "SALES1"  }],
  ["김재엽","9085","010-7656-1959"],
  ["모태준","9090","010-5585-1560"],["이수현","9092","010-2997-2398"],
  ["이창민","9095","010-6669-3597"],["김진수","9058","010-5495-2156"],
  ["손형석","9072","010-8654-5562"],["김정훈","9094","010-5050-9206"],
  ["송인근","9075","010-5163-5403"],["이진호","9057","010-5644-9221"],
  ["황원욱","9096","010-4164-1260"],["김만복","9073","010-8923-0769"],
  ["서주안","9097","010-2370-4554", { email: "seoja@oceant.onmicrosoft.com",        deptCode: "UAVBIZ1" }],
  ["강경원","9093","010-9406-1981"],
  ["신용은","9041","010-5443-8479"],
  ["고태호","9042","010-3552-8066"],["황규하","9032","010-3872-0601"],
  ["한종민","9044","010-6394-2818"],["김승환","9063","010-4090-3378"],
  ["이형준","9045","010-4627-7586"],["이주학","9043","010-5528-3244"],
  ["이지훈","9064","010-7197-5232"],["강찬영","9033","010-9558-9315"],
  ["김정민","9047","010-5099-6582"],["김문진","9066","010-8702-9109"],
  ["김태현","9091","010-2014-8263"],["윤석준","9065","010-3379-8795"],
  ["한민혁","9098","010-6302-2551", { email: "mhhan8159@oceant.onmicrosoft.com",    deptCode: "BIZ1"    }],
  ["채병진","9067","010-7667-2708", { email: "coqudwls999@oceant.onmicrosoft.com",  deptCode: "BIZ2"    }],
  ["문기돈","9020","010-5321-0957"],["이승록","9046","010-7557-7530"],
  ["유정연","9062","010-9286-9917"],["박민수","9035","010-8350-9963"],
  ["김병태","9031","010-9370-8540"],["권오승","9049","010-4773-7298"],
  ["김주연","9037","010-2869-2876"],["이상현","9038","010-9337-9610", { email: "tkdgus0880@oceant.onmicrosoft.com", deptCode: "BIZ3" }],
  ["김민준","9048","010-3188-5893"],
  ["조혁만","9061","010-9462-4587"],
  ["심윤송","9050","010-9492-8628"],["박고은","9011","010-9838-3675"],
  ["최창영","9053","010-9306-8106"],["이민지","9013","010-2037-6844"],
  ["김창온","9052","010-3207-3949"],["류지현","9014","010-7344-5965"],
  ["홍재용","9055","010-5440-3487"],
  ["이은경","9056","010-4130-4678"],["김대현","9071","010-8513-6295"],
  ["신대철","9059","010-8897-3149"],["홍아름","9012","010-9979-6218"],
  ["김나예","9054","010-9080-9054"],
  ["최지수","9051","010-8011-4451"],
];

const DRY_RUN = !process.argv.includes("--apply");

async function main() {
  const prisma = new PrismaClient();
  try {
    const users = await prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true, email: true },
    });
    const byName = new Map();
    for (const u of users) byName.set(u.name, u);

    const depts = await prisma.department.findMany({
      where: { isActive: true },
      select: { id: true, name: true, code: true },
    });
    const byDeptCode = new Map(depts.map((d) => [d.code, d]));

    // 분류
    const toCreate = [];
    const toUpdateExisting = [];
    for (const [name, ext, mobile, opts] of ENTRIES) {
      const u = byName.get(name);
      if (u) {
        toUpdateExisting.push({ user: u, ext, mobile });
      } else if (opts?.email && opts?.deptCode) {
        const dept = byDeptCode.get(opts.deptCode);
        if (!dept) {
          console.error(`!! Dept not found for ${name}: ${opts.deptCode}`);
          continue;
        }
        toCreate.push({ name, ext, mobile, email: opts.email, dept });
      } else {
        console.error(`!! ${name}: 매칭 없음 + email/deptCode 정보 없음 → SKIP`);
      }
    }

    console.log("=== Plan summary ===");
    console.log("PDF entries:        ", ENTRIES.length);
    console.log("Active DB users:    ", users.length);
    console.log("To create (new):    ", toCreate.length);
    console.log("To update (existing):", toUpdateExisting.length);

    if (toCreate.length) {
      console.log("\n[Will create]");
      for (const c of toCreate) {
        console.log(`  ${c.name}  ${c.email}  dept=${c.dept.name}(${c.dept.code})  ext=${c.ext}  mobile=${c.mobile}`);
      }
    }

    if (DRY_RUN) {
      console.log("\n*** DRY RUN — no changes. Pass --apply to execute. ***");
      return;
    }

    const passwordHash = await bcrypt.hash(INIT_PASSWORD, 12);
    let createdOk = 0, createdFail = 0, updatedOk = 0, updatedFail = 0;

    // 1) 신규 계정 생성 (트랜잭션 — user + profile)
    for (const c of toCreate) {
      try {
        await prisma.$transaction(async (tx) => {
          const newUser = await tx.user.create({
            data: {
              email: c.email,
              name: c.name,
              passwordHash,
              role: "OPERATOR",
              isActive: true,
              status: "ACTIVE",
            },
          });
          await tx.userProfile.create({
            data: {
              userId: newUser.id,
              phoneOffice: c.ext,
              phoneMobile: c.mobile,
              departmentId: c.dept.id,
              departmentName: c.dept.name,
            },
          });
        });
        createdOk++;
        console.log(`  CREATE OK: ${c.name}`);
      } catch (e) {
        createdFail++;
        console.error(`  CREATE FAIL: ${c.name} — ${e.message}`);
      }
    }

    // 2) 기존 계정 phone UPSERT
    for (const m of toUpdateExisting) {
      try {
        await prisma.userProfile.upsert({
          where: { userId: m.user.id },
          create: { userId: m.user.id, phoneOffice: m.ext, phoneMobile: m.mobile },
          update: { phoneOffice: m.ext, phoneMobile: m.mobile },
        });
        updatedOk++;
      } catch (e) {
        updatedFail++;
        console.error(`  UPDATE FAIL: ${m.user.name} — ${e.message}`);
      }
    }

    console.log(`\n=== Result ===`);
    console.log(`Created:  ${createdOk} ok, ${createdFail} fail`);
    console.log(`Updated:  ${updatedOk} ok, ${updatedFail} fail`);
    console.log(`Init password for new accounts: "${INIT_PASSWORD}"`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
