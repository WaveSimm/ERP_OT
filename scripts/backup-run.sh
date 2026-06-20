#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# ERP_OT 백업 (1회 실행) — DB 덤프 + uploads 4종 tar + 30일 보존정리
#
#   erp-ot-backup(db-backup) 컨테이너 내부에서 실행되도록 설계:
#     - POSTGRES_USER/PASSWORD/DB = 컨테이너 env 상속(docker exec)
#     - /backups, /uploads_{approval,expense,auth,ocr} = 컨테이너 볼륨
#   호출: docker exec erp-ot-backup sh /scripts/backup-run.sh  (systemd timer가 트리거)
#
#   기존 sleep-루프 방식의 drift(02:00→오후로 밀림)·재시작 누락(6/15 실종)을 제거하기 위해
#   호스트 systemd timer(절대시각 03:00 KST, Persistent=놓친 실행 보정)로 일원화.
# ─────────────────────────────────────────────────────────────────────────────
set -u
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILE="/backups/erp_ot_${TIMESTAMP}.sql.gz"

echo "[${TIMESTAMP}] Starting DB backup..."
PGPASSWORD="${POSTGRES_PASSWORD}" pg_dump -h postgres -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
  --no-owner --no-privileges | gzip > "$FILE"
if [ $? -eq 0 ] && [ -s "$FILE" ]; then
  echo "[${TIMESTAMP}] DB Backup OK: $FILE ($(du -h "$FILE" | cut -f1))"
else
  echo "[${TIMESTAMP}] DB Backup FAILED"
  rm -f "$FILE"
fi

for src in approval expense auth ocr; do
  DIR="/uploads_${src}"
  UFILE="/backups/${src}_uploads_${TIMESTAMP}.tar.gz"
  if [ -d "$DIR" ]; then
    echo "[${TIMESTAMP}] Backup $src uploads..."
    if tar czf "$UFILE" -C "$DIR" . 2>/dev/null; then
      echo "[${TIMESTAMP}] $src OK: $UFILE ($(du -h "$UFILE" | cut -f1))"
    else
      echo "[${TIMESTAMP}] $src skipped"
      rm -f "$UFILE"
    fi
  fi
done

# 30일 초과 보존분 정리
find /backups -name "erp_ot_*.sql.gz"     -mtime +30 -delete 2>/dev/null || true
find /backups -name "*_uploads_*.tar.gz"  -mtime +30 -delete 2>/dev/null || true
echo "[${TIMESTAMP}] Backup run complete."
