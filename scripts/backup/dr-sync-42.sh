#!/bin/bash
# ── DR 동기화: .41(운영) → .42(백업/대체 서버) ──────────────────────────────
#   erp_ot DB 논리덤프 + 업로드 볼륨을 10분마다 .42:~/erp-dr/ 로 push.
#   목적: .41 하드웨어 장애 시 .42 가 IP(192.168.0.41) 승계 + ERP 스택 기동으로
#         업무 연속성 확보(RPO≈10분). OT-Brain/OCR 서비스는 대상 아님(데이터만 보존).
#   방식: streaming replication 아님(논리덤프). 스키마+데이터 통째 복원이라
#         project prisma 마이그레이션 drift 를 우회함.
#   실패 알림: 공용 ops-lib.sh 의 ops_emit → ops.alert_event 큐 → ops-notifier 메일.
#   cron: */10 * * * *  /home/oceantech/dr-sync-42.sh  >> /home/oceantech/dr-sync-42.log 2>&1
#   수동 테스트: dr-sync-42.sh --once (동일 동작, 상세 로그)
set -uo pipefail

# ── 설정 ────────────────────────────────────────────────────────────────────
TARGET_HOST="192.168.0.42"
TARGET_USER="oceantech"
TARGET="${TARGET_USER}@${TARGET_HOST}"
DEST="erp-dr"                                   # .42 의 ~/erp-dr
SSH="ssh -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=5"
STAGE="/home/oceantech/.dr-stage"
LOG="/home/oceantech/dr-sync-42.log"
LOCK="/home/oceantech/.dr-sync-42.lock"
STATE="/home/oceantech/.dr-sync-42.state"       # 마지막 성공 시각(모니터링용)
OPSLIB="/home/oceantech/ops-lib.sh"

PG_CONTAINER="erp-ot-postgres"
DB_USER="erp_user"
DB_NAME="erp_ot"
VOLUMES="erp_ot_auth_uploads erp_ot_approval_uploads erp_ot_expense_uploads erp_ot_ocr_uploads erp_ot_file_storage"
KEEP_DB=36                                       # 최근 10분덤프 36개(=6시간)
KEEP_DAILY=14                                    # 일별 스냅샷 14일

TS="$(date '+%F %T %Z')"
STAMP="$(date '+%Y%m%d_%H%M%S')"
log(){ echo "[$(date '+%F %T')] $*"; }

# ── 알림(있으면 ops_emit, 없으면 로그만) ───────────────────────────────────
[ -f "$OPSLIB" ] && . "$OPSLIB" 2>/dev/null || true
alert(){  # alert <level> <msg>
  local level=$1 msg=$2
  log "[$level] $msg"
  if command -v ops_emit >/dev/null 2>&1; then
    ops_emit "dr-sync" "$level" "" "DR 동기화(.42) $level: $msg (호스트 $(hostname))" "true" || true
  fi
}
die(){ alert "CRIT" "$1"; rm -f "$STAGE"/erp_ot_*.sql.gz 2>/dev/null; exit 1; }

# ── 중복 실행 방지 ──────────────────────────────────────────────────────────
exec 9>"$LOCK"
flock -n 9 || { log "이전 동기화 진행 중 — skip"; exit 0; }

mkdir -p "$STAGE"

# ── 0) 전제 점검 ────────────────────────────────────────────────────────────
docker ps --format '{{.Names}}' | grep -qx "$PG_CONTAINER" || die "$PG_CONTAINER 미기동 — 덤프 불가"
$SSH "$TARGET" "mkdir -p ~/$DEST/db ~/$DEST/volumes ~/$DEST/db/daily" 2>/dev/null || die ".42 SSH/대상디렉토리 실패"

# ── 1) erp_ot DB 덤프(+무결성) ──────────────────────────────────────────────
DBF="$STAGE/erp_ot_${STAMP}.sql.gz"
docker exec "$PG_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner --no-privileges --clean --if-exists 2>/dev/null | gzip > "$DBF"
[ "${PIPESTATUS[0]}" = 0 ] || die "pg_dump 실패"
gzip -t "$DBF" 2>/dev/null || die "덤프 무결성 실패(gzip -t)"
DBSZ=$(du -h "$DBF" | cut -f1)

# ── 2) 업로드 볼륨 tar(최신본 덮어쓰기 — 버전 미보관) ───────────────────────
for V in $VOLUMES; do
  docker run --rm -v "${V}":/v:ro alpine tar czf - -C /v . 2>/dev/null > "$STAGE/${V}.tar.gz"
  [ "${PIPESTATUS[0]}" = 0 ] || die "볼륨 ${V} tar 실패"
done

# ── 3) .42 로 전송 ──────────────────────────────────────────────────────────
rsync -a -e "$SSH" "$DBF" "$TARGET":"~/$DEST/db/"          || die "DB 전송(rsync) 실패"
rsync -a -e "$SSH" "$STAGE"/*.tar.gz "$TARGET":"~/$DEST/volumes/" || die "볼륨 전송(rsync) 실패"

# ── 4) .42 로테이션(10분덤프 36개 + 일별 14일) ──────────────────────────────
$SSH "$TARGET" "
  cd ~/$DEST/db || exit 1
  ls -1t erp_ot_*.sql.gz | tail -n +$((KEEP_DB+1)) | xargs -r rm -f
  d=\$(date +%Y%m%d)
  [ -f daily/erp_ot_\${d}.sql.gz ] || cp -p \"\$(ls -1t erp_ot_*.sql.gz | head -1)\" daily/erp_ot_\${d}.sql.gz
  ls -1t daily/erp_ot_*.sql.gz | tail -n +$((KEEP_DAILY+1)) | xargs -r rm -f
" 2>/dev/null || alert "WARN" "로테이션 실패(전송은 성공)"

# ── 5) 로컬 stage 정리(최근 3개 DB만) ───────────────────────────────────────
ls -1t "$STAGE"/erp_ot_*.sql.gz 2>/dev/null | tail -n +4 | xargs -r rm -f

# ── 6) 성공 기록 ────────────────────────────────────────────────────────────
echo "$(date +%s) $TS OK db=$DBSZ" > "$STATE"
log "OK — erp_ot(${DBSZ}) + 볼륨 5종 → .42:~/$DEST (RPO≈10m)"
exit 0
