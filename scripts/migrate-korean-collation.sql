-- ============================================================
-- 한글 정렬 collation 마이그레이션 (2026-05-19)
-- ============================================================
--
-- 문제: DB collation이 en_US.utf8 — 한글 정렬 시 글자수 → 자모순으로
--      이상하게 정렬됨 (예: departments.name "임원" → "기술팀" → "재무팀")
--
-- 해결: 한글 정렬 대상 컬럼(60개)에 ICU "ko-KR-x-icu" collation 적용
--      → 사전식(가나다) 정렬 + 한자·숫자 자연 정렬 + 향후 확장성
--
-- 영향: 정렬 결과만 변경 (기능 동작·검색·LIKE 등은 영향 없음)
-- 위험: pre-prod 단계 데이터 → 인덱스 재구축 짧은 락만 발생
-- 백업: backups/manual/pre-collation-YYYYMMDD-HHMMSS.sql.gz
-- ============================================================

BEGIN;

-- 1. ICU collation version mismatch 해소 (경고 제거)
ALTER COLLATION pg_catalog."ko-KR-x-icu" REFRESH VERSION;

-- 2. approval schema (2개)
ALTER TABLE approval.approval_documents  ALTER COLUMN title TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE approval.approval_templates  ALTER COLUMN name  TYPE TEXT COLLATE "ko-KR-x-icu";

-- 3. attendance schema (2개)
ALTER TABLE attendance.notifications     ALTER COLUMN title TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE attendance.public_holidays   ALTER COLUMN name  TYPE TEXT COLLATE "ko-KR-x-icu";

-- 4. equipment schema (30개)
ALTER TABLE equipment.asset_cost_events    ALTER COLUMN title         TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE equipment.asset_schedules      ALTER COLUMN title         TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE equipment.categories           ALTER COLUMN name          TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE equipment.contracts            ALTER COLUMN manufacturer  TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE equipment.contracts            ALTER COLUMN name          TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE equipment.cost_extras          ALTER COLUMN name          TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE equipment.cost_items           ALTER COLUMN name          TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE equipment.customer_assets      ALTER COLUMN manufacturer  TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE equipment.customer_assets      ALTER COLUMN name          TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE equipment.customer_contacts    ALTER COLUMN name          TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE equipment.customers            ALTER COLUMN "contactPerson" TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE equipment.customers            ALTER COLUMN name          TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE equipment.deployment_templates ALTER COLUMN name          TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE equipment.equipment            ALTER COLUMN manufacturer  TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE equipment.equipment            ALTER COLUMN name          TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE equipment.equipment_components ALTER COLUMN name          TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE equipment.inventory_audits     ALTER COLUMN name          TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE equipment.inventory_items      ALTER COLUMN manufacturer  TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE equipment.maintenance_records  ALTER COLUMN title         TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE equipment.overseas_order_items ALTER COLUMN name          TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE equipment.overseas_orders      ALTER COLUMN manufacturer  TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE equipment.parts                ALTER COLUMN manufacturer  TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE equipment.parts                ALTER COLUMN name          TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE equipment.product_masters      ALTER COLUMN manufacturer  TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE equipment.product_masters      ALTER COLUMN name          TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE equipment.sensors              ALTER COLUMN manufacturer  TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE equipment.sensors              ALTER COLUMN name          TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE equipment.storage_locations    ALTER COLUMN name          TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE equipment.supplier_contacts    ALTER COLUMN name          TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE equipment.suppliers            ALTER COLUMN name          TYPE TEXT COLLATE "ko-KR-x-icu";

-- 5. expense schema (5개)
ALTER TABLE expense.settlements   ALTER COLUMN title          TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE expense.sources       ALTER COLUMN "displayName"  TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE expense.sources       ALTER COLUMN name           TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE expense.transactions  ALTER COLUMN "contractName" TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE expense.transactions  ALTER COLUMN "merchantName" TYPE TEXT COLLATE "ko-KR-x-icu";

-- 6. ocr schema (1개)
ALTER TABLE ocr.document_templates ALTER COLUMN name TYPE TEXT COLLATE "ko-KR-x-icu";

-- 7. project schema (14개)
ALTER TABLE project.equipment_reservations  ALTER COLUMN title TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE project.equipment_resources     ALTER COLUMN name  TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE project.external_persons        ALTER COLUMN name  TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE project.project_baselines       ALTER COLUMN name  TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE project.project_folders         ALTER COLUMN name  TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE project.project_groups          ALTER COLUMN name  TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE project.project_templates       ALTER COLUMN name  TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE project.projects                ALTER COLUMN name  TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE project.resource_groups         ALTER COLUMN name  TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE project.task_baseline_segments  ALTER COLUMN name  TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE project.task_segments           ALTER COLUMN name  TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE project.tasks                   ALTER COLUMN name  TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE project.template_segments       ALTER COLUMN name  TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE project.template_tasks          ALTER COLUMN name  TYPE TEXT COLLATE "ko-KR-x-icu";

-- 8. public schema — auth/board/calendar/departments (6개)
ALTER TABLE public.auth_users               ALTER COLUMN name  TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE public.board_categories         ALTER COLUMN name  TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE public.board_posts              ALTER COLUMN title TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE public.boards                   ALTER COLUMN name  TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE public.company_calendar_entries ALTER COLUMN title TYPE TEXT COLLATE "ko-KR-x-icu";
ALTER TABLE public.departments              ALTER COLUMN name  TYPE TEXT COLLATE "ko-KR-x-icu";

COMMIT;

-- ============================================================
-- 검증 쿼리 (적용 후 수동 실행)
-- ============================================================
-- SELECT name FROM equipment.customers ORDER BY name ASC LIMIT 20;
-- SELECT name FROM public.departments ORDER BY name ASC LIMIT 15;
-- SELECT name FROM equipment.suppliers ORDER BY name ASC LIMIT 15;
