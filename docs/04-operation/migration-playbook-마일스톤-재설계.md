# Migration Playbook — 프로젝트-마일스톤-재설계

> **작성**: 2026-04-30
> **PDCA**: 프로젝트-마일스톤-재설계
> **마이그레이션**: `services/project/prisma/migrations/20260430120000_milestone_redesign/`
> **롤백 가능 여부**: 단일 트랜잭션 (BEGIN/COMMIT) — 적용 중 실패 시 자동 롤백. 적용 후엔 백업 dump 필요.

---

## 1. 변경 요약

| 영역 | 변경 |
|------|------|
| **새 enum** | `MilestoneStatus` (5종), `AchievementCriteria` (2종) |
| **`milestones` 테이블** | 의미 재정의 (그룹 → 시점 이정표). 컬럼 11개 추가 + 인덱스 3종 |
| **`dependencies` 테이블** | 신규 생성 (Task↔Milestone polymorphic) + CHECK 제약 4종 + 인덱스 4종 |
| **`_MilestoneLinkedTasks`** | 신규 (Prisma m:n implicit) |
| **`tasks` 컬럼 제거** | `isMilestone`, `milestoneId` |
| **`task_dependencies` 테이블** | 폐기 (12건 → `dependencies`로 백필) |
| **`template_tasks.milestoneGroup`** | 컬럼 제거 |

---

## 2. 사전 점검 (적용 전)

```bash
# 1. 데이터 카운트 확인 (예상 값과 비교)
docker exec erp-ot-postgres psql -U erp_user -d erp_ot -c "
  SELECT 'task_dep' AS kind, COUNT(*) FROM project.task_dependencies
  UNION ALL SELECT 'isMilestone_tasks', COUNT(*) FROM project.tasks WHERE \"isMilestone\" = true
  UNION ALL SELECT 'milestone_groups', COUNT(*) FROM project.milestones;
"
# 기대: task_dep=12, isMilestone_tasks=2, milestone_groups=0

# 2. 백업 (필수)
docker exec erp-ot-postgres pg_dump -U erp_user -d erp_ot --schema=project --no-owner --no-privileges \
  > backup-pre-milestone-redesign-$(date +%Y%m%d-%H%M%S).sql

# 3. project-service 컨테이너 stop (entrypoint의 prisma db push 충돌 방지)
docker compose stop project-service
```

---

## 3. 적용

```bash
# 마이그레이션 SQL 직접 실행 (Prisma migrate deploy 대신, 단일 트랜잭션 명시적)
docker exec -i erp-ot-postgres psql -U erp_user -d erp_ot \
  < services/project/prisma/migrations/20260430120000_milestone_redesign/migration.sql

# 기대 출력 마지막 부분:
#   NOTICE: Backfill verified: 2 milestones, 12 dependencies
#   COMMIT
```

**검증 자동화**: 마이그레이션 SQL 내부 `DO $$ ... RAISE EXCEPTION ... $$` 블록이 백필 카운트 불일치 시 트랜잭션 자체를 롤백. 별도 검증 스크립트 불필요.

---

## 4. 적용 후 검증

```bash
# 1. 스키마 검증
docker exec erp-ot-postgres psql -U erp_user -d erp_ot -c "
  SELECT 'milestones' AS tbl, COUNT(*) FROM project.milestones
  UNION ALL SELECT 'dependencies', COUNT(*) FROM project.dependencies
  UNION ALL SELECT 'task_isMilestone_col', COUNT(*) FROM information_schema.columns
    WHERE table_schema='project' AND table_name='tasks' AND column_name IN ('isMilestone','milestoneId')
  UNION ALL SELECT 'task_dep_table', COUNT(*) FROM information_schema.tables
    WHERE table_schema='project' AND table_name='task_dependencies';
"
# 기대: milestones=2, dependencies=12, task_isMilestone_col=0, task_dep_table=0

# 2. CHECK 제약 검증
docker exec erp-ot-postgres psql -U erp_user -d erp_ot -c "
  SELECT conname FROM pg_constraint
  WHERE conrelid = 'project.dependencies'::regclass AND contype = 'c'
  ORDER BY conname;
"
# 기대: dep_no_self_milestone, dep_no_self_task, dep_predecessor_xor, dep_successor_xor

# 3. Prisma 클라이언트 재생성 (호스트에서)
cd services/project && pnpm prisma generate
```

---

## 5. 서비스 재시작

### 옵션 A — 로컬 dev (Docker 우회, Dockerfile 빌드 이슈 회피)

