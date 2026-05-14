-- =========================================================
-- Product Master 중복 정리 (2026-05-14)
-- CSV: References/product-master-cleanup-20260514.csv
-- =========================================================
BEGIN;

-- ----------------------------------------------------------
-- 1. MERGE: CT3919 RJE -> AADI
--   (variant 1, stock 1, order 2, bom 1)
-- ----------------------------------------------------------
UPDATE equipment.inventory_items       SET product_master_id='cmntcmntq000l10kd766kc6d6' WHERE product_master_id='cmntcmntw001l10kd9zn61fmn';
UPDATE equipment.overseas_order_items  SET product_master_id='cmntcmntq000l10kd766kc6d6' WHERE product_master_id='cmntcmntw001l10kd9zn61fmn';
UPDATE equipment.product_variants      SET product_master_id='cmntcmntq000l10kd766kc6d6' WHERE product_master_id='cmntcmntw001l10kd9zn61fmn';
UPDATE equipment.bom_items             SET product_master_id='cmntcmntq000l10kd766kc6d6' WHERE product_master_id='cmntcmntw001l10kd9zn61fmn';
DELETE FROM equipment.product_masters WHERE id='cmntcmntw001l10kd9zn61fmn';

-- ----------------------------------------------------------
-- 2. MERGE: CT4319 Teledyne Benthos -> JW Fishers (survivor)
-- ----------------------------------------------------------
UPDATE equipment.inventory_items       SET product_master_id='cmntcmntv001f10kdtnonntdl' WHERE product_master_id='cmntcmntw001m10kduyr3wuqj';
UPDATE equipment.overseas_order_items  SET product_master_id='cmntcmntv001f10kdtnonntdl' WHERE product_master_id='cmntcmntw001m10kduyr3wuqj';
UPDATE equipment.product_variants      SET product_master_id='cmntcmntv001f10kdtnonntdl' WHERE product_master_id='cmntcmntw001m10kduyr3wuqj';
UPDATE equipment.bom_items             SET product_master_id='cmntcmntv001f10kdtnonntdl' WHERE product_master_id='cmntcmntw001m10kduyr3wuqj';
DELETE FROM equipment.product_masters WHERE id='cmntcmntw001m10kduyr3wuqj';

-- ----------------------------------------------------------
-- 3. RENAME: CT4319 JW Fishers -> AADI (survivor)
-- ----------------------------------------------------------
UPDATE equipment.product_masters SET manufacturer='AADI' WHERE id='cmntcmntv001f10kdtnonntdl';

-- ----------------------------------------------------------
-- 4. MERGE: Unknown 5건 -> 정본
-- ----------------------------------------------------------
-- 5819A Unknown -> AADI
UPDATE equipment.inventory_items      SET product_master_id='cmntcmnvr008q10kdficulxfb' WHERE product_master_id='cmntcmnwa00cg10kdhn6segm3';
UPDATE equipment.overseas_order_items SET product_master_id='cmntcmnvr008q10kdficulxfb' WHERE product_master_id='cmntcmnwa00cg10kdhn6segm3';
UPDATE equipment.product_variants     SET product_master_id='cmntcmnvr008q10kdficulxfb' WHERE product_master_id='cmntcmnwa00cg10kdhn6segm3';
UPDATE equipment.bom_items            SET product_master_id='cmntcmnvr008q10kdficulxfb' WHERE product_master_id='cmntcmnwa00cg10kdhn6segm3';
DELETE FROM equipment.product_masters WHERE id='cmntcmnwa00cg10kdhn6segm3';

-- CR-1000X Unknown -> Campbell
UPDATE equipment.inventory_items      SET product_master_id='cmntcmnx600ig10kdyvgi2dth' WHERE product_master_id='cmntcmnx600ie10kd0y498xum';
UPDATE equipment.overseas_order_items SET product_master_id='cmntcmnx600ig10kdyvgi2dth' WHERE product_master_id='cmntcmnx600ie10kd0y498xum';
UPDATE equipment.product_variants     SET product_master_id='cmntcmnx600ig10kdyvgi2dth' WHERE product_master_id='cmntcmnx600ie10kd0y498xum';
UPDATE equipment.bom_items            SET product_master_id='cmntcmnx600ig10kdyvgi2dth' WHERE product_master_id='cmntcmnx600ie10kd0y498xum';
DELETE FROM equipment.product_masters WHERE id='cmntcmnx600ie10kd0y498xum';

-- Dissolved Oxygen Blue Membrane Cap Unknown -> Idronaut
UPDATE equipment.inventory_items      SET product_master_id='cmntcmnxe00jg10kdgqqe60k0' WHERE product_master_id='cmntcmnwz00gv10kdey4ya62w';
UPDATE equipment.overseas_order_items SET product_master_id='cmntcmnxe00jg10kdgqqe60k0' WHERE product_master_id='cmntcmnwz00gv10kdey4ya62w';
UPDATE equipment.product_variants     SET product_master_id='cmntcmnxe00jg10kdgqqe60k0' WHERE product_master_id='cmntcmnwz00gv10kdey4ya62w';
UPDATE equipment.bom_items            SET product_master_id='cmntcmnxe00jg10kdgqqe60k0' WHERE product_master_id='cmntcmnwz00gv10kdey4ya62w';
DELETE FROM equipment.product_masters WHERE id='cmntcmnwz00gv10kdey4ya62w';

