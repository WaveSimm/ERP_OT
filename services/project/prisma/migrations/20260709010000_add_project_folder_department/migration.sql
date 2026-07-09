-- 부서 기본 폴더: ProjectFolder를 auth 부서에 연결 (null이면 수동 생성 폴더)
ALTER TABLE "project"."project_folders" ADD COLUMN "departmentId" TEXT;

-- 부서당 폴더 1개 (null 다중 허용 — 수동 폴더)
CREATE UNIQUE INDEX "project_folders_departmentId_key" ON "project"."project_folders"("departmentId");
