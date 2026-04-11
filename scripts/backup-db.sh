#!/bin/bash
# ─── ERP-OT PostgreSQL 자동 백업 스크립트 ───────────────────────────────────
# 사용법: ./scripts/backup-db.sh
# cron 예시: 0 2 * * * /path/to/erp-ot/scripts/backup-db.sh >> /path/to/erp-ot/backups/backup.log 2>&1

set -euo pipefail

# ─── 설정 ──────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${PROJECT_DIR}/backups"
CONTAINER_NAME="erp-ot-postgres"
DB_NAME="${POSTGRES_DB:-erp_ot}"
DB_USER="${POSTGRES_USER:-erp_user}"
RETENTION_DAYS=30              # 30일 보관
MAX_BACKUPS=60                 # 최대 보관 개수
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="erp_ot_${TIMESTAMP}.sql.gz"

# ─── 백업 디렉토리 생성 ───────────────────────────────────────────────────
mkdir -p "${BACKUP_DIR}"

echo "═══════════════════════════════════════════════════════════"
echo "  ERP-OT DB Backup: ${TIMESTAMP}"
echo "═══════════════════════════════════════════════════════════"

# ─── 컨테이너 확인 ────────────────────────────────────────────────────────
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "[ERROR] Container '${CONTAINER_NAME}' is not running."
  exit 1
fi

# ─── pg_dump 실행 ─────────────────────────────────────────────────────────
echo "[1/4] Dumping database '${DB_NAME}'..."
docker exec "${CONTAINER_NAME}" pg_dump \
  -U "${DB_USER}" \
  -d "${DB_NAME}" \
  --no-owner \
  --no-privileges \
  --format=plain \
  --verbose \
  2>/dev/null | gzip > "${BACKUP_DIR}/${BACKUP_FILE}"

FILESIZE=$(du -h "${BACKUP_DIR}/${BACKUP_FILE}" | cut -f1)
echo "[2/4] Backup created: ${BACKUP_FILE} (${FILESIZE})"

# ─── 무결성 검증 ─────────────────────────────────────────────────────────
echo "[3/4] Verifying backup integrity..."
if gzip -t "${BACKUP_DIR}/${BACKUP_FILE}" 2>/dev/null; then
  echo "       Integrity check: OK"
else
  echo "[ERROR] Backup file is corrupted!"
  rm -f "${BACKUP_DIR}/${BACKUP_FILE}"
  exit 1
fi

# ─── 오래된 백업 정리 ────────────────────────────────────────────────────
echo "[4/4] Cleaning old backups (>${RETENTION_DAYS} days, max ${MAX_BACKUPS})..."
# 날짜 기준 삭제
find "${BACKUP_DIR}" -name "erp_ot_*.sql.gz" -type f -mtime +${RETENTION_DAYS} -delete 2>/dev/null || true
# 개수 기준 삭제 (오래된 것부터)
BACKUP_COUNT=$(find "${BACKUP_DIR}" -name "erp_ot_*.sql.gz" -type f | wc -l)
if [ "${BACKUP_COUNT}" -gt "${MAX_BACKUPS}" ]; then
  EXCESS=$((BACKUP_COUNT - MAX_BACKUPS))
  find "${BACKUP_DIR}" -name "erp_ot_*.sql.gz" -type f -printf '%T@ %p\n' | \
    sort -n | head -n "${EXCESS}" | cut -d' ' -f2 | xargs rm -f
  echo "       Removed ${EXCESS} old backup(s)"
fi

TOTAL=$(find "${BACKUP_DIR}" -name "erp_ot_*.sql.gz" -type f | wc -l)
echo ""
echo "  Backup complete. Total backups: ${TOTAL}"
echo "  Location: ${BACKUP_DIR}/${BACKUP_FILE}"
echo "═══════════════════════════════════════════════════════════"
