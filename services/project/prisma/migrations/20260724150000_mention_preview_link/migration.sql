-- 멘션 크로스서비스 대상(게시판 등)용 저장형 미리보기/링크 컬럼 추가.
--   태스크계는 null → notification 라우트가 taskId로 해석(기존 유지).
ALTER TABLE "project"."mentions"
  ADD COLUMN "preview" TEXT,
  ADD COLUMN "linkUrl" TEXT;
