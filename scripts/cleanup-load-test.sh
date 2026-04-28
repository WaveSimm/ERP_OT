#!/usr/bin/env bash
# 부하테스트 PDCA — 부하 사용자 + 종속 데이터 일괄 정리
#
# 사용법:
#   bash scripts/cleanup-load-test.sh            # 실제 삭제 (yes 확인)
#   bash scripts/cleanup-load-test.sh --dry-run  # 삭제 대상만 표시
#
# auth_users CASCADE FK가 설정되어 있으면 사용자 삭제만으로 종속 데이터 자동 삭제됨.
# project.resources는 별도 schema이므로 별도 DELETE.

set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:-erp-ot-postgres}"
PG_USER="${PG_USER:-erp_user}"
PG_DB="${PG_DB:-erp_ot}"
LOAD_TEST_DOMAIN="${LOAD_TEST_DOMAIN:-@erp-ot.load}"
DRY_RUN="${1:-}"

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
  SELECT 'project.resources', COUNT(*)
    FROM project.resources WHERE \"userId\" LIKE 'loadtest-%${LOAD_TEST_DOMAIN}';
"

if [ "$DRY_RUN" = "--dry-run" ]; then
  echo
  echo "✅ DRY RUN 완료 (실제 삭제는 인자 없이 실행)"
  exit 0
fi

echo
read -p "정말 부하 테스트 데이터를 모두 삭제합니까? (yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "취소됨"
  exit 1
fi

echo
echo "=== 삭제 진행 ==="

# 1. project.resources (다른 schema, 외래키 없음)
psql -v ON_ERROR_STOP=1 -c "
  DELETE FROM project.resources WHERE \"userId\" LIKE 'loadtest-%${LOAD_TEST_DOMAIN}';
"

# 2. auth_users 삭제 → CASCADE FK로 종속 데이터 자동 삭제
#    (board_posts, board_comments, refresh_tokens 등)
psql -v ON_ERROR_STOP=1 -c "
  DELETE FROM public.auth_users WHERE id LIKE 'loadtest-%';
"

# 3. project.work_logs는 user 참조 없음 (author_id는 string, FK 아님) — 명시적 삭제
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
  SELECT 'resources', COUNT(*)
    FROM project.resources WHERE \"userId\" LIKE 'loadtest-%${LOAD_TEST_DOMAIN}';
"

echo "✅ Cleanup 완료"
