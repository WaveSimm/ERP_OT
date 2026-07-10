-- 수동 이슈(TaskIssue): 태스크 상세에서 사용자가 등록하는 이슈.
-- 미해결(is_resolved=false)이면 전사 대시보드 '이슈 현황'에 CRITICAL로 노출.
CREATE TABLE "project"."task_issues" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "is_resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,
    "author_id" TEXT NOT NULL,
    "author_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_issues_pkey" PRIMARY KEY ("id")
);

-- 태스크별 미해결 이슈 최신순 조회 최적화
CREATE INDEX "task_issues_task_id_is_resolved_created_at_idx" ON "project"."task_issues"("task_id", "is_resolved", "created_at" DESC);

ALTER TABLE "project"."task_issues" ADD CONSTRAINT "task_issues_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "project"."tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
