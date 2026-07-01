-- 자원-기여도-진척률 (2026-06-23)
-- SegmentAssignment 에 분담율(contributionWeight) + 자원 본인 진척률(progressPercent) 추가
-- TaskSegment.progressPercent 는 배정 derived 캐시로 의미 변경 (컬럼 자체는 유지)

-- AlterTable
ALTER TABLE "project"."segment_assignments"
  ADD COLUMN     "contributionWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN     "progressPercent" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Backfill 1: 세그먼트별 기존 배정에 분담율 균등 분배 (100 / 세그먼트 내 배정 수)
UPDATE "project"."segment_assignments" sa
SET "contributionWeight" = 100.0 / c.cnt
FROM (
  SELECT "segmentId", COUNT(*)::float AS cnt
  FROM "project"."segment_assignments"
  GROUP BY "segmentId"
) c
WHERE sa."segmentId" = c."segmentId" AND c.cnt > 0;

-- Backfill 2: 각 배정의 본인 진척률 = 소속 세그먼트의 현재 진척률 (표시값 연속성 보장)
UPDATE "project"."segment_assignments" sa
SET "progressPercent" = ts."progressPercent"
FROM "project"."task_segments" ts
WHERE sa."segmentId" = ts."id";
