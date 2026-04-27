// equipment-service 컨테이너에서 실행: @prisma/client 필요
// /tmp/customer_need_create.txt 읽어 Customer 레코드 생성 후 id 매핑 출력

const { PrismaClient } = require("@prisma/client");
const fs = require("fs");

const prisma = new PrismaClient();

async function main() {
  const names = fs
    .readFileSync("/tmp/customer_need_create.txt", "utf8")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const created = [];
  for (const name of names) {
    const existing = await prisma.customer.findFirst({ where: { name } });
    if (existing) {
      created.push({ name, id: existing.id, created: false });
      continue;
    }
    const c = await prisma.customer.create({ data: { name } });
    created.push({ name, id: c.id, created: true });
  }
  fs.writeFileSync("/tmp/created_customers.json", JSON.stringify(created, null, 2));
  console.log("Total:", created.length, "| newly created:", created.filter((r) => r.created).length, "| already existed:", created.filter((r) => !r.created).length);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