-- For Seaguard / Battery Case Unknown -> AADI
UPDATE equipment.inventory_items      SET product_master_id='cmntcmnxn00lm10kdsupp2y53' WHERE product_master_id='cmntcmnwc00cp10kdklgny1s5';
UPDATE equipment.overseas_order_items SET product_master_id='cmntcmnxn00lm10kdsupp2y53' WHERE product_master_id='cmntcmnwc00cp10kdklgny1s5';
UPDATE equipment.product_variants     SET product_master_id='cmntcmnxn00lm10kdsupp2y53' WHERE product_master_id='cmntcmnwc00cp10kdklgny1s5';
UPDATE equipment.bom_items            SET product_master_id='cmntcmnxn00lm10kdsupp2y53' WHERE product_master_id='cmntcmnwc00cp10kdklgny1s5';
DELETE FROM equipment.product_masters WHERE id='cmntcmnwc00cp10kdklgny1s5';

-- MCBH-2-FS TI Unknown -> LANHE
UPDATE equipment.inventory_items      SET product_master_id='cmntcmnvw009n10kd0gwedj1n' WHERE product_master_id='cmntcmnwa00ch10kdoc0m6jfs';
UPDATE equipment.overseas_order_items SET product_master_id='cmntcmnvw009n10kd0gwedj1n' WHERE product_master_id='cmntcmnwa00ch10kdoc0m6jfs';
UPDATE equipment.product_variants     SET product_master_id='cmntcmnvw009n10kd0gwedj1n' WHERE product_master_id='cmntcmnwa00ch10kdoc0m6jfs';
UPDATE equipment.bom_items            SET product_master_id='cmntcmnvw009n10kd0gwedj1n' WHERE product_master_id='cmntcmnwa00ch10kdoc0m6jfs';
DELETE FROM equipment.product_masters WHERE id='cmntcmnwa00ch10kdoc0m6jfs';

-- ----------------------------------------------------------
-- 5. RENAME (other): 5건
-- ----------------------------------------------------------
-- 2TB SSD 삼성SAMSUNG -> SAMSUNG
UPDATE equipment.product_masters SET manufacturer='SAMSUNG' WHERE id='cmntcmnx400hy10kd0ssqfka6';
-- 2TB SANDISK: name 샌디스크 외장 SSD -> SSD
UPDATE equipment.product_masters SET name='SSD' WHERE id='cmntcmnx200hi10kdzcey37e8';
-- A43 Antenna HEMISPHERE -> A43 / GPS ANTENNA
UPDATE equipment.product_masters SET model_name='A43', name='GPS ANTENNA' WHERE id='cmntcmnxa00je10kd8d6qoxgx';
-- A43 Antenna Oceaneering -> A43 / GPS ANTENNA
UPDATE equipment.product_masters SET model_name='A43', name='GPS ANTENNA' WHERE id='cmntcmnvf006810kdk1t46vs6';
-- T50-P Teledyne Marine: name T50-P -> Seabat
UPDATE equipment.product_masters SET name='Seabat' WHERE id='cmntcmntt001510kdu8epi6no';

-- ----------------------------------------------------------
-- 6. DELETE: 21건 (참조 없는 빈 마스터)
-- ----------------------------------------------------------
DELETE FROM equipment.product_masters WHERE id IN (
  'cmntcmntx001u10kdx97efny0',  -- CT3919 JW Fishers
  'cmntcmntr000r10kdoh9mm0u6',  -- CT3919 Metocean
  'cmntcmntz002c10kd2s8npr20',  -- CT3919 Teledyne Benthos
  'cmntcmntt000z10kdiqqqa4oa',  -- CT3919 ZEBRA TECH
  'cmntcmntp000g10kdlvqlylhb',  -- CT3919A Unknown
  'cmntcmntq000m10kdm7okv1zj',  -- CT4319A Unknown
  'cmntcmntu001910kddi8mo2d3',  -- CTD Teledyne Benthos
  'cmntcmntn000a10kd00k1uocf',  -- CTD304 MIROS
  'cmntcmntx001z10kduvy14335',  -- CTD304 Plus KOAST
  'cmntcmnty002410kd0yzh6qzc',  -- CTD304 Plus MIROS
  'cmntcmntx001v10kdo9tyr84e',  -- CTD 305 KOAST
  'cmntcmntx001q10kdi537ymdi',  -- CTD310 AADI
  'cmntcmntz002710kdix36thxg',  -- DHI-1 (Gun_Diver) Unknown
  'cmntcmnti000610kdy9on7ajq',  -- Phins Unknown
  'cmntcmntz002g10kdqly8fz22',  -- SeaSonde Transmitter JW Fishers
  'cmntcmntz002b10kdnyi8rxq6',  -- SM-094 JW Fishers
  'cmntcmntz002e10kdt6htuonv',  -- SM-140 JW Fishers
  'cmntcmntn000b10kd9zypx37x',  -- UPR AADI
  'cmntcmntz002910kdoaxqq5rx',  -- UPR CODAR
  'cmntcmntz002d10kd8xcohn6s',  -- UPR Idronaut
  'cmntcmntu001710kdiqgg9yt0'   -- UPR Unknown
);

-- ----------------------------------------------------------
-- 7. 검증: 결과 카운트
-- ----------------------------------------------------------
SELECT
  (SELECT COUNT(*) FROM equipment.product_masters) AS total_masters_after,
  (SELECT COUNT(*) FROM equipment.inventory_items WHERE product_master_id IS NULL) AS orphan_inventory,
  (SELECT COUNT(*) FROM equipment.overseas_order_items WHERE product_master_id IS NULL) AS orphan_order_items;

COMMIT;
