/**
 * AS관리_2022_V10.xlsx → 수리관리 DB 마이그레이션 스크립트
 *
 * 실행: node scripts/import-as-excel.js
 *
 * 대상 테이블: customers, customer_assets, repair_orders
 */

const XLSX = require("xlsx");
const { Client } = require("pg");

const DB_URL = process.env.DATABASE_URL || "postgresql://erp_user:erp_password@localhost:5432/erp_ot";
const EXCEL_PATH = process.env.EXCEL_PATH || "AS관리_2022_V10.xlsx";

// ── Excel serial → Date ──
function excelDate(v) {
  if (!v || v === "_" || v === "-") return null;
  if (typeof v === "number") {
    // Excel serial date
    const d = new Date((v - 25569) * 86400000);
    return d.toISOString();
  }
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (!trimmed || trimmed === "_" || trimmed === "-") return null;
    // Try parse YYYY-MM or YYYY-MMDD etc.
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

function clean(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === "" || s === "_" || s === "-") return null;
  return s;
}

function genId() {
  // cuid-like: timestamp + random
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).substring(2, 10);
  return `imp${t}${r}`;
}

// 엑셀 진행상황 → DB status 매핑
function mapStatus(techStatus, salesStatus) {
  const t = (techStatus || "").toString().trim();
  const s = (salesStatus || "").toString().trim();

  if (s === "완료" || s === "완료(납품)") return "COMPLETED";
  if (t === "완료") return "COMPLETED";
  if (s.includes("제조사")) return "SHIPPED_TO_MFG";
  if (t.includes("제조사수리")) return "SHIPPED_TO_MFG";
  if (t.includes("수리중") || t === "수리") return "REPAIRING";
  if (t.includes("점검중") || t === "점검") return "INSPECTING_1ST";
  if (t.includes("진행") || s.includes("진행")) return "INSPECTING_1ST";
  if (t.includes("견적") || s.includes("견적")) return "QUOTED";
  return "RECEIVED";
}

