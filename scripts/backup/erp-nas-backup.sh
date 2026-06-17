#!/usr/bin/env sh
# ERP / ot-brain → NAS(\\192.168.0.220\erp-backup) 백업 오케스트레이터.
# 서버 user crontab 에서 실행 (sudo 불필요. docker 그룹 권한만 사용).
#
# 사용:
#   erp-nas-backup.sh daily    # erp_ot DB(full) + 업로드 4종 + .env  → NAS daily/
#   erp-nas-backup.sh weekly   # otbrain DB(full, 17GB)               → NAS weekly/
#
# 자격증명: $HOME/.nas-backup-cred  (smbclient -A 형식, chmod 600)
#   username = otbrain-scan
#   password = ********
#
# 같은 디렉토리에 nas-uploader.sh 가 있어야 함(컨테이너에서 실행).
set -u
MODE="${1:-daily}"
CRED="$HOME/.nas-backup-cred"
HERE="$(cd "$(dirname "$0")" && pwd)"
STAGE="$HOME/.nasbackup_stage"
DAY="$(date +%Y%m%d)"
ERP_ENV="/home/oceantech/ERP_OT/.env"
OT_ENV="/home/oceantech/ot-brain/.env"

log(){ echo "[$(date '+%F %T')] $*"; }
[ -f "$CRED" ] || { log "ERR: 자격증명 $CRED 없음"; exit 1; }
[ -f "$HERE/nas-uploader.sh" ] || { log "ERR: $HERE/nas-uploader.sh 없음"; exit 1; }
mkdir -p "$STAGE"; rm -f "$STAGE"/* 2>/dev/null

upload(){  # $1=NAS 하위폴더  $2=보존일수
  docker run --rm \
    -v "$CRED":/cred:ro -v "$STAGE":/s:ro -v "$HERE/nas-uploader.sh":/u.sh:ro \
    alpine sh /u.sh "$1" "$2"
}

if [ "$MODE" = "weekly" ]; then
  log "weekly 시작: otbrain DB 덤프(17GB)"
  if docker exec ot-postgres pg_dump -Fc -U otbrain otbrain > "$STAGE/otbrain_$DAY.dump"; then
    log "otbrain 덤프 OK ($(du -h "$STAGE/otbrain_$DAY.dump" | cut -f1)) → 업로드"
    upload weekly 28
  else
    log "otbrain 덤프 실패"; rm -rf "$STAGE"; exit 1
  fi
else
  log "daily 시작: erp_ot DB + 업로드 4종 + .env"
  docker exec erp-ot-postgres pg_dump -U erp_user -d erp_ot --no-owner --no-privileges 2>/dev/null | gzip > "$STAGE/erp_ot_$DAY.sql.gz"
  for V in auth approval expense ocr; do
    docker run --rm -v "erp_ot_${V}_uploads":/v:ro alpine tar czf - -C /v . 2>/dev/null > "$STAGE/${V}_uploads_$DAY.tar.gz"
  done
  [ -f "$ERP_ENV" ] && cp "$ERP_ENV" "$STAGE/erp_ot.env"
  [ -f "$OT_ENV" ]  && cp "$OT_ENV"  "$STAGE/otbrain.env"
  log "스테이징 완료 ($(du -sh "$STAGE" | cut -f1)) → 업로드"
  upload daily 30
fi

rm -rf "$STAGE"
log "$MODE 완료"
