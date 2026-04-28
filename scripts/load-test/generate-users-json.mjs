#!/usr/bin/env node
// 부하테스트 — k6용 사용자 인증 정보 생성
// node scripts/load-test/generate-users-json.mjs > scripts/load-test/users.json

const COUNT = parseInt(process.env.LOAD_TEST_USER_COUNT ?? "90", 10);
const PASSWORD = process.env.LOAD_TEST_PASSWORD ?? "loadtest123!";
const DOMAIN = process.env.LOAD_TEST_DOMAIN ?? "@erp-ot.load";

const users = [];
for (let i = 1; i <= COUNT; i++) {
  const idx = String(i).padStart(3, "0");
  users.push({
    id: `loadtest-${idx}`,
    email: `loadtest-${idx}${DOMAIN}`,
    password: PASSWORD,
  });
}

console.log(JSON.stringify(users, null, 2));
