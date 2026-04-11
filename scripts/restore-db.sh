#!/bin/bash
# ─── ERP-OT PostgreSQL 복원 스크립트 ────────────────────────────────────────
# 사용법: ./scripts/restore-db.sh [backup_file]
# 예시:   ./scripts/restore-db.sh backups/erp_ot_20260411_020000.sql.gz

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${PROJECT_DIR}/backups"
CONTAINER_NAME="erp-ot-postgres"
DB_NAME="${POSTGRES_DB:-erp_ot}"
DB_USER="${POSTGRES_USER:-erp_user}"

# ─── 백업 파일 선택 ───────────────────────────────────────────────────────
if [ $# -ge 1 ]; then
  BACKUP_FILE="$1"
else
  echo "사용 가능한 백업 파일:"
  echo "──────────────────────────────────────────"
  ls -lh "${BACKUP_DIR}"/erp_ot_*.sql.gz 2>/dev/null | awk '{print NR". "$NF" ("$5")"}'
  echo ""
  echo "사용법: $0 <backup_file_path>"
  exit 1
fi

if [ ! -f "${BACKUP_FILE}" ]; then
  echo "[ERROR] File not found: ${BACKUP_FILE}"
  exit 1
fi

# ─── 확인 ─────────────────────────────────────────────────────────────────
echo "═══════════════════════════════════════════════════════════"
echo "  ERP-OT DB Restore"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "  File: ${BACKUP_FILE}"
echo "  DB:   ${DB_NAME}"
echo ""
echo "  !! 경고: 현재 DB의 모든 데이터가 덮어씌워집니다 !!"
echo ""
read -p "  계속하시겠습니까? (yes/no): " CONFIRM
if [ "${CONFIRM}" != "yes" ]; then
  echo "  복원이 취소되었습니다."
  exit 0
fi

# ─── 현재 DB 백업 (안전장치) ──────────────────────────────────────────────
echo ""
echo "[1/3] Creating safety backup before restore..."
SAFETY_FILE="${BACKUP_DIR}/erp_ot_pre_restore_$(date +%Y%m%d_%H%M%S).sql.gz"
docker exec "${CONTAINER_NAME}" pg_dump -U "${DB_USER}" -d "${DB_NAME}" --no-owner --no-privileges 2>/dev/null | gzip > "${SAFETY_FILE}"
echo "       Safety backup: ${SAFETY_FILE}"

# ─── DB 재생성 ────────────────────────────────────────────────────────────
echo "[2/3] Dropping and recreating database..."
docker exec "${CONTAINER_NAME}" psql -U "${DB_USER}" -d postgres -c "
  SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid();
" > /dev/null 2>&1
docker exec "${CONTAINER_NAME}" psql -U "${DB_USER}" -d postgres -c "DROP DATABASE IF EXISTS ${DB_NAME};" > /dev/null 2>&1
docker exec "${CONTAINER_NAME}" psql -U "${DB_USER}" -d postgres -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};" > /dev/null 2>&1

# ─── 복원 ─────────────────────────────────────────────────────────────────
echo "[3/3] Restoring from backup..."
gunzip -c "${BACKUP_FILE}" | docker exec -i "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${DB_NAME}" --quiet > /dev/null 2>&1

echo ""
echo "  복원 완료!"
echo "  서비스를 재시작하세요: docker compose restart"
echo "═══════════════════════════════════════════════════════════"
