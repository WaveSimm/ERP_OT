-- Migration: Milestone Redesign (PDCA: 프로젝트-마일스톤-재설계)
--
-- 변경:
--   1. 신규 enum: MilestoneStatus, AchievementCriteria
--   2. milestones 테이블 의미 재정의 (그룹 → 시점 이정표)
--   3. dependencies 테이블 신규 (Task↔Milestone polymorphic)
--   4. _MilestoneLinkedTasks 매핑 테이블 신규 (Prisma m:n implicit)
--   5. tasks 컬럼 제거: isMilestone, milestoneId
--   6. task_dependencies 테이블 폐기 (12건 → dependencies로 백필)
--   7. template_tasks.milestoneGroup 컬럼 제거
--
-- OQ 결정:
--   OQ-1: displayParentId → ON DELETE SET NULL (정의는 app layer, FK 미설정)
--   OQ-6: lagDays → lag, type → dependencyType, createdBy='system', createdAt=NOW()
--
-- 백필 대상:
--   isMilestone Task: 2건 → Milestone
--   TaskDependency: 12건 → Dependency

BEGIN;

-- ─────────────────────────────────────────────
-- 1. 신규 ENUM
-- ─────────────────────────────────────────────
CREATE TYPE project."MilestoneStatus" AS ENUM ('PLANNED', 'AT_RISK', 'ACHIEVED', 'MISSED', 'INFEASIBLE');
CREATE TYPE project."AchievementCriteria" AS ENUM ('ALL_LINKED_TASKS_DONE', 'MANUAL');

-- ─────────────────────────────────────────────
-- 2. milestones 테이블 — 의미 재정의 (그룹 → 시점)
-- 기존 컬럼 유지: id, projectId, name, description, sortOrder, createdAt, updatedAt
-- 신규 컬럼 추가
-- ─────────────────────────────────────────────
ALTER TABLE project.milestones
  ADD COLUMN "dueDate"             DATE,
  ADD COLUMN "achievedDate"        TIMESTAMP(3),
  ADD COLUMN "status"              project."MilestoneStatus" NOT NULL DEFAULT 'PLANNED',
  ADD COLUMN "achievementCriteria" project."AchievementCriteria" NOT NULL DEFAULT 'ALL_LINKED_TASKS_DONE',
  ADD COLUMN "displayParentId"     TEXT,
  ADD COLUMN "isCritical"          BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "earliestStart"       TIMESTAMP(3),
  ADD COLUMN "latestStart"         TIMESTAMP(3),
  ADD COLUMN "totalFloat"          DOUBLE PRECISION,
  ADD COLUMN "linkedProgress"      DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "createdBy"           TEXT NOT NULL DEFAULT 'system';

-- createdBy 기본값 제거 (이후 신규는 명시 필수)
ALTER TABLE project.milestones ALTER COLUMN "createdBy" DROP DEFAULT;

-- CHECK 제약: ACHIEVED status면 achievedDate 필수
ALTER TABLE project.milestones
  ADD CONSTRAINT ms_achieved_date CHECK (
    (status = 'ACHIEVED' AND "achievedDate" IS NOT NULL) OR status <> 'ACHIEVED'
  );

-- CHECK 제약: linkedProgress 0~100 범위
ALTER TABLE project.milestones
  ADD CONSTRAINT ms_progress_range CHECK ("linkedProgress" >= 0 AND "linkedProgress" <= 100);

-- 인덱스
CREATE INDEX "milestones_projectId_sortOrder_idx" ON project.milestones("projectId", "sortOrder");
CREATE INDEX "milestones_projectId_status_idx" ON project.milestones("projectId", status);
CREATE INDEX "milestones_projectId_dueDate_idx" ON project.milestones("projectId", "dueDate");

-- ─────────────────────────────────────────────
-- 3. _MilestoneLinkedTasks (Prisma m:n implicit) 신규
-- ─────────────────────────────────────────────
CREATE TABLE project."_MilestoneLinkedTasks" (
  "A" TEXT NOT NULL,
  "B" TEXT NOT NULL,
  CONSTRAINT "_MilestoneLinkedTasks_AB_pkey" PRIMARY KEY ("A","B")
);

CREATE INDEX "_MilestoneLinkedTasks_B_index" ON project."_MilestoneLinkedTasks"("B");

ALTER TABLE project."_MilestoneLinkedTasks"
  ADD CONSTRAINT "_MilestoneLinkedTasks_A_fkey"
  FOREIGN KEY ("A") REFERENCES project.milestones(id) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE project."_MilestoneLinkedTasks"
  ADD CONSTRAINT "_MilestoneLinkedTasks_B_fkey"
  FOREIGN KEY ("B") REFERENCES project.tasks(id) ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────