```bash
cd services/project
pnpm dev
# port 3003 listening 확인
curl http://localhost:3003/health
```

### 옵션 B — Docker 이미지 rebuild (Dockerfile 이슈 해결 후)

⚠️ 현재 `services/project/Dockerfile:18` 의 `node /app/node_modules/typescript/bin/tsc`는 pnpm workspace 환경에서 모듈 경로 해결 실패. **`prod-빌드-정리` PDCA에서 별도 처리**.

해결 후:
```bash
docker compose build project-service
docker compose up -d project-service
```

---

## 6. 롤백 절차

### 마이그레이션 적용 직후 (DB 변경, 코드 변경 없음)

```bash
# 1. project-service 정지
docker compose stop project-service

# 2. 백업 dump 복원
docker exec -i erp-ot-postgres psql -U erp_user -d erp_ot \
  -c "DROP SCHEMA project CASCADE; CREATE SCHEMA project;" \
  && docker exec -i erp-ot-postgres psql -U erp_user -d erp_ot \
  < backup-pre-milestone-redesign-{TIMESTAMP}.sql

# 3. 코드도 이전 commit으로 revert
git revert {commit-hash}  # 또는 reset --hard
cd services/project && pnpm prisma generate

# 4. 서비스 재기동 (이전 코드)
pnpm dev
```

### 코드도 적용된 후 (운영 중)

같은 순서 + 외부 알림: `dependencies` 테이블에 추가된 Task↔Milestone 의존성 손실 가능 → 사용자 안내 필요.

---

## 7. 알려진 이슈 / 후속 사항

### 마이그레이션 적용 후 즉시 확인할 것

- [ ] `dependencies` 12건의 `createdBy`가 `'system'` (sentinel) — PM이 누가 만들었는지 모름. 운영 중 명시적 변경 필요 시 update.
- [ ] 기존 isMilestone Task 2건은 이제 `Milestone` 레코드. WBS 위치 (parentId)는 잃어버림 → `displayParentId`로 다시 지정 필요할 수 있음.
- [ ] 템플릿의 `milestoneGroup` 사용 이력은 사라짐. 기존 템플릿 데이터 재검토 필요.

### 후속 PDCA에서 다룰 것

- 외부 알림 인프라 (현재 `MilestoneService.notifyStatusChange`는 hook 자리만 마련)
- 결재라인 자동 보고 (`마일스톤-트리거` PDCA)
- Milestone CPM 노드화 — 현재 Task↔Task만. Milestone duration=0 노드로 통합은 후속.
- ProjectPhase (기간 그룹) — 필요해질 때 신설

---

## 8. Rollout 계획 (이관 후)

본 PDCA는 **로컬 전용 운영 단계**(2026-04-24 기준)에 작업. 실제 회사 서버 이관 시:

1. 보안 일괄 패치 (Phase C) 후 적용
2. 백업 확인 — `db-backup` 컨테이너의 일일 dump (47파일 보관)
3. 단계적 검증: dev → staging → prod
4. 외부 노출 없으니 다운타임 5~10분 허용

---

## 9. 변경 영향 받은 파일 (참고)

### 신규 (5)
- `services/project/src/application/milestone.service.ts`
- `services/project/src/application/dependency.service.ts`
- `services/project/src/api/routes/milestone.routes.ts`
- `services/project/src/api/routes/dependency.routes.ts`
- `services/project/prisma/migrations/20260430120000_milestone_redesign/migration.sql`

### 수정 (백엔드, 14)
- schema.prisma, task.entity, task.repository, aggregate.service, task.service, project.service, template.service, dashboard.service, issue-detector.service, timeline.service, cpm.service, impact.service, project.gateway, task.dto, project.routes, task.routes, my-tasks.routes, template.routes, index.ts

### 수정·신규 (프런트엔드, 5)
- `apps/web/src/lib/api.ts` (milestoneApi 재정의 + dependencyApi 신규)
- `apps/web/src/components/GanttChart.tsx` (Milestone row 색상 4단계 + 호버 툴팁)
- `apps/web/src/components/AddTaskModal.tsx` (isMilestone 토글 제거)
- `apps/web/src/components/MilestoneModal.tsx` ★신규
- `apps/web/src/components/MilestoneSidePanel.tsx` ★신규
- `apps/web/src/app/projects/[id]/page.tsx` (mergeGanttData + 통합)

### Cycle detection 버그 수정
- `dependency.service.ts:154` — BFS 방향 (predecessor 방향 → successor 방향)