async function main() {
  console.log("📂 Reading Excel:", EXCEL_PATH);
  const wb = XLSX.readFile(EXCEL_PATH);
  const ws = wb.Sheets["관리시트"];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

  // Header at row index 2
  // Data starts at row index 3
  const dataRows = [];
  for (let i = 3; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[0]) continue; // skip empty
    dataRows.push(r);
  }
  console.log(`📊 Data rows: ${dataRows.length}`);

  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  console.log("🔗 DB connected");

  // Check existing data
  const existing = await client.query("SELECT COUNT(*) FROM equipment.repair_orders");
  if (parseInt(existing.rows[0].count) > 0) {
    console.log(`⚠️  repair_orders already has ${existing.rows[0].count} rows.`);
    const readline = require("readline");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise(resolve => rl.question("Continue and add more? (y/N): ", resolve));
    rl.close();
    if (answer.toLowerCase() !== "y") {
      console.log("Aborted.");
      await client.end();
      return;
    }
  }

  // ── Dedupe customers ──
  const customerMap = new Map(); // name → id
  const assetMap = new Map();    // key(제품명+일련번호+재고NO) → id

  let insertedCustomers = 0;
  let insertedAssets = 0;
  let insertedOrders = 0;
  let skipped = 0;

  for (const r of dataRows) {
    const orderNumber = clean(r[0]);    // 순번 (22-1, 22-2, ...)
    if (!orderNumber) { skipped++; continue; }

    // ── 1. Customer ──
    const customerName = clean(r[13]);  // 회사명
    let customerId = null;
    if (customerName) {
      if (customerMap.has(customerName)) {
        customerId = customerMap.get(customerName);
      } else {
        // Check DB first
        const found = await client.query(
          "SELECT id FROM equipment.customers WHERE name = $1 LIMIT 1",
          [customerName]
        );
        if (found.rows.length > 0) {
          customerId = found.rows[0].id;
        } else {
          customerId = genId();
          await client.query(
            `INSERT INTO equipment.customers (id, name, "contactPerson", phone, "createdAt", "updatedAt")
             VALUES ($1, $2, $3, $4, NOW(), NOW())`,
            [customerId, customerName, clean(r[14]), clean(r[15])]
          );
          insertedCustomers++;
        }
        customerMap.set(customerName, customerId);
      }
    }

    // ── 2. CustomerAsset ──
    const productName = clean(r[6]);    // 제품명
    const manufacturer = clean(r[7]);   // 제작사
    const serialNumber = clean(r[8]);   // 일련번호
    const otInventoryNo = clean(r[9]);  // OT재고NO
    const assetKey = `${productName}|${serialNumber}|${otInventoryNo}`;

    // 고객 없는 자산을 위한 기본 고객
    if (!customerId && productName) {
      const unknownName = "(미상)";
      if (customerMap.has(unknownName)) {
        customerId = customerMap.get(unknownName);
      } else {
        const found = await client.query("SELECT id FROM equipment.customers WHERE name = $1 LIMIT 1", [unknownName]);
        if (found.rows.length > 0) {
          customerId = found.rows[0].id;
        } else {
          customerId = genId();
          await client.query(
            `INSERT INTO equipment.customers (id, name, "createdAt", "updatedAt") VALUES ($1, $2, NOW(), NOW())`,
            [customerId, unknownName]
          );
          insertedCustomers++;
        }
        customerMap.set(unknownName, customerId);
      }
    }

    let customerAssetId = null;
    if (productName) {
      if (assetMap.has(assetKey)) {
        customerAssetId = assetMap.get(assetKey);
      } else {
        // Check DB
        const conditions = [];
        const params = [];
        let idx = 1;
        if (serialNumber) {
          conditions.push(`"serialNumber" = $${idx++}`);
          params.push(serialNumber);
        }
        if (otInventoryNo) {
          conditions.push(`"otInventoryNo" = $${idx++}`);
          params.push(otInventoryNo);
        }
        if (conditions.length > 0) {
          const found = await client.query(
            `SELECT id FROM equipment.customer_assets WHERE ${conditions.join(" AND ")} LIMIT 1`,
            params
          );
          if (found.rows.length > 0) {
            customerAssetId = found.rows[0].id;
          }
        }
        if (!customerAssetId) {
          customerAssetId = genId();
          const manufacturedAt = clean(r[10]); // 제조년월 (문자열로 저장)
          const soldAt = excelDate(r[11]);     // 구매일
          await client.query(
            `INSERT INTO equipment.customer_assets
             (id, "customerId", "assetType", name, "serialNumber", manufacturer, "manufacturedAt", "soldAt", "otInventoryNo", "createdAt", "updatedAt")
             VALUES ($1, $2, 'EQUIPMENT', $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
            [customerAssetId, customerId, productName, serialNumber, manufacturer, manufacturedAt, soldAt, otInventoryNo]
          );
          insertedAssets++;
        }
        assetMap.set(assetKey, customerAssetId);
      }
    }

    // ── 3. RepairOrder ──
    // Check if orderNumber already exists
    const orderExists = await client.query(
      "SELECT id FROM equipment.repair_orders WHERE \"orderNumber\" = $1 LIMIT 1",
      [orderNumber]
    );
    if (orderExists.rows.length > 0) {
      skipped++;
      continue;
    }

    const receivedAt = excelDate(r[1]);   // 접수일
    const techStatus = clean(r[19]);      // 점검 진행상황
    const salesSt = clean(r[20]);         // 영업부 진행상황
    const completedAt = excelDate(r[21]); // 완료일
    const repairDetails = clean(r[22]);   // 점검결과
    const isWarranty = clean(r[12]) === "무상";
    const status = mapStatus(techStatus, salesSt);
    const requestedDate = excelDate(r[16]); // 요청일
    const assigneeName = clean(r[17]);     // 담당자
    const assigneePhone = clean(r[18]);    // 연락처
    const currentLocation = clean(r[3]);   // 현재위치
    const receivedBy = clean(r[4]);        // 접수담당
    const symptom = clean(r[5]);           // 접수 증상
    const directCost = clean(r[25]);       // 직접경비
    const laborDays = clean(r[26]);        // 공수
    const overseasShip = excelDate(r[27]); // 해외발송
    const returnDate = excelDate(r[28]);   // 수리후입고
    const linkUrl = clean(r[24]);          // Link

    const orderId = genId();
    await client.query(
      `INSERT INTO equipment.repair_orders
       (id, "orderNumber", "orderType", status, priority,
        "customerId", "customerAssetId",
        "currentLocation", symptom, "otInventoryNo",
        "techStatus", "salesStatus",
        "repairDetails", "isWarranty",
        "receivedBy", "assigneeName", "assigneePhone",
        "receivedAt", "requestedDate", "completedAt",
        "directCost", "laborDays", "overseasShipDate", "returnDate", "linkUrl",
        "createdAt", "updatedAt")
       VALUES ($1,$2,'REPAIR',$3,'NORMAL',
        $4,$5,
        $6,$7,$8,
        $9,$10,
        $11,$12,
        $13,$14,$15,
        $16,$17,$18,
        $19,$20,$21,$22,$23,
        NOW(),NOW())`,
      [
        orderId, orderNumber, status,
        customerId, customerAssetId,
        currentLocation, symptom, otInventoryNo,
        techStatus, salesSt,
        repairDetails, isWarranty,
        receivedBy, assigneeName, assigneePhone,
        receivedAt || new Date().toISOString(), requestedDate, completedAt,
        directCost ? parseFloat(String(directCost).replace(/,/g, "")) || null : null,
        laborDays ? parseFloat(String(laborDays).replace(/,/g, "")) || null : null,
        overseasShip, returnDate, linkUrl,
      ]
    );
    insertedOrders++;
  }

  console.log("\n✅ Import complete!");
  console.log(`   Customers: ${insertedCustomers} new`);
  console.log(`   Assets:    ${insertedAssets} new`);
  console.log(`   Orders:    ${insertedOrders} new`);
  console.log(`   Skipped:   ${skipped} (empty or duplicate)`);

  await client.end();
}

main().catch((e) => { console.error("❌ Error:", e.message); process.exit(1); });
