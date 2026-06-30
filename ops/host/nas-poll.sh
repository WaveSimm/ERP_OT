#!/usr/bin/env bash
# NAS 증분동기화 — Universal Search 델타 폴러 (cron 5분 주기)
#   finder 모드: 수정일 윈도우(20분, 5분주기에 여유 overlap)로 '변경분만' UPSERT.
#   ★ CIFS 마운트를 쓰지 않음(DSM HTTP API 5000) → NAS 행 위험 없음.
#   신규=INSERT+추출큐(PENDING), 기존=size/mtime만 갱신(text_status 보존), PRUNE 없음(삭제는 reconcile).
set -uo pipefail

LOG=/home/oceantech/nas-poll.log
LOCK=/tmp/nas-poll.lock

# 중복 실행 방지 (이전 폴이 안 끝났으면 skip)
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "$(date '+%F %T %Z') [skip] 이전 폴 실행 중" >> "$LOG"
  exit 0
fi

{
  echo "----- $(date '+%F %T %Z') finder poll 시작 -----"
  docker run --rm \
    --env-file /home/oceantech/ot-brain/.env \
    --network ot-brain_default \
    -e OTBRAIN_PG_HOST=ot-postgres -e OTBRAIN_PG_PORT=5432 \
    -w /app/services/ingestion/loaders \
    ot-brain-ot-extractor \
    python poll_changes.py --mode finder --window-min 20 --apply
  echo "----- $(date '+%F %T %Z') 종료(exit=$?) -----"
} >> "$LOG" 2>&1
