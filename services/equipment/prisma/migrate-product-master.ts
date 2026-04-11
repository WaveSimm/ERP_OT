/**
 * 장비마스터(ProductMaster) 통합 마이그레이션
 * - 재고(InventoryItem)의 제품 정보
 * - 수리관리(RepairOrder)의 제품 정보
 * - 고객자산(CustomerAsset)의 제품 정보
 * → ProductMaster 테이블에 통합 등록 + FK 연결
 *
 * Usage: npx tsx prisma/migrate-product-master.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ── 제조사명 정규화 매핑 ──────────────────────────
const MANUFACTURER_NORMALIZE: Record<string, string> = {
  // 대소문자 통일
  idronaut: "Idronaut",
  ixblue: "Ixblue",
  codar: "CODAR",
  miros: "MIROS",
  zebratech: "ZEBRA TECH",
  "zebra tech": "ZEBRA TECH",
  rtsys: "RTsys",
  // Exail은 Ixblue 리브랜딩이지만 별도 유지
};

function normalizeManufacturer(raw: string | null): string {
  if (!raw) return "Unknown";
  const trimmed = raw.trim();
  if (!trimmed) return "Unknown";
  const key = trimmed.toLowerCase();
  return MANUFACTURER_NORMALIZE[key] || trimmed;
}

function extractModelName(itemName: string): { name: string; modelName: string } {
  // 괄호 안 모델번호 추출: "Conductivity Sensor [4319A]" → model="4319A", name="Conductivity Sensor"
  const bracketMatch = itemName.match(/^(.+?)\s*\[(.+?)\]\s*$/);
  if (bracketMatch) {
    return { name: bracketMatch[1].trim(), modelName: bracketMatch[2].trim() };
  }
  // 괄호: "자동전압조절기(AVR)" → model="AVR", name="자동전압조절기"
  const parenMatch = itemName.match(/^(.+?)\s*\((.+?)\)\s*$/);
  if (parenMatch && parenMatch[2].length <= 30) {
    return { name: parenMatch[1].trim(), modelName: parenMatch[2].trim() };
  }
  // 모델번호 없으면 이름 자체를 modelName으로
  return { name: itemName.trim(), modelName: itemName.trim() };
}

interface ProductEntry {
  name: string;
  modelName: string;
  manufacturer: string;
  source: "inventory" | "repair" | "customer_asset";
}

async function collectProducts(): Promise<Map<string, ProductEntry>> {
  const productMap = new Map<string, ProductEntry>();

  const makeKey = (manufacturer: string, modelName: string) =>
    `${manufacturer.toLowerCase()}::${modelName.toLowerCase().replace(/\s+/g, "")}`;

  // 1) 수리관리(RepairOrder) — 제품 모델명이 명확한 소스
  const repairProducts = await prisma.repairOrder.findMany({
    where: { productName: { not: "" } },
    select: { productName: true, productMaker: true },
    distinct: ["productName", "productMaker"],
  });

  for (const rp of repairProducts) {
    if (!rp.productName) continue;
    const manufacturer = normalizeManufacturer(rp.productMaker);
    const modelName = rp.productName.trim().replace(/\r?\n/g, " ").replace(/\s+/g, " ");
    const key = makeKey(manufacturer, modelName);
    if (!productMap.has(key)) {
      productMap.set(key, {
        name: modelName,
        modelName,
        manufacturer,
        source: "repair",
      });
    }
  }

  // 2) 고객자산(CustomerAsset) — repair과 유사하지만 model 필드 활용
  const customerAssets = await prisma.customerAsset.findMany({
    where: { name: { not: "" } },
    select: { name: true, manufacturer: true, model: true },
    distinct: ["name", "manufacturer"],
  });

  for (const ca of customerAssets) {
    if (!ca.name) continue;
    const manufacturer = normalizeManufacturer(ca.manufacturer);
    const modelName = ca.name.trim().replace(/\r?\n/g, " ").replace(/\s+/g, " ");
    const key = makeKey(manufacturer, modelName);
    if (!productMap.has(key)) {
      productMap.set(key, {
        name: ca.model ? ca.model.trim() : modelName,
        modelName,
        manufacturer,
        source: "customer_asset",
      });
    }
  }

  // 3) 재고(InventoryItem) — 가장 많은 소스
  const inventoryItems = await prisma.inventoryItem.findMany({
    where: { itemName: { not: "" }, productMasterId: null },
    select: { itemName: true, manufacturer: true },
    distinct: ["itemName", "manufacturer"],
  });

  for (const inv of inventoryItems) {
    if (!inv.itemName) continue;
    const manufacturer = normalizeManufacturer(inv.manufacturer);
    const rawName = inv.itemName.trim().replace(/\r?\n/g, " ").replace(/\s+/g, " ");
    const { name, modelName } = extractModelName(rawName);
    const key = makeKey(manufacturer, modelName);
    if (!productMap.has(key)) {
      productMap.set(key, {
        name,
        modelName,
        manufacturer,
        source: "inventory",
      });
    }
  }

  return productMap;
}

async function main() {
  console.log("=== 장비마스터 통합 마이그레이션 시작 ===\n");

  // 기존 ProductMaster 확인
  const existingCount = await prisma.productMaster.count();
  console.log(`기존 ProductMaster 건수: ${existingCount}`);

  // 제품 정보 수집
  const productMap = await collectProducts();
  console.log(`\n수집된 고유 제품 수: ${productMap.size}`);

  // 소스별 통계
  const stats = { repair: 0, customer_asset: 0, inventory: 0 };
  for (const p of productMap.values()) {
    stats[p.source]++;
  }
  console.log(`  - 수리관리 출처: ${stats.repair}`);
  console.log(`  - 고객자산 출처: ${stats.customer_asset}`);
  console.log(`  - 재고 출처: ${stats.inventory}`);

  // 기존 ProductMaster의 키 세트 구성
  const existing = await prisma.productMaster.findMany({
    select: { id: true, manufacturer: true, modelName: true },
  });
  const existingKeys = new Set(
    existing.map((e) => `${e.manufacturer.toLowerCase()}::${e.modelName.toLowerCase().replace(/\s+/g, "")}`)
  );

  // 신규 항목만 필터링
  const toInsert: ProductEntry[] = [];
  for (const [key, entry] of productMap) {
    if (!existingKeys.has(key)) {
      toInsert.push(entry);
    }
  }

  console.log(`\n신규 등록 대상: ${toInsert.length}건 (기존과 중복 제외: ${productMap.size - toInsert.length}건)`);

  if (toInsert.length === 0) {
    console.log("등록할 신규 제품이 없습니다.");
    return;
  }

  // 배치 삽입 (100건씩)
  const BATCH_SIZE = 100;
  let inserted = 0;
  let skipped = 0;

  for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
    const batch = toInsert.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((entry) =>
        prisma.productMaster.create({
          data: {
            name: entry.name,
            modelName: entry.modelName,
            manufacturer: entry.manufacturer,
          },
        })
      )
    );

    for (const r of results) {
      if (r.status === "fulfilled") {
        inserted++;
      } else {
        skipped++;
        // unique constraint violation은 무시 (이미 존재)
        if (!r.reason?.message?.includes("Unique constraint")) {
          console.warn(`  WARN: ${r.reason?.message}`);
        }
      }
    }
    process.stdout.write(`  진행: ${Math.min(i + BATCH_SIZE, toInsert.length)}/${toInsert.length}\r`);
  }

  console.log(`\n\n=== ProductMaster 등록 완료 ===`);
  console.log(`  등록: ${inserted}건`);
  console.log(`  스킵(중복): ${skipped}건`);

  // ── FK 연결: InventoryItem.productMasterId 업데이트 ──
  console.log("\n=== 재고 항목 FK 연결 시작 ===");

  const allMasters = await prisma.productMaster.findMany({
    select: { id: true, manufacturer: true, modelName: true, name: true },
  });

  // 매스터 lookup 맵 구성
  const masterLookup = new Map<string, string>();
  for (const m of allMasters) {
    const key = `${m.manufacturer.toLowerCase()}::${m.modelName.toLowerCase().replace(/\s+/g, "")}`;
    masterLookup.set(key, m.id);
    // name도 별도 키로 추가 (name ≠ modelName인 경우)
    if (m.name !== m.modelName) {
      const nameKey = `${m.manufacturer.toLowerCase()}::${m.name.toLowerCase().replace(/\s+/g, "")}`;
      if (!masterLookup.has(nameKey)) {
        masterLookup.set(nameKey, m.id);
      }
    }
  }

  // 재고 항목 중 productMasterId가 없는 것들 연결
  const unlinkedInventory = await prisma.inventoryItem.findMany({
    where: { productMasterId: null, itemName: { not: "" } },
    select: { id: true, itemName: true, manufacturer: true },
  });

  let linked = 0;
  for (const inv of unlinkedInventory) {
    if (!inv.itemName) continue;
    const manufacturer = normalizeManufacturer(inv.manufacturer);
    const rawName = inv.itemName.trim().replace(/\r?\n/g, " ").replace(/\s+/g, " ");
    const { modelName } = extractModelName(rawName);
    const key = `${manufacturer.toLowerCase()}::${modelName.toLowerCase().replace(/\s+/g, "")}`;
    const masterId = masterLookup.get(key);

    // fallback: rawName 전체로도 시도
    const fallbackKey = `${manufacturer.toLowerCase()}::${rawName.toLowerCase().replace(/\s+/g, "")}`;
    const finalMasterId = masterId || masterLookup.get(fallbackKey);

    if (finalMasterId) {
      await prisma.inventoryItem.update({
        where: { id: inv.id },
        data: { productMasterId: finalMasterId },
      });
      linked++;
    }
  }

  console.log(`  재고 FK 연결: ${linked}/${unlinkedInventory.length}건`);

  // 최종 통계
  const finalCount = await prisma.productMaster.count();
  const linkedCount = await prisma.inventoryItem.count({ where: { productMasterId: { not: null } } });
  const totalInventory = await prisma.inventoryItem.count();

  console.log(`\n=== 최종 결과 ===`);
  console.log(`  ProductMaster 총 건수: ${finalCount}`);
  console.log(`  재고 FK 연결율: ${linkedCount}/${totalInventory} (${((linkedCount / totalInventory) * 100).toFixed(1)}%)`);
}

main()
  .catch((e) => {
    console.error("ERROR:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
