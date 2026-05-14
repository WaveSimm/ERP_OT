-- =========================================================
-- 발주번호 일괄 재채번 (PO-YYYY-NNNN → PO-YYMM-NNNN)
-- 2026-05-14
-- =========================================================
BEGIN;

-- Step 1: 매핑 테이블 (id, 기존번호, 새번호) 생성
--   순서: COALESCE(order_date, created_at)의 YYMM 기준 partition, 같은 월 내에서 날짜·id 순으로 sequence
CREATE TEMP TABLE order_renumber_map AS
SELECT
  id,
  order_number AS old_number,
  'PO-' ||
    LPAD(((EXTRACT(YEAR FROM COALESCE(order_date, created_at)) - 2000)::int)::text, 2, '0') ||
    LPAD((EXTRACT(MONTH FROM COALESCE(order_date, created_at))::int)::text, 2, '0') ||
    '-' ||
    LPAD(
      (ROW_NUMBER() OVER (
        PARTITION BY
          EXTRACT(YEAR FROM COALESCE(order_date, created_at)),
          EXTRACT(MONTH FROM COALESCE(order_date, created_at))
        ORDER BY COALESCE(order_date, created_at), id
      ))::text,
      4, '0'
    ) AS new_number
FROM equipment.overseas_orders;

-- Step 2: 검증 — 중복·NULL 없는지
DO $$
DECLARE
  dup_count int;
  null_count int;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM (SELECT new_number, COUNT(*) c FROM order_renumber_map GROUP BY new_number HAVING COUNT(*) > 1) t;
  SELECT COUNT(*) INTO null_count FROM order_renumber_map WHERE new_number IS NULL OR new_number ~ 'PO-..--';
  IF dup_count > 0 THEN
    RAISE EXCEPTION 'New order numbers have duplicates: %', dup_count;
  END IF;
  IF null_count > 0 THEN
    RAISE EXCEPTION 'New order numbers have NULL/invalid: %', null_count;
  END IF;
END $$;

-- Step 3: 2단계 update (UNIQUE 제약 회피)
-- 3-1. 임시값으로 치환
UPDATE equipment.overseas_orders o
SET order_number = 'TMP-' || o.id
FROM order_renumber_map m
WHERE o.id = m.id AND o.order_number = m.old_number;

-- 3-2. 새 번호로 update
UPDATE equipment.overseas_orders o
SET order_number = m.new_number
FROM order_renumber_map m
WHERE o.id = m.id;

-- Step 4: 결재 문서 title 동기화 (예: "구매발주서 - PO-2026-0265 (AADI)" → "구매발주서 - PO-2605-0001 (AADI)")
UPDATE approval.approval_documents d
SET title = REPLACE(title, m.old_number, m.new_number)
FROM order_renumber_map m
WHERE d.title LIKE '%' || m.old_number || '%';

-- Step 5: 결재 문서 content JSON의 orderNumber 동기화
UPDATE approval.approval_documents d
SET content = jsonb_set(
  d.content::jsonb,
  '{orderNumber}',
  to_jsonb(m.new_number)
)
FROM order_renumber_map m
WHERE d.content IS NOT NULL
  AND (d.content::jsonb->>'orderNumber') = m.old_number;

-- Step 6: 결과 요약
SELECT
  (SELECT COUNT(*) FROM order_renumber_map) AS total_orders_renumbered,
  (SELECT COUNT(*) FROM equipment.overseas_orders WHERE order_number LIKE 'PO-____-____') AS new_format_count,
  (SELECT COUNT(*) FROM equipment.overseas_orders WHERE order_number LIKE 'TMP-%') AS leftover_tmp;

COMMIT;
