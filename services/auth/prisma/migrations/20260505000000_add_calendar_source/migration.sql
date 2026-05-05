-- 회사달력 v1.2: 한국 공휴일 자동 갱신을 위한 source/externalId 컬럼 추가
-- 기존 row는 DEFAULT 'MANUAL'로 자동 백필됨

-- 1. 새 enum 타입
CREATE TYPE "CalendarEntrySource" AS ENUM ('MANUAL', 'KASI');

-- 2. 컬럼 추가 (기존 row는 source='MANUAL' 백필)
ALTER TABLE "company_calendar_entries"
  ADD COLUMN "source" "CalendarEntrySource" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "external_id" TEXT;

-- 3. 인덱스
--    source: sync 시 KASI row만 빠르게 SELECT
--    unique(source, external_id): KASI 멱등 upsert 키 (NULL은 unique 제약 면제 — MANUAL은 외부 ID 없음)
CREATE INDEX "company_calendar_entries_source_idx"
  ON "company_calendar_entries"("source");

CREATE UNIQUE INDEX "company_calendar_entries_source_external_id_key"
  ON "company_calendar_entries"("source", "external_id");