-- 4. dependencies 테이블 신규 (통합 polymorphic)
-- ─────────────────────────────────────────────
CREATE TABLE project.dependencies (
  id                       TEXT PRIMARY KEY,
  "predecessorTaskId"      TEXT,
  "predecessorMilestoneId" TEXT,
  "successorTaskId"        TEXT,
  "successorMilestoneId"   TEXT,
  "dependencyType"         project."DependencyType" NOT NULL DEFAULT 'FS',
  lag                      INTEGER NOT NULL DEFAULT 0,
  "createdBy"              TEXT NOT NULL,
  "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- predecessor 정확히 1개
  CONSTRAINT dep_predecessor_xor CHECK (
    ("predecessorTaskId" IS NOT NULL)::int + ("predecessorMilestoneId" IS NOT NULL)::int = 1
  ),
  -- successor 정확히 1개
  CONSTRAINT dep_successor_xor CHECK (
    ("successorTaskId" IS NOT NULL)::int + ("successorMilestoneId" IS NOT NULL)::int = 1
  ),
  -- 자기참조 금지 (task)
  CONSTRAINT dep_no_self_task CHECK (
    "predecessorTaskId" IS NULL OR "successorTaskId" IS NULL OR "predecessorTaskId" <> "successorTaskId"
  ),
  -- 자기참조 금지 (milestone)
  CONSTRAINT dep_no_self_milestone CHECK (
    "predecessorMilestoneId" IS NULL OR "successorMilestoneId" IS NULL OR "predecessorMilestoneId" <> "successorMilestoneId"
  ),

  CONSTRAINT "dependencies_predecessorTaskId_fkey" FOREIGN KEY ("predecessorTaskId")
    REFERENCES project.tasks(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "dependencies_predecessorMilestoneId_fkey" FOREIGN KEY ("predecessorMilestoneId")
    REFERENCES project.milestones(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "dependencies_successorTaskId_fkey" FOREIGN KEY ("successorTaskId")
    REFERENCES project.tasks(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "dependencies_successorMilestoneId_fkey" FOREIGN KEY ("successorMilestoneId")
    REFERENCES project.milestones(id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "dependencies_predecessorTaskId_idx" ON project.dependencies("predecessorTaskId");
CREATE INDEX "dependencies_predecessorMilestoneId_idx" ON project.dependencies("predecessorMilestoneId");
CREATE INDEX "dependencies_successorTaskId_idx" ON project.dependencies("successorTaskId");
CREATE INDEX "dependencies_successorMilestoneId_idx" ON project.dependencies("successorMilestoneId");

-- ─────────────────────────────────────────────
-- 5. 백필: isMilestone Task → Milestone (2건)
-- segment의 startDate를 dueDate로 이전
-- ─────────────────────────────────────────────
INSERT INTO project.milestones (
  id, "projectId", name, description, "sortOrder",
  "dueDate", "achievedDate", status, "achievementCriteria",
  "linkedProgress", "createdBy", "createdAt", "updatedAt"
)
SELECT
  'msl_' || substring(t.id from 4),       -- ID prefix 변경 (cl_ → msl_)
  t."projectId",
  t.name,
  t.description,
  t."sortOrder",
  s."startDate",                            -- segment startDate → dueDate
  CASE WHEN t.status = 'DONE' THEN t."updatedAt" ELSE NULL END,
  CASE
    WHEN t.status = 'DONE' THEN 'ACHIEVED'::project."MilestoneStatus"
    ELSE 'PLANNED'::project."MilestoneStatus"
  END,
  'MANUAL'::project."AchievementCriteria",  -- 기존 isMilestone Task는 linkedTasks 없으므로 MANUAL
  CASE WHEN t.status = 'DONE' THEN 100 ELSE 0 END,
  t."createdBy",
  t."createdAt",
  t."updatedAt"
FROM project.tasks t
JOIN project.task_segments s ON s."taskId" = t.id
WHERE t."isMilestone" = true;

-- ─────────────────────────────────────────────
-- 6. 백필: TaskDependency → Dependency (12건, OQ-6 매핑)
-- ─────────────────────────────────────────────
INSERT INTO project.dependencies (
  id, "predecessorTaskId", "predecessorMilestoneId",
  "successorTaskId", "successorMilestoneId",
  "dependencyType", lag, "createdBy", "createdAt"
)
SELECT
  'dep_' || substring(td.id from 4),       -- ID prefix 변경
  td."predecessorId",
  NULL,
  td."successorId",
  NULL,
  td.type,                                  -- DependencyType enum 그대로
  td."lagDays",                             -- lagDays → lag
  'system',                                 -- OQ-6 sentinel
  NOW()                                     -- OQ-6 마이그레이션 시각
FROM project.task_dependencies td;

-- 백필 검증 (실패 시 트랜잭션 롤백)
DO $$
DECLARE
  expected_ms INT;
  actual_ms   INT;
  expected_dep INT;
  actual_dep   INT;
BEGIN
  SELECT COUNT(*) INTO expected_ms FROM project.tasks WHERE "isMilestone" = true;
  SELECT COUNT(*) INTO actual_ms   FROM project.milestones WHERE id LIKE 'msl_%';
  IF expected_ms <> actual_ms THEN
    RAISE EXCEPTION 'Milestone backfill mismatch: expected %, got %', expected_ms, actual_ms;
  END IF;

  SELECT COUNT(*) INTO expected_dep FROM project.task_dependencies;
  SELECT COUNT(*) INTO actual_dep   FROM project.dependencies WHERE "createdBy" = 'system';
  IF expected_dep <> actual_dep THEN
    RAISE EXCEPTION 'Dependency backfill mismatch: expected %, got %', expected_dep, actual_dep;
  END IF;

  RAISE NOTICE 'Backfill verified: % milestones, % dependencies', actual_ms, actual_dep;
END $$;

-- ─────────────────────────────────────────────
-- 7. 구버전 제거
-- ─────────────────────────────────────────────

-- task_dependencies 폐기 (12건 → dependencies로 이전 완료)
DROP TABLE project.task_dependencies;

-- tasks 컬럼 제거: isMilestone, milestoneId
-- (FK 제약을 먼저 제거)
ALTER TABLE project.tasks DROP CONSTRAINT IF EXISTS "tasks_milestoneId_fkey";
ALTER TABLE project.tasks DROP COLUMN "isMilestone";
ALTER TABLE project.tasks DROP COLUMN "milestoneId";

-- template_tasks.milestoneGroup 폐기
ALTER TABLE project.template_tasks DROP COLUMN "milestoneGroup";

COMMIT;
