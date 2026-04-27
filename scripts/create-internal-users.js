// 내부 담당자 NONE 5명 신규 User 생성 (이재윤, 박정은, 박우영, 강경민, 홍다운)
// 최종 매핑 파일 생성 (Excel 담당자명 → ERP User ID)
//
// 실행: equipment-service 컨테이너
//   cp /tmp/create-internal-users.js /app/create-internal-users.js
//   cd /app && node create-internal-users.js

const { PrismaClient } = require("@prisma/client");
const fs = require("fs");

const prisma = new PrismaClient();

const NEW_USERS = ["박정은", "박우영", "이재윤", "강경민", "홍다운"];

// Excel 담당자명 → ERP User ID 매핑 (결정 완료분)
// SUBSTR 옵션 A: 이학용(xxx) / 이학용/xxx → 이학용 ID
// "홍" 1건 → IGNORE (null)
// 부산지사 → 오원진 ID
const EXCEL_DECISIONS = {
  // SUBSTR 6건
  "이학용(하선종)": { name: "이학용" },
  "이학용/박정은": { name: "이학용" },
  "이학용(오원진)": { name: "이학용" },
  "이학용/오원진": { name: "이학용" },
  "이학용(심윤송)": { name: "이학용" },
  "홍": { ignore: true },
  // NONE 6건
  "박정은": { createName: "박정은" },
  "박우영": { createName: "박우영" },
  "이재윤": { createName: "이재윤" },
  "강경민": { createName: "강경민" },
  "홍다운": { createName: "홍다운" },
  "부산지사": { name: "오원진" },
};

async function main() {
  const prismaUsers = new PrismaClient();
  // 1) NEW User 생성 (auth_users 테이블에 직접 — Prisma 스키마에 auth.User 모델이 있는지 확인 필요)
  // Prisma로 User 모델 접근 불가할 수 있음 — raw SQL 사용
  const createdUserIds = {};

  const { execSync } = require("child_process");
  const crypto = require("crypto");

  function makeCuid() {
    // cuid2 유사 생성
    return "c" + crypto.randomBytes(12).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24);
  }

  for (const name of NEW_USERS) {
    // 이미 존재하는지 확인
    const existing = await prisma.$queryRaw`
      SELECT id FROM public.auth_users WHERE name = ${name} LIMIT 1
    `;
    if (existing.length > 0) {
      createdUserIds[name] = existing[0].id;
      continue;
    }
    const id = makeCuid();
    const email = `${name}@migration.local`;
    const passwordHash = "MIGRATION_NO_LOGIN"; // 로그인 불가용 placeholder
    await prisma.$executeRaw`
      INSERT INTO public.auth_users (id, email, name, password_hash, role, is_active, created_at, updated_at)
      VALUES (${id}, ${email}, ${name}, ${passwordHash}, 'OPERATOR', false, now(), now())
    `;
    createdUserIds[name] = id;
  }
  console.log("Created users:", createdUserIds);

  // 2) 전체 ERP Users 이름→ID 맵 로드 (기존 + 신규)
  const nameToId = new Map();
  const allUsers = await prisma.$queryRaw`SELECT id, name FROM public.auth_users`;
  for (const u of allUsers) nameToId.set(u.name, u.id);

  // 3) 매칭 파일 읽어 최종 매핑 구성
  const xlsx = require("xlsx");
  const wb = xlsx.readFile("/tmp/matching_reviewed.xlsx");
  const sh = wb.Sheets["내부담당자_매칭"];
  const d = xlsx.utils.sheet_to_json(sh, { header: 1, raw: false, defval: "" });

  const finalMap = {};
  const stats = { EXACT: 0, SUBSTR_A: 0, NONE_NEW: 0, NONE_MAPPED: 0, IGNORED: 0, ERROR: 0 };

  for (let i = 1; i < d.length; i++) {
    const name = String(d[i][0] || "").trim();
    const status = d[i][3];
    const cand1 = d[i][4];
    const cand1id = d[i][5];
    if (!name) continue;

    if (status === "EXACT" && cand1id) {
      finalMap[name] = { id: cand1id, kind: "EXACT", targetName: cand1 };
      stats.EXACT++;
      continue;
    }

    const dec = EXCEL_DECISIONS[name];
    if (dec && dec.ignore) {
      finalMap[name] = { id: null, kind: "IGNORE" };
      stats.IGNORED++;
    } else if (dec && dec.createName) {
      const id = createdUserIds[dec.createName];
      if (id) {
        finalMap[name] = { id, kind: "NEW_CREATED", targetName: dec.createName };
        stats.NONE_NEW++;
      } else {
        finalMap[name] = { id: null, kind: "ERROR" };
        stats.ERROR++;
      }
    } else if (dec && dec.name) {
      const id = nameToId.get(dec.name);
      if (id) {
        finalMap[name] = { id, kind: status === "SUBSTR" ? "SUBSTR_A" : "NONE_MAPPED", targetName: dec.name };
        if (status === "SUBSTR") stats.SUBSTR_A++;
        else stats.NONE_MAPPED++;
      } else {
        finalMap[name] = { id: null, kind: "ERROR", note: "target name not found: " + dec.name };
        stats.ERROR++;
      }
    } else {
      finalMap[name] = { id: null, kind: "UNHANDLED" };
      stats.ERROR++;
    }
  }

  fs.writeFileSync("/tmp/final_user_map.json", JSON.stringify(finalMap, null, 2));

  console.log("Final user mapping stats:", stats);
  console.log("Total entries:", Object.keys(finalMap).length);
  await prisma.$disconnect();
  await prismaUsers.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
