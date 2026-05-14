#!/usr/bin/env node
/**
 * Inventory v1.6 마이그레이션 스크립트 (2026-05-13)
 *
 * 기존 데이터를 v1.6 모델로 보강:
 *   1. 각 ProductMaster에 "default" ProductVariant 생성 (없는 경우)
 *   2. variant_id가 비어있는 InventoryItem에 default variant id 채움
 *   3. current_location 있는 InventoryItem에 InventoryItemLocation row 백필
 *   4. tracking_mode 일관성 보정 (serial 있으면 INDIVIDUAL)
 *
 * 사용법:
 *   node scripts/inventory-v1.6-migrate.mjs --dry-run    (기본, 변경 없음)
 *   node scripts/inventory-v1.6-migrate.mjs --apply       (실제 적용)
 *   node scripts/inventory-v1.6-migrate.mjs --verify      (마이그레이션 후 검증)
 */

import { execFileSync } from "node:child_process";

const PG_CONTAINER = process.env.PG_CONTAINER || "erp-ot-postgres";
const PG_USER = process.env.PG_USER || "erp_user";
const PG_DB = process.env.PG_DB || "erp_ot";

const mode = process.argv.includes("--apply")
  ? "apply"
  : process.argv.includes("--verify")
  ? "verify"
  : "dry-run";

