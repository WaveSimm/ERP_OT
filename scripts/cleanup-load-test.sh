#!/usr/bin/env bash
# 부하테스트 PDCA — 부하 사용자 + 종속 데이터 일괄 정리
#
# 사용법:
#   bash scripts/cleanup-load-test.sh            # 실제 삭제 (yes 확인)
#   bash scripts/cleanup-load-test.sh --dry-run  # 삭제 대상만 표시
#   bash scripts/cleanup-load-test.sh --yes      # 자동 yes (자원-모델-분리 PDCA Phase 3c, 2026-05-04)
#
# auth_users CASCADE FK가 설정되어 있으면 사용자 삭제만으로 종속 데이터 자동 삭제됨.
# project schema는 별도이므로 별도 DELETE.
# 자원-모델-분리 PDCA 후 external_persons / equipment_resources도 정리 대상.

set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:-erp-ot-postgres}"
PG_USER="${PG_USER:-erp_user}"
PG_DB="${PG_DB:-erp_ot}"
LOAD_TEST_DOMAIN="${LOAD_TEST_DOMAIN:-@erp-ot.load}"

# 인자 파싱
DRY_RUN=false
AUTO_YES=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --yes|-y) AUTO_YES=true ;;
    *) ;;
  esac
done

psql() {
  docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" "$@"
}

echo "=== 부하 테스트 데이터 현황 ==="
psql -c "
  SELECT 'public.auth_users (load test)' AS kind, COUNT(*) AS cnt
    FROM public.auth_users WHERE id LIKE 'loadtest-%'
  UNION ALL
  SELECT 'public.board_posts',  COUNT(*)
    FROM public.board_posts WHERE author_id LIKE 'loadtest-%'
  UNION ALL
  SELECT 'public.board_comments', COUNT(*)
    FROM public.board_comments WHERE author_id LIKE 'loadtest-%'
  UNION ALL
  SELECT 'public.auth_refresh_tokens', COUNT(*)
    FROM public.auth_refresh_tokens WHERE user_id LIKE 'loadtest-%'
  UNION ALL
  SELECT 'project.work_logs', COUNT(*)
    FROM project.work_logs WHERE author_id LIKE 'loadtest-%'
  UNION ALL
  SELECT 'project.resources (legacy)', COUNT(*)
    FROM project.resources WHERE \"userId\" LIKE 'loadtest-%${LOAD_TEST_DOMAIN}'
  UNION ALL
  SELECT 'project.external_persons (load test)', COUNT(*)
    FROM project.external_persons WHERE name LIKE '[LOAD]%'
  UNION ALL
  SELECT 'project.equipment_resources (load test)', COUNT(*)
    FROM project.equipment_resources WHERE name LIKE '[LOAD]%';
"

if [ "$DRY_RUN" = true ]; then
  echo
  echo "DRY RUN 완료 (실제 삭제는 인자 없이 또는 --yes로 실행)"
  exit 0
fi

if [ "$AUTO_YES" != true ]; then
  echo
  read -p "정말 부하 테스트 데이터를 모두 삭제합니까? (yes/no): " CONFIRM
  if [ "$CONFIRM" != "yes" ]; then
    echo "취소됨"
    exit 1
  fi
fi

echo
echo "=== 삭제 진행 ==="

# 1. project.resources (legacy, 자원-모델-분리 Phase 4까지 호환)
psql -v ON_ERROR_STOP=1 -c "
  DELETE FROM project.resources WHERE \"userId\" LIKE 'loadtest-%${LOAD_TEST_DOMAIN}';
"

# 2. project.external_persons (자원-모델-분리 PDCA Phase 3c)
psql -v ON_ERROR_STOP=1 -c "
  DELETE FROM project.external_persons WHERE name LIKE '[LOAD]%';
"

# 3. project.equipment_resources (자원-모델-분리 PDCA Phase 3c)
psql -v ON_ERROR_STOP=1 -c "
  DELETE FROM project.equipment_resources WHERE name LIKE '[LOAD]%';
"

# 4. auth_users 삭제 → CASCADE FK로 종속 데이터 자동 삭제
#    (board_posts, board_comments, refresh_tokens 등)
psql -v ON_ERROR_STOP=1 -c "
  DELETE FROM public.auth_users WHERE id LIKE 'loadtest-%';
"

# 5. project.work_logs는 user 참조 없음 (author_id는 string, FK 아님) — 명시적 삭제
psql -v ON_ERROR_STOP=1 -c "
  DELETE FROM project.work_logs WHERE author_id LIKE 'loadtest-%';
"

echo
echo "=== 삭제 후 검증 ==="
psql -c "
  SELECT 'auth_users' AS kind, COUNT(*) AS remaining
    FROM public.auth_users WHERE id LIKE 'loadtest-%'
  UNION ALL
  SELECT 'board_posts', COUNT(*)
    FROM public.board_posts WHERE author_id LIKE 'loadtest-%'
  UNION ALL
  SELECT 'work_logs', COUNT(*)
    FROM project.work_logs WHERE author_id LIKE 'loadtest-%'
  UNION ALL
  SELECT 'resources (legacy)', COUNT(*)
    FROM project.resources WHERE \"userId\" LIKE 'loadtest-%${LOAD_TEST_DOMAIN}'
  UNION ALL
  SELECT 'external_persons', COUNT(*)
    FROM project.external_persons WHERE name LIKE '[LOAD]%'
  UNION ALL
  SELECT 'equipment_resources', COUNT(*)
    FROM project.equipment_resources WHERE name LIKE '[LOAD]%';
"

echo "Cleanup 완료"
