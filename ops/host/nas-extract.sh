#!/bin/bash
# ── NAS 문서 추출(청킹) 야간 배치 ──────────────────────────────────────────────
#   nas-poll 가 새 문서를 text_status=PENDING 으로 넣으면, 이 배치가
#   추출→청크→bge-m3 임베딩→nas_chunk 적재 (수동 추출의 자동화).
#   시간: 09:00 KST — EXIF 야간배치(20:00~08:00) 종료 후 (CIFS 경합 회피).
#   MIN_DOC_SIZE=1000: 소형 증빙류(거래명세서 등 ≥1KB)는 추출, 165B ~$/._ 정크는 제외.
#   timeout 2h: 런어웨이 방지 (PENDING 소진 시 정상 종료, 미소진 시 중단 후 다음날 이어감).
set -uo pipefail

LOG=/home/oceantech/nas-extract.log
LOCK=/tmp/nas-extract.lock

exec 9>"$LOCK"
if ! flock -n 9; then
  echo "$(date '+%F %T %Z') [skip] 이전 추출 실행 중" >> "$LOG"
  exit 0
fi

{
  echo "----- $(date '+%F %T %Z') 문서추출 시작 -----"
  cd /home/oceantech/ot-brain || { echo "ot-brain 디렉토리 없음"; exit 1; }
  timeout 7200 docker compose --profile extract run --rm -e MIN_DOC_SIZE=1000 ot-extractor
  echo "----- $(date '+%F %T %Z') 종료(exit=$?) -----"
} >> "$LOG" 2>&1
