-- 게시판 design v2.0 (2026-05-22): 기능 요구 카테고리 추가
-- board_posts에 status/type/assignee/module/release/resolved 필드 추가

-- 1. enum 신규 생성
CREATE TYPE "FeatureRequestStatus" AS ENUM (
  'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'IN_PROGRESS',
  'COMPLETED', 'REJECTED', 'ON_HOLD'
);

CREATE TYPE "FeatureRequestType" AS ENUM (
  'BUG', 'NEW_FEATURE', 'IMPROVEMENT', 'UI_UX', 'DOCS', 'OTHER'
);

-- 2. board_posts 컬럼 추가 (모두 nullable, 기존 데이터 영향 없음)
ALTER TABLE "board_posts"
  ADD COLUMN "request_status"  "FeatureRequestStatus",
  ADD COLUMN "request_type"    "FeatureRequestType",
  ADD COLUMN "assignee_id"     TEXT,
  ADD COLUMN "module_area"     TEXT,
  ADD COLUMN "release_version" TEXT,
  ADD COLUMN "resolved_at"     TIMESTAMP(3);

-- 3. FK 제약 (담당자 → auth_users)
ALTER TABLE "board_posts"
  ADD CONSTRAINT "board_posts_assignee_id_fkey"
    FOREIGN KEY ("assignee_id") REFERENCES "auth_users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. 인덱스
CREATE INDEX "board_posts_request_status_idx" ON "board_posts"("request_status");
CREATE INDEX "board_posts_request_type_idx"   ON "board_posts"("request_type");
CREATE INDEX "board_posts_assignee_id_idx"    ON "board_posts"("assignee_id");
