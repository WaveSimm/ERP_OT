-- 내 즐겨찾기(ProjectFavorite): 사용자별 프라이빗 프로젝트 즐겨찾기.
-- 프로젝트 페이지 '내 즐겨찾기' 폴더 — 계정별로만 조회됨.
CREATE TABLE "project"."project_favorites" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_favorites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_favorites_user_id_project_id_key" ON "project"."project_favorites"("user_id", "project_id");
CREATE INDEX "project_favorites_user_id_idx" ON "project"."project_favorites"("user_id");

ALTER TABLE "project"."project_favorites" ADD CONSTRAINT "project_favorites_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"."projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
