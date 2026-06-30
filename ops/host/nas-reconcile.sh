#!/usr/bin/env bash
# NAS 정합 reconcile — 주간 1회 (cron: 토요일 08:00 KST)
#   전체 트리 List 열거 vs DB 차분 → INSERT/UPDATE/PRUNE(이동·삭제 제거). ~9시간(8M).
#   ★ DSM List API(HTTP/HTTPS) 사용, CIFS 마운트 안 씀 → NAS 행 위험 없음.
#   UPSERT는 size/mtime만 갱신(text_status/exif_status 보존). list 실패>0이면 오삭제 방지로 PRUNE 자동 생략.
#   신규·변경 실시간 반영은 5분 finder 폴러(nas-poll.sh) 담당. reconcile는 삭제 감지 권위.
set -uo pipefail

LOG=/home/oceantech/nas-reconcile.log
LOCK=/tmp/nas-reconcile.lock

# 중복 실행 방지 (직전 reconcile 가 9h 넘겨 진행 중이면 skip)
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "$(date '+%F %T %Z') [skip] 이전 reconcile 실행 중" >> "$LOG"
  exit 0
fi

{
  echo "===== $(date '+%F %T %Z') reconcile 시작 (전체 /oceantech, UPSERT+PRUNE) ====="
  docker run --rm \
    --env-file /home/oceantech/ot-brain/.env \
    --network ot-brain_default \
    -e OTBRAIN_PG_HOST=ot-postgres -e OTBRAIN_PG_PORT=5432 \
    -w /app/services/ingestion/loaders \
    ot-brain-ot-extractor \
    python reconcile_nas.py --folder /oceantech --insecure
  echo "===== $(date '+%F %T %Z') reconcile 종료(exit=$?) ====="
} >> "$LOG" 2>&1
