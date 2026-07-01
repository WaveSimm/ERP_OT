#!/bin/bash
# ── DR Failover 기동 스크립트 (.42 에서 실행) ──────────────────────────────
#   .41 하드웨어 장애 시, .42 를 대기상태→운영으로 전환.
#   이 스크립트는 [데이터 복원 + ERP 스택 기동]만 담당. IP 승계는 별도(런북 참고).
#   전제: 이미지 사전빌드 완료(Phase2), 최신 덤프가 ~/erp-dr/ 에 동기화(10분 cron).
#   사용: ~/dr-failover.sh   (로그: ~/dr-failover.log)
set -uo pipefail
cd ~/ERP_OT || exit 1
exec > >(tee -a ~/dr-failover.log) 2>&1

INFRA="postgres redis rabbitmq"
APP="auth-service user-service project-service attendance-service approval-service equipment-service expense-service web"
DRDIR=~/erp-dr
PGC=erp-ot-postgres
step(){ echo; echo "==== [$(date '+%F %T')] $* ===="; }

step "0) DR Failover 기동 시작 (OCR/OT-Brain 제외)"

step "1) 인프라 기동"
docker compose up -d $INFRA || { echo "!! 인프라 실패"; exit 1; }
echo -n "postgres 헬스 대기"
for i in $(seq 1 60); do docker exec "$PGC" pg_isready -U erp_user -d erp_ot >/dev/null 2>&1 && { echo " ready"; break; }; echo -n .; sleep 3; done

step "2) erp_ot 최신 덤프 복원 (--clean 권위복원)"
DUMP=$(ls -t "$DRDIR"/db/erp_ot_*.sql.gz 2>/dev/null | head -1)
[ -n "$DUMP" ] || { echo "!! 덤프 없음"; exit 1; }
echo "복원: $DUMP ($(date -r "$DUMP" '+%F %T') 기준)"
gunzip -c "$DUMP" | docker exec -i "$PGC" psql -q -U erp_user -d erp_ot >/tmp/dr-restore.log 2>&1
echo "복원 ERROR: $(grep -c ERROR /tmp/dr-restore.log 2>/dev/null)"

step "3) 업로드 볼륨 복원"
for V in auth_uploads approval_uploads expense_uploads ocr_uploads file_storage; do
  T="$DRDIR/volumes/erp_ot_${V}.tar.gz"
  [ -f "$T" ] && docker run --rm -v "erp_ot_${V}":/v -v "$DRDIR/volumes":/b:ro alpine sh -c "cd /v && rm -rf ./* 2>/dev/null; tar xzf /b/erp_ot_${V}.tar.gz" >/dev/null 2>&1 && echo "  $V 복원"
done

step "4) 앱 서비스 기동 (web 은 npm 빌드 — 수분)"
docker compose up -d --no-deps $APP || echo "!! 일부 앱 기동 실패"

step "5) 검증"
echo -n "web 준비 대기"
for i in $(seq 1 50); do
  c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:3000/ 2>/dev/null)
  [ "$c" = "200" ] && { echo " web HTTP 200 (~$((i*6))s)"; break; }; echo -n .; sleep 6
done
USERS=$(docker exec "$PGC" psql -U erp_user -d erp_ot -tAc "select count(*) from auth_users" 2>/dev/null)
echo "복원된 사용자 수: ${USERS:-?}  (1 이면 복원 실패 — 재확인 필요)"
echo "컨테이너:"; docker ps --filter name=erp-ot --format '  {{.Names}} {{.Status}}' | sort

step "완료 — 다음: IP 승계(런북 6단계) 후 사내 접속 확인"
