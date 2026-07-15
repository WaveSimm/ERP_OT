-- Attachment 업로드 종류(파일/이미지) 구분 컬럼 추가
ALTER TABLE "project"."attachments" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'FILE';
