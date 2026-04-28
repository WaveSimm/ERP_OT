-- 프로젝트-진도율-캐시 PDCA — Project/Task aggregate cache 필드 + backfill

-- 1. Project 신규 필드
ALTER TABLE project.projects
  ADD COLUMN IF NOT EXISTS overall_progress double precision,
  ADD COLUMN IF NOT EXISTS effective_start_date timestamp(3),
  ADD COLUMN IF NOT EXISTS effective_end_date timestamp(3);

-- 2. Task 신규 필드
ALTER TABLE project.tasks
  ADD COLUMN IF NOT EXISTS effective_start_date timestamp(3),
  ADD COLUMN IF NOT EXISTS effective_end_date timestamp(3);

-- 3. Backfill: 모든 task의 effective dates (자기 segments min/max)
UPDATE project.tasks t SET
  effective_start_date = sub.s,
  effective_end_date = sub.e
FROM (
  SELECT s."taskId", MIN(s."startDate") AS s, MAX(s."endDate") AS e
  FROM project.task_segments s
  GROUP BY s."taskId"
) sub
WHERE t.id = sub."taskId";

-- 4. Backfill: 모든 project의 aggregates (leaf task only, isMilestone=false)
WITH parents AS (
  SELECT DISTINCT "parentId" FROM project.tasks WHERE "parentId" IS NOT NULL
),
leaf_segments AS (
  SELECT t."projectId", s."progressPercent", s."startDate", s."endDate"
  FROM project.tasks t
  JOIN project.task_segments s ON s."taskId" = t.id
  WHERE t.id NOT IN (SELECT "parentId" FROM parents)
    AND t."isMilestone" = false
)
UPDATE project.projects p SET
  overall_progress = sub.avg_p,
  effective_start_date = sub.s,
  effective_end_date = sub.e
FROM (
  SELECT "projectId",
         AVG("progressPercent") AS avg_p,
         MIN("startDate") AS s,
         MAX("endDate") AS e
  FROM leaf_segments
  GROUP BY "projectId"
) sub
WHERE p.id = sub."projectId";

-- 검증
SELECT COUNT(*) FILTER (WHERE overall_progress IS NOT NULL) AS projects_with_cache,
       COUNT(*) AS total_projects
FROM project.projects;
