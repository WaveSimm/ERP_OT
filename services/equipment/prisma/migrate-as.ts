import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();

interface AsRow {
  seq: string;
  receivedAt: string | null;
  location: string;
  receivedBy: string;
  symptom: string;
  product: string;
  maker: string;
  serial: string;
  otNo: string;
  mfgDate: string;
  warranty: string;
  company: string;
  contact: string;
  contactPhone: string;
  handler: string;
  status: string;
  completedAt: string | null;
  result: string;
}

function mapStatus(raw: string): string {
  const s = raw.trim();
  if (!s) return "RECEIVED";
  if (s.includes("완료") || s === "점검완료") return "COMPLETED";
  if (s.includes("종료")) return "CLOSED";
  if (s.includes("취소") || s.includes("반송")) return "CANCELLED";
  if (s.includes("제조사") || s.includes("해외")) return "SHIPPED_TO_MFG";
  if (s.includes("견적") || s.includes("보류")) return "QUOTED";
  if (s.includes("수리중") || s.includes("수리")) return "REPAIRING";
  if (s.includes("점검중") || s.includes("점검") || s.includes("진행")) return "INSPECTING_1ST";
  if (s.includes("승인")) return "APPROVED";
  return "RECEIVED";
}

async function main() {
  const dataPath = path.join(__dirname, "as-data.json");
  const rows: AsRow[] = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
  console.log(`Loaded ${rows.length} AS rows from JSON`);

  // 1. Ensure all customers exist
  const uniqueCompanies = [...new Set(rows.map((r) => r.company).filter(Boolean))];
  const customerMap: Record<string, string> = {};

  for (const name of uniqueCompanies) {
    let customer = await prisma.customer.findFirst({ where: { name } });
    if (!customer) {
      customer = await prisma.customer.create({ data: { name } });
    }
    customerMap[name] = customer.id;
  }
  console.log(`Ensured ${uniqueCompanies.length} customers`);

  // 2. Insert repair orders
  let created = 0;
  let skipped = 0;

  for (const r of rows) {
    // Generate order number from seq: "22-1" -> "AS-22-001"
    const parts = r.seq.split("-");
    const yr = parts[0];
    const num = parts[1];
    const orderNumber = `AS-${yr}-${String(num).padStart(3, "0")}`;

    // Check if already exists
    const existing = await prisma.repairOrder.findFirst({ where: { orderNumber } });
    if (existing) {
      skipped++;
      continue;
    }

    const customerId = r.company ? customerMap[r.company] || null : null;
    const status = mapStatus((r as any).techStatus || (r as any).salesStatus || (r as any).status || "");

    try {
      await prisma.repairOrder.create({
        data: {
          orderNumber,
          orderType: "REPAIR",
          status: status as any,
          priority: "NORMAL",
          customerId: customerId || null,
          customerContactName: (r as any).contact || null,
          customerContactPhone: (r as any).contactPhone || null,
          productName: r.product || null,
          productMaker: r.maker || null,
          productSerial: r.serial || null,
          symptom: r.symptom || "점검 요청",
          currentLocation: r.location || null,
          otInventoryNo: (r as any).otNo || null,
          receivedBy: "이은경",
          assigneeName: "이은경",
          assigneePhone: null,
          techStatus: (r as any).techStatus || null,
          salesStatus: (r as any).salesStatus || null,
          isWarranty: (r as any).warranty === "무상",
          diagnosis1st: r.result || null,
          receivedAt: r.receivedAt ? new Date(r.receivedAt) : new Date("2022-01-01"),
          requestedDate: (r as any).reqDate ? new Date((r as any).reqDate) : null,
          completedAt: r.completedAt ? new Date(r.completedAt) : null,
          directCost: (r as any).directCost || null,
          laborDays: (r as any).laborDays || null,
          overseasShipDate: (r as any).overseasShipDate ? new Date((r as any).overseasShipDate) : null,
          returnDate: (r as any).returnDate ? new Date((r as any).returnDate) : null,
        },
      });
      created++;
    } catch (e: any) {
      console.error(`Failed to create ${orderNumber}: ${e.message}`);
    }
  }

  console.log(`Created ${created} repair orders (skipped ${skipped} duplicates)`);

  // Also insert equipment inspection history (장비점검이력)
  const inspectionSeeds = [
    { seq: "25-01-E", company: "한일뉴즈", product: "Phins", maker: "Exail", serial: "PH-1091", symptom: "오랜 미사용으로 전체적으로 점검요청", receivedBy: "김주연", result: "접속 IP 확인 및 Web MMI 접속 후 데이터 정상표출" },
    { seq: "25-02-E", company: "한일뉴즈", product: "Phins", maker: "Exail", serial: "3457-181", symptom: "오랜 미사용 점검요청, DIGITAL Cable", receivedBy: "김주연", result: "cable 제작, port a-f i/o 12개" },
    { seq: "25-03-E", company: "지오시스템", product: "T50-P", maker: "Teledyne Marine", serial: "PSP 95771522498", symptom: "TX1.TC PN Alarm", receivedBy: "신용은", result: "Maker에서 PSP, Receiver 이상 부품 교체" },
    { seq: "25-04-E", company: "오션그래픽", product: "Octans", maker: "Exail", serial: "CT-2510", symptom: "Repeater 연결 불량", receivedBy: "김주연", result: "Octans Digital output 정상 확인" },
  ];

  for (const ins of inspectionSeeds) {
    const orderNum = `EQ-${ins.seq}`;
    const existing = await prisma.repairOrder.findFirst({ where: { orderNumber: orderNum } });
    if (existing) continue;

    // Ensure customer
    let custId = null;
    if (ins.company) {
      let cust = await prisma.customer.findFirst({ where: { name: ins.company } });
      if (!cust) cust = await prisma.customer.create({ data: { name: ins.company } });
      custId = cust.id;
    }

    await prisma.repairOrder.create({
      data: {
        orderNumber: orderNum,
        orderType: "REPAIR",
        status: "COMPLETED",
        priority: "NORMAL",
        customerId: custId || null,
        productName: ins.product,
        productMaker: ins.maker,
        productSerial: ins.serial,
        symptom: ins.symptom,
        receivedBy: "김주연",
        assigneeName: "김주연",
        diagnosis1st: ins.result,
      },
    });
  }
  console.log(`Seeded ${inspectionSeeds.length} equipment inspections`);
}

main()
  .catch((e) => {
    console.error("Migration error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
