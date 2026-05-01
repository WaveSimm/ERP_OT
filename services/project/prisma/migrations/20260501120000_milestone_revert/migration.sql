-- Migration: Milestone 모델 폐기 + Task isMilestone 부활
-- PDCA: 마일스톤-시점태스크-회귀 (마일스톤-재설계 PDCA 일부 reverse)
-- 결정: D8 OQ-1~OQ-7 모두 적용

BEGIN;

-- ═══════════════════════════════════════════════════
-- 1. Task에 isMilestone 컬럼 부활
-- ═══════════════════════════════════════════════════
ALTER TABLE project.tasks
  ADD COLUMN "isMilestone" BOOLEAN NOT NULL DEFAULT false;

-- ═══════════════════════════════════════════════════
-- 2. Milestone → Task 변환 (KHOA "현장 납품" 등)
-- ═══════════════════════════════════════════════════
INSERT INTO project.tasks (
  id, "projectId", "parentId", name, description, "sortOrder",
  status, "overallProgress", "isManualProgress", "isMilestone",
  "isCritical", "createdBy", "createdAt", "updatedAt"
)
SELECT
  'tsk_ms_' || substring(id from 5),  -- 'msl_xxx' 또는 'cmoln1...' → 'tsk_ms_xxx'
  "projectId",
  "displayParentId",
  name,
  description,
  "sortOrder",
  CASE WHEN status = 'ACHIEVED' THEN 'DONE'::project."TaskStatus" ELSE 'TODO'::project."TaskStatus" END,
  CASE WHEN status = 'ACHIEVED' THEN 100 ELSE 0 END,
  true,                  -- isManualProgress (시점 task는 PM 수동)
  true,                  -- isMilestone (OQ-2: 자식 가질 수 없음, app layer 검증)
  false,                 -- isCritical
  "createdBy",
  "createdAt",
  "updatedAt"
FROM project.milestones;

-- ═══════════════════════════════════════════════════
-- 3. 변환된 task에 단일 segment (start=end=dueDate) — OQ-6
-- ═══════════════════════════════════════════════════
INSERT INTO project.task_segments (
  id, "taskId", name, "sortOrder", "startDate", "endDate",
  "progressPercent", "createdAt", "updatedAt"
)
SELECT
  'seg_ms_' || substring(m.id from 5),
  'tsk_ms_' || substring(m.id from 5),
  '시점',
  0,
  COALESCE(m."dueDate", CURRENT_DATE),
  COALESCE(m."dueDate", CURRENT_DATE),  -- start=end (단일 시점)
  CASE WHEN m.status = 'ACHIEVED' THEN 100 ELSE 0 END,
  NOW(), NOW()
FROM project.milestones m;

-- ═══════════════════════════════════════════════════
-- 4. ACHIEVED milestone에 system work log (OQ-3)
--    worked_at = achievedDate (정확한 시점 보존)
-- ═══════════════════════════════════════════════════
INSERT INTO project.work_logs (
  id, task_id, author_id, author_name, content, worked_at,
  is_deleted, created_at, updated_at
)
SELECT
  'wl_ms_' || substring(m.id from 5),
  'tsk_ms_' || substring(m.id from 5),
  'system',
  'system',
  '[system] 마일스톤-시점태스크-회귀 마이그레이션. 이전 ACHIEVED milestone 변환.',
  COALESCE(m."achievedDate"::date, m."dueDate", CURRENT_DATE),
  false,
  NOW(), NOW()
FROM project.milestones m
WHERE m.status = 'ACHIEVED';

-- ═══════════════════════════════════════════════════
-- 5. Dependency의 milestone 참조 정리 (현재 0건이지만 안전)
-- ═══════════════════════════════════════════════════
DELETE FROM project.dependencies
WHERE "predecessorMilestoneId" IS NOT NULL
   OR "successorMilestoneId" IS NOT NULL;

ALTER TABLE project.dependencies
  DROP CONSTRAINT IF EXISTS dep_predecessor_xor,
  DROP CONSTRAINT IF EXISTS dep_successor_xor,
  DROP CONSTRAINT IF EXISTS dep_no_self_milestone;

-- FK 인덱스 먼저 drop
DROP INDEX IF EXISTS project."dependencies_predecessorMilestoneId_idx";
DROP INDEX IF EXISTS project."dependencies_successorMilestoneId_idx";

ALTER TABLE project.dependencies
  DROP COLUMN "predecessorMilestoneId",
  DROP COLUMN "successorMilestoneId";

ALTER TABLE project.dependencies
  ALTER COLUMN "predecessorTaskId" SET NOT NULL,
  ALTER COLUMN "successorTaskId" SET NOT NULL;

-- 자기 자신 의존 금지
ALTER TABLE project.dependencies
  DROP CONSTRAINT IF EXISTS dep_no_self_task;
ALTER TABLE project.dependencies
  ADD CONSTRAINT dep_no_self_task
  CHECK ("predecessorTaskId" <> "successorTaskId");

-- 신규: 중복 의존성 방지 unique
ALTER TABLE project.dependencies
  ADD CONSTRAINT "dependencies_predecessorTaskId_successorTaskId_key"
  UNIQUE ("predecessorTaskId", "successorTaskId");

-- ═══════════════════════════════════════════════════
-- 6. 백필 검증 (RAISE EXCEPTION on mismatch → 자동 ROLLBACK)
-- ═══════════════════════════════════════════════════
DO $$
DECLARE
  expected_ms INT;
  actual_tasks INT;
  actual_segs INT;
  expected_wl INT;
  actual_wl INT;
BEGIN
  SELECT COUNT(*) INTO expected_ms FROM project.milestones;
  SELECT COUNT(*) INTO actual_tasks FROM project.tasks WHERE id LIKE 'tsk_ms_%';
  SELECT COUNT(*) INTO actual_segs FROM project.task_segments WHERE id LIKE 'seg_ms_%';
  SELECT COUNT(*) INTO expected_wl FROM project.milestones WHERE status = 'ACHIEVED';
  SELECT COUNT(*) INTO actual_wl FROM project.work_logs WHERE id LIKE 'wl_ms_%';

  IF expected_ms != actual_tasks THEN
    RAISE EXCEPTION 'Task 변환 mismatch: ms=%, tasks=%', expected_ms, actual_tasks;
  END IF;
  IF expected_ms != actual_segs THEN
    RAISE EXCEPTION 'Segment 생성 mismatch: ms=%, segs=%', expected_ms, actual_segs;
  END IF;
  IF expected_wl != actual_wl THEN
    RAISE EXCEPTION 'Work log 생성 mismatch: expected=%, actual=%', expected_wl, actual_wl;
  END IF;

  RAISE NOTICE 'Migration verified: % milestones → % tasks + % segments + % work logs',
               expected_ms, actual_tasks, actual_segs, actual_wl;
END $$;

-- ═══════════════════════════════════════════════════
-- 7. Milestone 모델·관련 인프라 폐기
-- ═══════════════════════════════════════════════════
DROP TABLE project."_MilestoneLinkedTasks";
DROP TABLE project.milestones;
DROP TYPE project."MilestoneStatus";
DROP TYPE project."AchievementCriteria";

COMMIT;