function psql(sql, { format = "table" } = {}) {
  const args = ["exec", "-i", PG_CONTAINER, "psql", "-U", PG_USER, "-d", PG_DB];
  if (format === "csv") args.push("-At", "-F", ",");
  else if (format === "raw") args.push("-At");
  else args.push("-x");
  args.push("-c", sql);
  return execFileSync("docker", args, { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
}

function logSection(title) {
  console.log("\n" + "─".repeat(60));
  console.log(`  ${title}`);
  console.log("─".repeat(60));
}

// ─── 통계 함수 ─────────────────────────────────────────────
function getStats() {
  const stats = psql(`
    SELECT
      (SELECT COUNT(*) FROM equipment.inventory_items) AS total_items,
      (SELECT COUNT(*) FROM equipment.inventory_items WHERE variant_id IS NULL) AS no_variant,
      (SELECT COUNT(*) FROM equipment.inventory_items WHERE current_location IS NOT NULL AND current_location != '') AS with_location_text,
      (SELECT COUNT(*) FROM equipment.inventory_item_locations) AS location_rows,
      (SELECT COUNT(*) FROM equipment.product_masters) AS total_masters,
      (SELECT COUNT(*) FROM equipment.product_variants) AS total_variants,
      (SELECT COUNT(DISTINCT product_master_id) FROM equipment.product_variants) AS masters_with_variants,
      (SELECT COUNT(*) FROM equipment.storage_locations) AS storage_locations,
      (SELECT COALESCE(SUM(quantity), 0) FROM equipment.inventory_items WHERE current_status = 'IN_STOCK') AS total_qty_in_stock
    ;
  `, { format: "raw" });
  return stats;
}

// ─── Dry-run / Apply 분석 ─────────────────────────────────────
function analyzeMasters() {
  logSection("Phase A — Master별 inventory 분포");
  const out = psql(`
    SELECT
      pm.id,
      pm.name,
      pm.model_name,
      COUNT(ii.id) AS inventory_count,
      COUNT(DISTINCT pv.id) AS variant_count
    FROM equipment.product_masters pm
    LEFT JOIN equipment.inventory_items ii ON ii.product_master_id = pm.id
    LEFT JOIN equipment.product_variants pv ON pv.product_master_id = pm.id
    GROUP BY pm.id, pm.name, pm.model_name
    HAVING COUNT(ii.id) > 0
    ORDER BY COUNT(ii.id) DESC
    LIMIT 20;
  `);
  console.log(out);
}

function analyzeOrphanInventory() {
  logSection("Phase B — variant_id NULL인 inventory_items 분포");
  const out = psql(`
    SELECT
      COUNT(*) FILTER (WHERE product_master_id IS NOT NULL) AS has_master,
      COUNT(*) FILTER (WHERE product_master_id IS NULL) AS no_master,
      COUNT(*) FILTER (WHERE current_location IS NOT NULL AND current_location != '') AS with_location,
      COUNT(*) FILTER (WHERE serial_number IS NOT NULL) AS has_serial,
      COUNT(*) FILTER (WHERE tracking_mode = 'INDIVIDUAL' AND serial_number IS NULL) AS individual_no_serial,
      COUNT(*) FILTER (WHERE tracking_mode = 'BULK' AND serial_number IS NOT NULL) AS bulk_with_serial
    FROM equipment.inventory_items
    WHERE variant_id IS NULL;
  `);
  console.log(out);
}

function analyzeLocationCoverage() {
  logSection("Phase C — current_location 텍스트 vs storage_locations 매칭");
  const out = psql(`
    WITH location_map AS (
      SELECT
        ii.current_location AS loc_name,
        COUNT(*) AS item_count,
        (SELECT sl.id FROM equipment.storage_locations sl WHERE sl.name = ii.current_location LIMIT 1) AS matched_id
      FROM equipment.inventory_items ii
      WHERE ii.current_location IS NOT NULL AND ii.current_location != ''
      GROUP BY ii.current_location
    )
    SELECT
      loc_name,
      item_count,
      CASE WHEN matched_id IS NOT NULL THEN '✓' ELSE 'X' END AS matched
    FROM location_map
    ORDER BY item_count DESC
    LIMIT 30;
  `);
  console.log(out);
}

// ─── Apply ─────────────────────────────────────────────
function applyMigration() {
  logSection("APPLY — 1) Default Variant 생성");

  const created = psql(`
    INSERT INTO equipment.product_variants (id, product_master_id, sku_code, variant_specs, is_active, created_at, updated_at)
    SELECT
      'pv_' || substr(md5(pm.id || '_default'), 1, 22) AS id,
      pm.id,
      CASE WHEN pm.master_code IS NOT NULL THEN pm.master_code || '-DEFAULT' ELSE NULL END,
      '{}'::jsonb,
      true,
      NOW(),
      NOW()
    FROM equipment.product_masters pm
    WHERE NOT EXISTS (SELECT 1 FROM equipment.product_variants pv WHERE pv.product_master_id = pm.id)
      AND EXISTS (SELECT 1 FROM equipment.inventory_items ii WHERE ii.product_master_id = pm.id AND ii.variant_id IS NULL)
    RETURNING id;
  `, { format: "raw" });
  const createdCount = created.trim().split("\n").filter(Boolean).length;
  console.log(`  생성된 default Variant: ${createdCount}개`);

  logSection("APPLY — 2) inventory_items.variant_id 백필");
  const linked = psql(`
    WITH default_variants AS (
      SELECT DISTINCT ON (product_master_id) id, product_master_id
      FROM equipment.product_variants
      WHERE variant_specs = '{}'::jsonb
      ORDER BY product_master_id, created_at ASC
    )
    UPDATE equipment.inventory_items ii
    SET variant_id = dv.id, updated_at = NOW()
    FROM default_variants dv
    WHERE ii.product_master_id = dv.product_master_id AND ii.variant_id IS NULL
    RETURNING ii.id;
  `, { format: "raw" });
  const linkedCount = linked.trim().split("\n").filter(Boolean).length;
  console.log(`  variant_id 채움: ${linkedCount}건`);

  logSection("APPLY — 3) InventoryItemLocation 백필 (현재 quantity 기준)");
  const located = psql(`
    INSERT INTO equipment.inventory_item_locations (id, inventory_item_id, location_id, quantity, created_at, updated_at)
    SELECT
      'iil_' || substr(md5(ii.id || COALESCE(sl.id, '')), 1, 22),
      ii.id,
      sl.id,
      ii.quantity,
      NOW(),
      NOW()
    FROM equipment.inventory_items ii
    JOIN equipment.storage_locations sl ON sl.name = ii.current_location
    WHERE ii.current_location IS NOT NULL AND ii.current_location != ''
      AND ii.quantity > 0
      AND NOT EXISTS (SELECT 1 FROM equipment.inventory_item_locations iil WHERE iil.inventory_item_id = ii.id)
    RETURNING id;
  `, { format: "raw" });
  const locCount = located.trim().split("\n").filter(Boolean).length;
  console.log(`  InventoryItemLocation 백필: ${locCount}건`);

  logSection("APPLY — 4) tracking_mode 보정 (serial_number 있으면 INDIVIDUAL)");
  const fixedIndiv = psql(`
    UPDATE equipment.inventory_items
    SET tracking_mode = 'INDIVIDUAL', updated_at = NOW()
    WHERE serial_number IS NOT NULL AND tracking_mode != 'INDIVIDUAL'
    RETURNING id;
  `, { format: "raw" });
  const fixedCount = fixedIndiv.trim().split("\n").filter(Boolean).length;
  console.log(`  tracking_mode 보정: ${fixedCount}건`);

  console.log("\n✓ 마이그레이션 완료\n");
}

// ─── Verify ─────────────────────────────────────────────
function verify() {
  logSection("VERIFY — 최종 상태");
  const final = psql(`
    SELECT
      (SELECT COUNT(*) FROM equipment.inventory_items) AS total_items,
      (SELECT COUNT(*) FROM equipment.inventory_items WHERE variant_id IS NULL) AS still_no_variant,
      (SELECT COUNT(*) FROM equipment.inventory_items WHERE variant_id IS NULL AND product_master_id IS NOT NULL) AS no_variant_with_master,
      (SELECT COUNT(*) FROM equipment.product_variants) AS total_variants,
      (SELECT COUNT(*) FROM equipment.inventory_item_locations) AS location_rows,
      (SELECT COUNT(DISTINCT inventory_item_id) FROM equipment.inventory_item_locations) AS items_with_locations,
      (SELECT COUNT(*) FROM equipment.inventory_items WHERE current_location IS NOT NULL AND current_location != '' AND id NOT IN (SELECT inventory_item_id FROM equipment.inventory_item_locations)) AS unmatched_locations
    ;
  `, { format: "raw" });
  console.log(final);

  logSection("VERIFY — 합계 일치 확인 (quantity vs location quantity sum)");
  const mismatch = psql(`
    WITH item_totals AS (
      SELECT
        ii.id,
        ii.quantity AS item_qty,
        COALESCE(SUM(iil.quantity), 0) AS location_qty
      FROM equipment.inventory_items ii
      LEFT JOIN equipment.inventory_item_locations iil ON iil.inventory_item_id = ii.id
      GROUP BY ii.id
    )
    SELECT
      COUNT(*) AS mismatch_count,
      COUNT(*) FILTER (WHERE location_qty = 0) AS no_location_rows
    FROM item_totals
    WHERE item_qty != location_qty;
  `);
  console.log(mismatch);
}

// ─── Main ─────────────────────────────────────────────
console.log(`\n🔧 Inventory v1.6 Migration — mode: ${mode}\n`);
console.log("=== 현재 상태 ===");
console.log(getStats());

if (mode === "dry-run") {
  console.log("\n[DRY-RUN MODE] 분석만 수행, 변경 없음");
  analyzeMasters();
  analyzeOrphanInventory();
  analyzeLocationCoverage();
  console.log("\n실제 적용: node scripts/inventory-v1.6-migrate.mjs --apply");
} else if (mode === "apply") {
  console.log("\n⚠️  실제 데이터 변경 모드");
  applyMigration();
  console.log("\n=== 적용 후 상태 ===");
  console.log(getStats());
  console.log("\n검증: node scripts/inventory-v1.6-migrate.mjs --verify");
} else if (mode === "verify") {
  verify();
}
