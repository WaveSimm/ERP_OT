-- ============================================================
-- 기관(Customer) 중복 의심
-- ============================================================
-- 정규화: ㈜, (주), 주식회사, 괄호, 공백, 하이픈, 점 제거 + lowercase
WITH norm_cust AS (
  SELECT
    id, name,
    lower(regexp_replace(
      regexp_replace(name, '(㈜|\(주\)|주식회사|\(.+?\))', '', 'g'),
      '[\s\-_.·,\(\)㈜]', '', 'g'
    )) AS norm,
    created_at
  FROM equipment.customers
)
SELECT
  '기관 중복 의심' AS kind,
  norm,
  string_agg(name || ' [' || substr(id, 1, 12) || ']', ' | ' ORDER BY name) AS duplicates
FROM norm_cust
WHERE norm != ''
GROUP BY norm
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC, norm
LIMIT 50;

-- ============================================================
-- 고객 담당자(CustomerContact) 중복 의심 — 같은 기관 내
-- ============================================================
WITH norm_cont AS (
  SELECT
    cc.id AS cc_id, cc.name, c.name AS org_name, cc."customerId",
    lower(regexp_replace(cc.name, '[\s\-_.·,\(\)]', '', 'g')) AS norm_name,
    cc.id LIKE 'migcc_%' AS is_migrated
  FROM equipment.customer_contacts cc
  JOIN equipment.customers c ON c.id = cc."customerId"
)
SELECT
  '동일 기관 내 담당자 중복' AS kind,
  org_name || ' / ' || norm_name AS key,
  string_agg(name || ' [' || substr(cc_id, 1, 12) || ']', ' | ') AS duplicates
FROM norm_cont
WHERE norm_name != ''
GROUP BY org_name, norm_name, "customerId"
HAVING COUNT(*) > 1
ORDER BY org_name
LIMIT 50;

-- ============================================================
-- 노이즈 의심: 전화번호/회사명/직책명으로 보이는 담당자명
-- ============================================================
SELECT
  '의심 담당자명 (노이즈)' AS kind,
  c.name AS org_name,
  cc.name AS contact_name,
  cc.id,
  CASE
    WHEN cc.name ~ '^[\d\-\s\(\)]+$' THEN 'phone/digits'
    WHEN cc.name ~ '(교수|박사|대리|과장|부장|사장|대표|이사|실장|팀장|주임|연구원)님?$' THEN 'title-only'
    WHEN cc.name ~ '(주식회사|㈜|\(주\)|기술단|연구소|회사|산업|공사)' THEN 'company-like'
    WHEN length(cc.name) <= 2 THEN 'too-short'
    WHEN length(cc.name) >= 15 THEN 'too-long'
    ELSE 'other'
  END AS reason
FROM equipment.customer_contacts cc
JOIN equipment.customers c ON c.id = cc."customerId"
WHERE
  cc.name ~ '^[\d\-\s\(\)]+$'
  OR cc.name ~ '(교수|박사|대리|과장|부장|사장|대표|이사|실장|팀장|주임|연구원)님?$'
  OR cc.name ~ '(주식회사|㈜|\(주\)|기술단|연구소|회사|산업|공사)'
  OR length(cc.name) <= 2
  OR length(cc.name) >= 15
ORDER BY reason, org_name
LIMIT 100;
