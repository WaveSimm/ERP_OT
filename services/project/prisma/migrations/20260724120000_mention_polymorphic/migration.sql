-- 폴리모픽 멘션 전환: mentions.commentId → (sourceType, sourceId)
--   기존 mentions 0행이라 데이터 이관은 사실상 no-op(안전).
--   FK 관계 제거(대상이 여러 테이블 + 향후 크로스서비스) — 삭제 정합은 앱에서 처리.

-- 1) 기존 FK / 유니크 제거
ALTER TABLE "project"."mentions" DROP CONSTRAINT "mentions_commentId_fkey";
DROP INDEX "project"."mentions_commentId_userId_key";

-- 2) 신규 컬럼 추가 (임시 default로 기존행 방어 → 이후 default 제거)
ALTER TABLE "project"."mentions"
  ADD COLUMN "sourceType" TEXT NOT NULL DEFAULT 'COMMENT',
  ADD COLUMN "sourceId"   TEXT NOT NULL DEFAULT '',
  ADD COLUMN "taskId"     TEXT,
  ADD COLUMN "actorId"    TEXT,
  ADD COLUMN "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 3) 백필: 기존 commentId → sourceId (0행이면 no-op)
UPDATE "project"."mentions" SET "sourceId" = "commentId" WHERE "commentId" IS NOT NULL;

-- 4) 옛 컬럼 제거 + 임시 default 제거
ALTER TABLE "project"."mentions" DROP COLUMN "commentId";
ALTER TABLE "project"."mentions" ALTER COLUMN "sourceType" DROP DEFAULT;
ALTER TABLE "project"."mentions" ALTER COLUMN "sourceId" DROP DEFAULT;

-- 5) 신규 유니크 / 인덱스
CREATE UNIQUE INDEX "mentions_sourceType_sourceId_userId_key" ON "project"."mentions"("sourceType", "sourceId", "userId");
CREATE INDEX "mentions_userId_isRead_idx" ON "project"."mentions"("userId", "isRead");
