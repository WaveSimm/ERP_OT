-- CreateTable
CREATE TABLE "project"."work_logs" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "segment_id" TEXT,
    "author_id" TEXT NOT NULL,
    "author_name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "worked_at" DATE NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_logs_task_id_is_deleted_worked_at_idx" ON "project"."work_logs"("task_id", "is_deleted", "worked_at" DESC);

-- CreateIndex
CREATE INDEX "work_logs_author_id_worked_at_idx" ON "project"."work_logs"("author_id", "worked_at" DESC);

-- CreateIndex
CREATE INDEX "work_logs_segment_id_idx" ON "project"."work_logs"("segment_id");

-- AddForeignKey
ALTER TABLE "project"."work_logs" ADD CONSTRAINT "work_logs_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "project"."tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project"."work_logs" ADD CONSTRAINT "work_logs_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "project"."task_segments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
